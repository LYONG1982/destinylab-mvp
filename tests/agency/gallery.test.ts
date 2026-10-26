import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { defaultPublicFields } from "../../src/domain/agency";
import { database } from "../../src/server/db";
import { emptyActivity } from "../../src/server/state";
import {
  TONGZHOU_CONSENT_VERSION,
  emptyTongzhouProfile,
} from "../../src/domain/tongzhou";
const origin = process.env.DESTINY_PUBLIC_URL!,
  dir = process.env.DESTINY_AGENCY_TEST_CREDENTIALS!;
if (
  origin !== "http://127.0.0.1:3217" ||
  !new URL(process.env.DATABASE_URL!).pathname.endsWith(
    "agency_20261011_test",
  ) ||
  !dir
)
  throw Error("Isolated test environment required");
after(() => database().end());
test("independent album: privacy, scopes, format, concurrency, snapshots and immediate published deletion", async () => {
  const activity = "cloudtest-album-" + randomUUID().slice(0, 8),
    actor = "fictional-album";
  const pool = database();
  await pool.query("INSERT INTO dl_activities(id,state) VALUES($1,$2)", [
    activity,
    JSON.stringify(emptyActivity()),
  ]);
  for (const id of [actor, "other"])
    await pool.query(
      "INSERT INTO dl_tongzhou_submissions(activity_id,actor,record) VALUES($1,$2,$3)",
      [
        activity,
        id,
        JSON.stringify({
          participantId: id,
          organizationId: "tongzhou",
          version: 1,
          status: "active",
          fields: {
            ...emptyTongzhouProfile(),
            realName: "保密真实姓名",
            phone: "13912345678",
            city: "银川",
            gender: "女",
          },
          submittedAt: Date.now(),
          updatedAt: Date.now(),
          consent: { version: TONGZHOU_CONSENT_VERSION, at: Date.now() },
        }),
      ],
    );
  const req = (
    path: string,
    cookie = "",
    data?: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(
      origin + path + (path.includes("?") ? "&" : "?") + "activity=" + activity,
      {
        method: data === undefined ? "GET" : "POST",
        headers: {
          ...(cookie ? { Cookie: cookie } : {}),
          ...(data !== undefined
            ? { "Content-Type": "application/json", Origin: origin }
            : {}),
          ...headers,
        },
        body:
          data === undefined
            ? undefined
            : Buffer.isBuffer(data)
              ? new Uint8Array(data)
              : JSON.stringify(data),
      },
    );
  const login = await req(
    "/api/tongzhou/login",
    "",
    JSON.parse(readFileSync(dir + "/agency.json", "utf8")),
  );
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const get = async () => {
    const r = await req("/api/tongzhou/records?id=" + actor, cookie);
    assert.equal(r.status, 200);
    return r.json();
  };
  let detail = await get();
  assert.deepEqual(detail.gallery.photos, []);
  assert.deepEqual(detail.management.fields, defaultPublicFields());
  // A new all-selected profile without photos can still be previewed/published.
  const noPhotoDraft = { ...detail.management };
  const clean = {
    note: noPhotoDraft.note,
    signed: noPhotoDraft.signed,
    service: noPhotoDraft.service,
    nickname: "无图测试",
    code: noPhotoDraft.code,
    intro: "",
    fields: noPhotoDraft.fields,
    photoIds: [],
  };
  for (const action of ["preview", "publish"]) {
    const r = await req(
      "/api/tongzhou/manage",
      cookie,
      {
        actor,
        action,
        draft: clean,
        expectedVersion: 0,
        sourceVersion: 1,
        expectedGalleryVersion: 0,
        expectedUserPhoto: null,
        confirmed: true,
      },
      { "Idempotency-Key": randomUUID() },
    );
    assert.equal(r.status, 200);
    if (action === "preview")
      assert.equal((await r.json()).preview.photo, false);
  }
  detail = await get();
  // Previously saved deliberate empty selections remain empty on reopening.
  await pool.query(
    "UPDATE dl_agency_profiles SET fields='[]' WHERE activity_id=$1 AND actor=$2",
    [activity, actor],
  );
  assert.deepEqual((await get()).management.fields, []);
  await pool.query(
    "UPDATE dl_agency_profiles SET fields=$3 WHERE activity_id=$1 AND actor=$2",
    [activity, actor, JSON.stringify(defaultPublicFields())],
  );
  detail = await get();
  const source = await sharp({
    create: { width: 300, height: 600, channels: 3, background: "#ddae93" },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const upload = (
    version = detail.gallery.version,
    id = randomUUID(),
    file = source,
    c = cookie,
  ) =>
    req(
      "/api/tongzhou/gallery-upload?id=" + actor + "&version=" + version,
      c,
      file,
      { "Content-Type": "image/jpeg", "Idempotency-Key": id },
    );
  assert.equal((await upload(0, randomUUID(), source, "")).status, 401);
  assert.equal(
    (
      await req(
        "/api/tongzhou/gallery-upload?id=" + actor + "&version=0",
        cookie,
        source,
        {
          "Content-Type": "image/jpeg",
          "Idempotency-Key": randomUUID(),
          Origin: "http://invalid.example",
        },
      )
    ).status,
    403,
  );
  assert.equal(
    (await upload(0, randomUUID(), Buffer.from("<svg/>"))).status,
    400,
  );
  assert.equal(
    (await upload(0, randomUUID(), Buffer.alloc(10 * 1024 * 1024 + 1))).status,
    413,
  );
  const id = randomUUID();
  assert.equal((await upload(0, id)).status, 200);
  assert.equal((await upload(0, id)).status, 200);
  assert.equal((await upload(0, id, Buffer.from("different"))).status, 400);
  detail = await get();
  assert.equal(detail.gallery.photos.length, 1);
  const first = detail.gallery.photos[0];
  assert.equal(first.width, 600);
  assert.equal(first.height, 300);
  const full = await req(
    first.url.split("?")[0] +
      "?" +
      first.url.split("?")[1].replace(/activity=[^&]+&/, ""),
    cookie,
  );
  assert.equal(full.status, 200);
  const metadata = await sharp(
    Buffer.from(await full.arrayBuffer()),
  ).metadata();
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.orientation, undefined);
  assert.equal(
    (
      await req(
        "/api/tongzhou/gallery-photo?id=other&photo=" + first.id,
        cookie,
      )
    ).status,
    404,
  );
  assert.equal((await fetch(origin + first.url)).status, 401);
  const concurrent = await Promise.all([upload(), upload()]);
  assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 409]);
  detail = await get();
  assert.equal(detail.gallery.photos.length, 2);
  const second = detail.gallery.photos[1];
  let draft = {
    note: "PRIVATE NOTE",
    signed: true,
    service: "active",
    nickname: "山间",
    code: detail.management.code,
    intro: "喜欢阅读",
    fields: ["city", "photo", "intro"],
    photoIds: [second.id, first.id],
  };
  const action = (action: string, extra: Record<string, unknown> = {}) =>
    req(
      "/api/tongzhou/manage",
      cookie,
      {
        actor,
        action,
        draft,
        expectedVersion: detail.management.version,
        sourceVersion: detail.record.version,
        expectedGalleryVersion: detail.gallery.version,
        expectedUserPhoto: detail.gallery.userPhotoId,
        confirmed: true,
        ...extra,
      },
      { "Idempotency-Key": randomUUID() },
    );
  // Separate saves must not overwrite another tab, including an invalid unsaved code.
  assert.equal(
    (
      await action("save", {
        scope: "followup",
        draft: { ...draft, code: "?" },
      })
    ).status,
    200,
  );
  detail = await get();
  assert.equal(detail.management.note, "PRIVATE NOTE");
  assert.equal(detail.management.nickname, "无图测试");
  assert.deepEqual(detail.management.fields, defaultPublicFields());
  assert.equal(
    (
      await action("save", {
        scope: "publication",
        draft: { ...draft, note: "UNSAVED", signed: false },
      })
    ).status,
    200,
  );
  detail = await get();
  assert.equal(detail.management.note, "PRIVATE NOTE");
  assert.equal(detail.management.signed, true);
  assert.equal(detail.management.nickname, "山间");
  const preview = await action("preview");
  assert.equal(preview.status, 200);
  const pv = await preview.json();
  assert.deepEqual(pv.preview.photos, [second.id, first.id]);
  assert.equal(JSON.stringify(pv).includes("PRIVATE"), false);
  assert.equal(
    (await action("publish", { expectedGalleryVersion: 0 })).status,
    409,
  );
  assert.equal((await action("publish")).status, 200);
  detail = await get();
  const slug = detail.management.url.split("/").at(-1);
  const pub = origin + "/api/tongzhou-public/" + slug;
  const publicData = await (await fetch(pub)).json();
  assert.deepEqual(publicData.photos, [second.id, first.id]);
  for (const secret of ["保密真实姓名", "13912345678", "PRIVATE NOTE", "actor"])
    assert.equal(JSON.stringify(publicData).includes(secret), false);
  const html = await (await fetch(origin + detail.management.url)).text();
  for (const secret of ["保密真实姓名", "13912345678", "PRIVATE NOTE"])
    assert.equal(html.includes(secret), false);
  assert.equal((await fetch(pub + "?image=" + first.id)).status, 200);
  assert.equal((await fetch(pub + "?image=" + randomUUID())).status, 404);
  const thirdUpload = await upload();
  assert.equal(thirdUpload.status, 200);
  detail = await get();
  const third = detail.gallery.photos[2];
  assert.equal((await fetch(pub + "?image=" + third.id)).status, 404);
  assert.deepEqual((await (await fetch(pub)).json()).photos, [
    second.id,
    first.id,
  ]);
  const gallery = (body: object, id = randomUUID()) =>
    req(
      "/api/tongzhou/gallery",
      cookie,
      { actor, expectedVersion: detail.gallery.version, ...body },
      { "Idempotency-Key": id },
    );
  assert.equal(
    (await gallery({ action: "delete", id: second.id })).status,
    400,
  );
  const deleteBody = { action: "delete", id: second.id, confirmed: true };
  const deletion = await gallery(deleteBody);
  assert.equal(deletion.status, 200);
  detail = await get();
  assert.equal((await fetch(pub + "?image=" + second.id)).status, 404);
  assert.deepEqual((await (await fetch(pub)).json()).photos, [first.id]);
  assert.equal(
    (await fetch(origin + second.url, { headers: { Cookie: cookie } })).status,
    404,
  );
  draft = { ...draft, photoIds: [first.id] };
  const order = [
    ...detail.gallery.photos.map((p: { id: string }) => p.id),
  ].reverse();
  assert.equal((await gallery({ action: "reorder", ids: order })).status, 200);
  detail = await get();
  assert.deepEqual(
    detail.gallery.photos.map((p: { id: string }) => p.id),
    order,
  );
  assert.equal(
    (await gallery({ action: "reorder", ids: [first.id, first.id] })).status,
    400,
  );
  for (let i = detail.gallery.photos.length; i < 9; i++) {
    assert.equal((await upload()).status, 200);
    detail = await get();
  }
  assert.equal((await upload()).status, 400);
  const userId = randomUUID();
  await pool.query(
    "INSERT INTO dl_avatar_assets(id,activity_id,actor,bytes,attached) VALUES($1,$2,$3,$4,true)",
    [
      userId,
      activity,
      actor,
      await sharp(source).resize(512, 512).webp().toBuffer(),
    ],
  );
  await pool.query(
    "UPDATE dl_activities SET state=jsonb_set(state,'{participants}',$2::jsonb) WHERE id=$1",
    [
      activity,
      JSON.stringify([{ id: actor, photo: { id: userId, screen: false } }]),
    ],
  );
  detail = await get();
  assert.equal(detail.gallery.photos.length, 10);
  assert.equal(
    detail.gallery.photos.filter(
      (p: { source: string }) => p.source === "agency",
    ).length,
    9,
  );
  assert.equal((await upload()).status, 400);
  assert.equal(
    (
      await action("preview", {
        draft: {
          ...draft,
          photoIds: detail.gallery.photos.map((p: { id: string }) => p.id),
        },
      })
    ).status,
    200,
  );
  assert.equal((await action("unpublish")).status, 200);
  assert.equal((await fetch(pub + "?image=" + first.id)).status, 404);
  // Old single-photo snapshots remain readable without an avatar-to-album migration.
  await pool.query(
    "UPDATE dl_agency_profiles SET published=true,snapshot=$3,photo=$4 WHERE activity_id=$1 AND actor=$2",
    [
      activity,
      actor,
      JSON.stringify({
        title: "历史编号",
        code: draft.code,
        photo: true,
        items: [],
      }),
      await sharp(source).resize(100, 100).webp().toBuffer(),
    ],
  );
  detail = await get();
  assert.equal(detail.management.legacyPhoto, true);
  assert.equal((await fetch(pub + "?photo=1")).status, 200);
  assert.equal(
    (await action("publish", { draft: { ...draft, photoIds: [] } })).status,
    400,
  );
  // Withdrawn records immediately deny every public and private photo route.
  await pool.query(
    "UPDATE dl_tongzhou_submissions SET record=jsonb_set(record,'{status}','\"withdrawn\"') WHERE activity_id=$1 AND actor=$2",
    [activity, actor],
  );
  assert.equal((await fetch(pub)).status, 404);
  assert.equal(
    (await fetch(origin + first.url, { headers: { Cookie: cookie } })).status,
    404,
  );
  console.log(
    JSON.stringify({
      testOnly: true,
      checks:
        "album isolation, size/type, orientation, EXIF removal, idempotency, races, nine-photo cap, scoped saves, public whitelist, snapshots, deletion, legacy and invalidation",
    }),
  );
});
