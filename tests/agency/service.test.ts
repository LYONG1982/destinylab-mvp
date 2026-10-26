import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { database } from "../../src/server/db";
import { emptyActivity } from "../../src/server/state";
import {
  TONGZHOU_CONSENT_VERSION,
  emptyTongzhouProfile,
} from "../../src/domain/tongzhou";
import { QUESTIONS, AGES } from "../../src/data/questions";
import {
  validateAgencyDraft,
  publicProfile,
  defaultPublicFields,
} from "../../src/domain/agency";
const origin = process.env.DESTINY_PUBLIC_URL!,
  credentials = process.env.DESTINY_AGENCY_TEST_CREDENTIALS!;
if (
  origin !== "http://127.0.0.1:3217" ||
  !new URL(process.env.DATABASE_URL!).pathname.endsWith(
    "agency_20261011_test",
  ) ||
  !credentials
)
  throw Error("Isolated agency test environment required");
const activity = "cloudtest-agency-" + randomUUID().slice(0, 8);
const route = (p: string, a = activity) =>
  origin + p + (p.includes("?") ? "&" : "?") + "activity=" + a;
async function req(
  p: string,
  cookie = "",
  data?: unknown,
  extra: Record<string, string> = {},
  a = activity,
) {
  return fetch(route(p, a), {
    method: data === undefined ? "GET" : "POST",
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(data !== undefined
        ? { "Content-Type": "application/json", Origin: origin }
        : {}),
      ...extra,
    },
    body:
      data === undefined
        ? undefined
        : Buffer.isBuffer(data)
          ? new Uint8Array(data)
          : JSON.stringify(data),
  });
}
const cook = (r: Response) => r.headers.get("set-cookie")!.split(";")[0];
after(() => database().end());
test("public field selection rejects private metadata and never exposes unselected data", () => {
  const d = validateAgencyDraft({
    note: "PRIVATE",
    signed: false,
    service: "none",
    nickname: "林间",
    code: "tz-123",
    intro: "PUBLIC",
    fields: ["city", "intro"],
  });
  const f = {
    ...emptyTongzhouProfile(),
    realName: "PRIVATE-NAME",
    phone: "13800001111",
    city: "银川",
  };
  const p = publicProfile(f, d, true);
  assert.equal(p.title, "林间");
  assert.equal(p.photo, false);
  assert.equal(JSON.stringify(p).includes("PRIVATE"), false);
  assert.throws(() => validateAgencyDraft({ ...d, fields: ["note"] }));
  assert.throws(() => validateAgencyDraft({ ...d, note: "a".repeat(2001) }));
});
test("agency workflow, publication isolation, concurrency, consent invalidation and pagination", async () => {
  const pool = database();
  const state = emptyActivity();
  await pool.query("INSERT INTO dl_activities(id,state) VALUES($1,$2)", [
    activity,
    JSON.stringify(state),
  ]);
  const joined = await req("/api/live/session", "", {});
  assert.equal(joined.status, 200);
  const user = cook(joined),
    s = await joined.json(),
    actor = s.actor;
  async function command(
    command: object,
    path = "/api/live/command?audience=participant",
  ) {
    const r = await req(
      path,
      user,
      { epoch: s.state.epoch, command },
      { "Idempotency-Key": randomUUID() },
    );
    assert.equal(r.status, 200, await r.clone().text());
    return r.json();
  }
  await command({
    type: "answer",
    questionId: "q1",
    value: QUESTIONS[0].options[0],
  });
  await command({
    type: "profile",
    name: "测试甲",
    gender: "male",
    avatarId: "male_01",
    age: AGES[1],
    ready: true,
  });
  const photo = await sharp({
    create: { width: 32, height: 32, channels: 3, background: "#dabb99" },
  })
    .png()
    .toBuffer();
  const upload = await req("/api/avatar/upload", user, photo, {
    "Content-Type": "image/png",
  });
  assert.equal(upload.status, 200);
  const asset = await upload.json();
  await command(
    {
      type: "avatar",
      assetId: asset.id,
      avatarId: "male_01",
      allowScreen: false,
      expectedVersion: 0,
    },
    "/api/avatar/command",
  );
  const fields = {
    ...emptyTongzhouProfile(),
    realName: "测试甲",
    phone: "13812345678",
    gender: "男",
    birthYear: "1995",
    city: "银川",
    ethnicity: "汉族",
    maritalStatus: "未婚",
    family: "PRIVATE FAMILY",
    expectations: "一起散步",
  };
  await command(
    {
      type: "tongzhou-submit",
      fields,
      consent: true,
      consentVersion: TONGZHOU_CONSENT_VERSION,
      expectedVersion: 0,
    },
    "/api/tongzhou/command",
  );
  const login = await req(
    "/api/tongzhou/login",
    "",
    JSON.parse(readFileSync(credentials + "/agency.json", "utf8")),
  );
  assert.equal(login.status, 200);
  const agency = cook(login);
  const op = await req(
    "/api/live/login",
    "",
    JSON.parse(readFileSync(credentials + "/operator.json", "utf8")),
  );
  const operator = cook(op);
  assert.equal((await req("/api/tongzhou/records")).status, 401);
  assert.equal((await req("/api/tongzhou/records", operator)).status, 401);
  assert.equal(
    (await req("/api/tongzhou/photo?id=" + actor, user)).status,
    401,
  );
  const get = async () => {
    const r = await req("/api/tongzhou/records?id=" + actor, agency);
    assert.equal(r.status, 200);
    return r.json();
  };
  let detail = await get();
  assert.deepEqual(detail.management.fields, defaultPublicFields());
  assert.equal(detail.gallery.photos.length, 1);
  assert.equal(detail.gallery.photos[0].source, "user");
  assert.equal(detail.gallery.photos[0].id, asset.id);
  assert.equal(
    (
      await req(
        "/api/tongzhou/gallery-photo?id=" + actor + "&photo=" + asset.id,
        agency,
      )
    ).status,
    200,
  );

  const albumUpload = await req(
    "/api/tongzhou/gallery-upload?id=" + actor + "&version=0",
    agency,
    photo,
    { "Content-Type": "image/png", "Idempotency-Key": randomUUID() },
  );
  assert.equal(albumUpload.status, 200);
  const uploadedPhoto = (await albumUpload.json()).photos.find(
    (p: { source: string }) => p.source === "agency",
  ).id;
  detail = await get();
  const draft = {
    photoIds: [asset.id, uploadedPhoto],
    note: "PRIVATE NOTE\n<script>alert(1)</script>",
    signed: true,
    service: "active",
    nickname: "林间",
    code: "TZ-" + randomUUID().slice(0, 8),
    intro: "喜欢读书与旅行",
    fields: ["city", "gender", "photo", "intro", "realName", "phone"],
  };
  const body = (action: string, d = draft) => ({
    actor,
    action,
    draft: d,
    expectedVersion: detail.management.version,
    sourceVersion: detail.record.version,
    confirmed: true,
    expectedGalleryVersion: detail.gallery.version,
    expectedUserPhoto: detail.gallery.userPhotoId,
  });
  const manage = (b: object, id = randomUUID(), cookie = agency) =>
    req("/api/tongzhou/manage", cookie, b, { "Idempotency-Key": id });
  assert.equal(
    (await manage(body("save"), randomUUID(), operator)).status,
    401,
  );
  assert.equal(
    (
      await req("/api/tongzhou/manage", agency, body("save"), {
        Origin: "http://invalid.example",
      })
    ).status,
    403,
  );
  assert.equal(
    (await manage({ ...body("save"), actor: "other-user" })).status,
    404,
  );
  assert.equal(
    (await manage({ ...body("publish"), confirmed: false })).status,
    400,
  );
  assert.equal(
    (await manage({ ...body("save"), draft: { ...draft, fields: ["note"] } }))
      .status,
    400,
  );
  const preview = await manage(body("preview"));
  assert.equal(preview.status, 200);
  const pv = await preview.json();
  assert.equal(pv.preview.photo, true);
  assert.equal(JSON.stringify(pv).includes("PRIVATE"), false);
  const save = await manage(body("save"));
  assert.equal(save.status, 200);
  detail = await get();
  assert.equal(detail.management.note, draft.note);
  assert.equal(detail.management.signed, true);
  assert.equal(detail.management.service, "active");
  assert.equal(detail.management.published, false);
  assert.equal(
    (await manage({ ...body("publish"), expectedGalleryVersion: -1 })).status,
    409,
  );
  const publish = body("publish"),
    id = randomUUID();
  assert.equal((await manage(publish, id)).status, 200);
  assert.equal((await manage(publish, id)).status, 200);
  assert.equal(
    (await manage({ ...publish, confirmed: false }, id)).status,
    400,
  );
  detail = await get();
  const url = detail.management.url,
    slug = url.split("/").at(-1);
  assert.equal(detail.management.needsUpdate, false);
  // Simulate a historical publication containing the now-forbidden fields.
  await pool.query(
    `UPDATE dl_agency_profiles SET snapshot=jsonb_set(snapshot,'{items}',(snapshot->'items') || $3::jsonb) WHERE activity_id=$1 AND actor=$2`,
    [
      activity,
      actor,
      JSON.stringify([
        { key: "realName", label: "真实姓名", value: fields.realName },
        { key: "phone", label: "手机号", value: fields.phone },
      ]),
    ],
  );
  const pub = await fetch(origin + "/api/tongzhou-public/" + slug);
  assert.equal(pub.status, 200);
  assert.match(pub.headers.get("cache-control")!, /no-store/);
  const publicText = await pub.text();
  for (const text of ["13812345678", "PRIVATE", "测试甲", "signed", "actor"])
    assert.equal(publicText.includes(text), false, text);
  const page = await fetch(origin + url);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.equal(html.includes("PRIVATE"), false);
  assert.equal(html.includes(fields.realName), false);
  assert.equal(html.includes(fields.phone), false);
  assert.match(html, /noindex/);
  assert.equal(
    (await fetch(origin + "/api/tongzhou-public/" + slug + "?photo=1")).status,
    200,
  );
  const originalPhotoResponse = await fetch(
    origin + "/api/tongzhou-public/" + slug + "?image=" + asset.id,
  );
  assert.equal(originalPhotoResponse.status, 200);
  const originalPhotoBytes = Buffer.from(
    await originalPhotoResponse.arrayBuffer(),
  );
  const replacement = await req("/api/avatar/upload", user, photo, {
    "Content-Type": "image/png",
  });
  assert.equal(replacement.status, 200);
  const nextAsset = await replacement.json();
  // Unconfirmed uploads cannot enter the agency gallery.
  assert.equal((await get()).gallery.userPhotoId, asset.id);
  const staleBody = body("publish");
  await command(
    {
      type: "avatar",
      assetId: nextAsset.id,
      avatarId: "male_01",
      allowScreen: false,
      expectedVersion: 1,
    },
    "/api/avatar/command",
  );
  assert.equal((await manage(staleBody)).status, 409);
  detail = await get();
  assert.equal(detail.gallery.userPhotoId, nextAsset.id);
  assert.equal(
    detail.gallery.photos.filter((p: { source: string }) => p.source === "user")
      .length,
    1,
  );
  assert.equal(
    detail.gallery.photos.some((p: { id: string }) => p.id === asset.id),
    false,
  );
  assert.equal(
    (
      await req(
        "/api/tongzhou/gallery-photo?id=" + actor + "&photo=" + asset.id,
        agency,
      )
    ).status,
    404,
  );
  const stillPublished = await fetch(
    origin + "/api/tongzhou-public/" + slug + "?image=" + asset.id,
  );
  assert.equal(stillPublished.status, 200);
  assert.deepEqual(
    Buffer.from(await stillPublished.arrayBuffer()),
    originalPhotoBytes,
  );
  assert.equal(
    (
      await fetch(
        origin + "/api/tongzhou-public/" + slug + "?image=" + nextAsset.id,
      )
    ).status,
    404,
  );
  draft.photoIds = [nextAsset.id, uploadedPhoto];
  // Current user photos cannot be removed or reordered by an agency operation.
  assert.equal(
    (
      await req(
        "/api/tongzhou/gallery",
        agency,
        {
          actor,
          action: "delete",
          id: nextAsset.id,
          expectedVersion: detail.gallery.version,
          confirmed: true,
        },
        { "Idempotency-Key": randomUUID() },
      )
    ).status,
    404,
  );
  // Saving a draft cannot silently change the public page.
  const revised = { ...draft, nickname: "新的昵称", fields: ["city"] };
  assert.equal((await manage(body("save", revised))).status, 200);
  assert.equal(
    (await (await fetch(origin + "/api/tongzhou-public/" + slug)).json()).title,
    "林间",
  );
  detail = await get();
  assert.equal(detail.management.needsUpdate, true);
  const simultaneous = await Promise.all([
    manage(body("save", revised)),
    manage(body("save", revised)),
  ]);
  assert.deepEqual(simultaneous.map((r) => r.status).sort(), [200, 409]);
  detail = await get();
  assert.equal((await manage(body("publish", revised))).status, 200);
  detail = await get();
  assert.equal(detail.management.url, url);
  assert.equal(
    (await fetch(origin + "/api/tongzhou-public/" + slug + "?photo=1")).status,
    404,
  );
  assert.equal((await manage(body("unpublish", revised))).status, 200);
  assert.equal((await fetch(origin + url)).status, 404);
  detail = await get();
  assert.equal((await manage(body("publish"))).status, 200);
  await command(
    { type: "tongzhou-withdraw", expectedVersion: detail.record.version },
    "/api/tongzhou/command",
  );
  assert.equal((await fetch(origin + url)).status, 404);
  assert.equal(
    (await fetch(origin + "/api/tongzhou-public/" + slug + "?photo=1")).status,
    404,
  );
  assert.equal(
    (await req("/api/tongzhou/records?id=" + actor, agency)).status,
    404,
  );
  await command(
    {
      type: "tongzhou-submit",
      fields,
      consent: true,
      consentVersion: TONGZHOU_CONSENT_VERSION,
      expectedVersion: detail.record.version + 1,
    },
    "/api/tongzhou/command",
  );
  detail = await get();
  assert.equal(detail.management.published, false);
  assert.equal((await fetch(origin + url)).status, 404);
  assert.equal(
    detail.gallery.photos.filter(
      (p: { source: string }) => p.source === "agency",
    ).length,
    0,
  );
  assert.equal(
    (await manage(body("publish", { ...revised, photoIds: [] }))).status,
    200,
  );
  detail = await get();
  await command(
    { type: "tongzhou-delete", expectedVersion: detail.record.version },
    "/api/tongzhou/command",
  );
  assert.equal((await fetch(origin + url)).status, 404);
  const cleared = await pool.query(
    "SELECT photo,snapshot FROM dl_agency_profiles WHERE activity_id=$1 AND actor=$2",
    [activity, actor],
  );
  assert.equal(cleared.rows[0].photo, null);
  assert.equal(cleared.rows[0].snapshot, null);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int n FROM dl_agency_user_photo_snapshots WHERE activity_id=$1 AND actor=$2",
        [activity, actor],
      )
    ).rows[0].n,
    0,
  );
  const logs = await pool.query(
    "SELECT public_permission_confirmed FROM dl_agency_actions WHERE activity_id=$1 AND action='publish'",
    [activity],
  );
  assert.ok(logs.rows.every((r) => r.public_permission_confirmed));
  // Fictional fixture records remain only in this explicitly guarded test DB.
  for (let i = 0; i < 23; i++) {
    const a = "fixture-" + i;
    const r = {
      participantId: a,
      organizationId: "tongzhou",
      version: 1,
      status: "active",
      fields: {
        ...fields,
        realName: "虚构资料" + i,
        gender: i % 2 ? "女" : "男",
        city: i % 2 ? "银川" : "西安",
        height: "165",
        education: "本科",
        occupation: "产品设计",
        children: "未育",
        income: "10000–19999 元",
        housing: "自有住房",
        vehicle: "有车",
        family: "家庭氛围融洽，尊重独立生活。",
        contactTime: "工作日 18:00 后",
      },
      submittedAt: Date.now(),
      updatedAt: Date.now(),
      consent: { version: TONGZHOU_CONSENT_VERSION, at: Date.now() },
    };
    await pool.query(
      "INSERT INTO dl_tongzhou_submissions(activity_id,actor,record) VALUES($1,$2,$3)",
      [activity, a, JSON.stringify(r)],
    );
  }
  const list = await (await req("/api/tongzhou/records", agency)).json();
  assert.equal(list.total, 23);
  assert.equal(list.records.length, 20);
  assert.equal(list.stats.male, 12);
  assert.equal(list.stats.female, 11);
  assert.equal(
    (await (await req("/api/tongzhou/records?page=2", agency)).json()).records
      .length,
    3,
  );
  const filtered = await (
    await req(
      "/api/tongzhou/records?gender=" + encodeURIComponent("女"),
      agency,
    )
  ).json();
  assert.equal(filtered.total, 11);
  assert.equal(filtered.stats.total, 23);
  const f = await (
    await req("/api/tongzhou/records?id=fixture-0", agency)
  ).json();
  const collision = {
    ...body("save"),
    actor: "fixture-0",
    draft: { ...draft, photoIds: [], fields: ["city"] },
    expectedGalleryVersion: 0,
    expectedUserPhoto: null,
    sourceVersion: 1,
    expectedVersion: 0,
  };
  assert.equal((await manage(collision)).status, 409);
  assert.equal(f.management.version, 0);
  const other = "cloudtest-other-" + randomUUID().slice(0, 8);
  await pool.query("INSERT INTO dl_activities(id,state) VALUES($1,$2)", [
    other,
    JSON.stringify(emptyActivity()),
  ]);
  assert.equal(
    (await req("/api/tongzhou/records", agency, undefined, {}, other)).status,
    401,
  );
  const fixtureAsset = randomUUID();
  await pool.query(
    "INSERT INTO dl_avatar_assets(id,activity_id,actor,bytes,attached) VALUES($1,$2,$3,$4,true)",
    [
      fixtureAsset,
      activity,
      "fixture-1",
      await sharp(photo).resize(512, 512).webp().toBuffer(),
    ],
  );
  const fixtureState = (
    await pool.query("SELECT state FROM dl_activities WHERE id=$1", [activity])
  ).rows[0].state;
  fixtureState.participants.push({
    ...fixtureState.participants[0],
    id: "fixture-1",
    photo: { id: fixtureAsset, screen: false },
  });
  await pool.query("UPDATE dl_activities SET state=$2 WHERE id=$1", [
    activity,
    JSON.stringify(fixtureState),
  ]);
  writeFileSync(
    credentials + "/fixture.json",
    JSON.stringify({ activity, actor: "fixture-1", testOnly: true }),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      activity,
      checks:
        "publication, privacy, permission, races, invalidation, pagination",
      testOnly: true,
    }),
  );
});
