import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import {
  allocateRegistrationReceipt,
  migrateRegistrationReceipts,
} from "../../src/server/registration-receipt";
import { database, transaction } from "../../src/server/db";
import { emptyActivity, newParticipant } from "../../src/server/state";
import { digest } from "../../src/server/service";
import { emptyTongzhouProfile } from "../../src/domain/tongzhou";
import {
  DEFAULT_REGISTRATION_CONFIG,
  REGISTRATION_AGENCY_CONSENT,
  REGISTRATION_CONSENT_VERSION,
} from "../../src/domain/registration";
import {
  registrationProfile,
  registrationSession,
  registrationView,
  registrationWrite,
  registrationUpload,
  registrationPhoto,
  registrationDeletePhoto,
  registrationManage,
  registrationList,
  registrationDetail,
  registrationEnter,
} from "../../src/server/registration-service";
import { agencyDetail, agencyList } from "../../src/server/agency-service";
if (
  !["/destiny_wall_test", "/destiny_weapp_release_test"].includes(
    new URL(process.env.DATABASE_URL!).pathname,
  ) ||
  !["127.0.0.1", "localhost"].includes(
    new URL(process.env.DATABASE_URL!).hostname,
  )
)
  throw Error("Isolated database required");
const db = database(),
  activity = "reg-" + randomUUID().slice(0, 8),
  state = emptyActivity();
const request = (cookie = "") =>
  new Request("http://127.0.0.1:3241", { headers: { cookie } });
const configuration = {
  ...DEFAULT_REGISTRATION_CONFIG,
  title: "爱在凤城 · 初冬有约",
  headline: "认真遇见一个人",
  date: "2026年11月6日 — 11月8日",
  location: "银川市兴庆区鼓楼步行街",
  description: "给自己一次机会，让相遇慢慢发生。",
  open: true,
};
after(() => db.end());
test("registration isolated lifecycle, consent projection, uploads, idempotency, checkin and reset", async () => {
  await db.query(readFileSync("database/008-registration.sql", "utf8"));
  await db.query(
    readFileSync("database/009-registration-receipts.sql", "utf8"),
  );
  await db.query(
    readFileSync("database/010-registration-profile-progress.sql", "utf8"),
  );
  await db.query(
    readFileSync("database/011-registration-birth-date.sql", "utf8"),
  );
  await db.query("INSERT INTO dl_activities(id,state) VALUES($1,$2)", [
    activity,
    JSON.stringify(state),
  ]);
  await registrationManage(
    activity,
    { action: "config", config: configuration },
    randomUUID(),
  );
  const s = await registrationSession(request(), activity, true),
    cookie = `dl-registration-${activity}=${s.token}`;
  assert.equal((await registrationView(activity, s.token_hash)).record, null);
  const input = {
    nickname: "清禾",
    fields: {
      ...emptyTongzhouProfile(),
      gender: "女",
      birthYear: "1996",
      city: "银川",
      phone: "13800138111",
    },
    version: 0,
    consent: REGISTRATION_CONSENT_VERSION,
    agencyAllowed: false,
  };
  await assert.rejects(
    registrationWrite(
      activity,
      s.token_hash,
      { ...input, consent: "" },
      randomUUID(),
    ),
    /须知/,
  );
  const cmd = randomUUID();
  let r = await registrationWrite(activity, s.token_hash, input, cmd);
  const replay = await registrationWrite(activity, s.token_hash, input, cmd);
  assert.match(r.receipt, /^[1-9][0-9]{5}$/);
  assert.equal(replay.receipt, r.receipt);
  const legacy = randomBytes(8).toString("hex").toUpperCase();
  await db.query("UPDATE dl_registrations SET receipt=$2 WHERE id=$1", [
    r.id,
    legacy,
  ]);
  const beforeMigration = (
    await db.query(
      "SELECT to_jsonb(r)-'receipt'-'legacy_receipt' AS data FROM dl_registrations r WHERE id=$1",
      [r.id],
    )
  ).rows[0].data;
  assert.ok((await migrateRegistrationReceipts()).migrated >= 1);
  assert.equal((await migrateRegistrationReceipts()).migrated, 0);
  const migrated = (
    await db.query(
      "SELECT receipt,legacy_receipt,to_jsonb(r)-'receipt'-'legacy_receipt' AS data FROM dl_registrations r WHERE id=$1",
      [r.id],
    )
  ).rows[0];
  assert.deepEqual(migrated.data, beforeMigration);
  assert.equal(migrated.legacy_receipt, legacy);
  assert.match(migrated.receipt, /^[1-9][0-9]{5}$/);
  r = (await registrationView(activity, s.token_hash)).record!;
  assert.equal(r.receipt, migrated.receipt);
  assert.equal(
    (await registrationWrite(activity, s.token_hash, input, cmd)).receipt,
    r.receipt,
  );
  assert.equal(
    (await registrationList(activity, legacy.toLowerCase(), 1)).total,
    1,
  );
  assert.equal((await registrationList(activity, r.receipt, 1)).total, 1);
  // Exercise a real database unique collision, then retry in the same transaction.
  const collisionId = randomUUID();
  let attempts = 0;
  await transaction(async (c) => {
    await allocateRegistrationReceipt(
      async (candidate) => {
        attempts++;
        const result = await c.query(
          "INSERT INTO dl_registrations(id,activity_id,nickname,fields,receipt,consent_version) VALUES($1,$2,'collision-test',$3,$4,$5) ON CONFLICT(receipt) DO NOTHING RETURNING id",
          [
            collisionId,
            activity,
            JSON.stringify({ ...input.fields, phone: "13800138999" }),
            candidate,
            REGISTRATION_CONSENT_VERSION,
          ],
        );
        return result.rowCount === 1;
      },
      () =>
        attempts === 0
          ? r.receipt
          : String(100000 + Math.floor(Math.random() * 900000)),
    );
    assert.ok(attempts >= 2);
    await c.query("DELETE FROM dl_registrations WHERE id=$1", [collisionId]);
  });
  let exhausted = 0;
  await assert.rejects(
    allocateRegistrationReceipt(async () => {
      exhausted++;
      return false;
    }),
    /暂时无法分配/,
  );
  assert.equal(exhausted, 100);
  assert.equal(replay.id, r.id);
  assert.equal(replay.version, r.version);
  await assert.rejects(
    registrationWrite(
      activity,
      s.token_hash,
      { ...input, nickname: "静安" },
      cmd,
    ),
    /不一致/,
  );
  assert.equal((await agencyList(activity, "", 1, "", "", "")).total, 0);
  const data = () =>
    db.query("SELECT state FROM dl_activities WHERE id=$1", [activity]);
  assert.equal((await data()).rows[0].state.participants.length, 0);
  await assert.rejects(
    registrationEnter(activity, s.token_hash, request(cookie)),
    /核验签到/,
  );
  const other = await registrationSession(request(), activity, true);
  await assert.rejects(
    registrationWrite(activity, other.token_hash, input, randomUUID()),
    /已报名/,
  );
  await assert.rejects(
    registrationSession(request(cookie), "different"),
    /会话/,
  );
  const img = await sharp({
    create: { width: 80, height: 100, channels: 3, background: "#aa7777" },
  })
    .png()
    .toBuffer();
  r = await registrationUpload(
    activity,
    s.token_hash,
    r.version,
    randomUUID(),
    img,
  );
  assert.equal(r.photos.length, 1);
  await assert.rejects(
    registrationPhoto(activity, other.token_hash, r.photos[0].id, true),
    /无权/,
  );
  const photo = await registrationPhoto(
    activity,
    s.token_hash,
    r.photos[0].id,
    false,
  );
  assert.equal((await sharp(photo).metadata()).format, "webp");
  await assert.rejects(
    registrationUpload(
      activity,
      s.token_hash,
      r.version,
      randomUUID(),
      Buffer.from("invalid"),
    ),
    /静态照片/,
  );
  await assert.rejects(
    registrationWrite(
      activity,
      s.token_hash,
      { ...input, version: r.version, agencyAllowed: true },
      randomUUID(),
    ),
    /授权/,
  );
  r = await registrationWrite(
    activity,
    s.token_hash,
    {
      ...input,
      version: r.version,
      agencyAllowed: true,
      agencyConsent: REGISTRATION_AGENCY_CONSENT,
      fields: {
        ...input.fields,
        occupation: "设计师",
        expectations: "一起发现生活的小美好",
      },
    },
    randomUUID(),
  );
  const profileBefore = { ...r.fields },
    receiptBefore = r.receipt;
  const profileCommand = randomUUID();
  const patch = {
    section: "life",
    intent: "save",
    next: "expectation",
    fields: { education: "本科" },
    version: r.version,
  };
  r = await registrationProfile(activity, s.token_hash, patch, profileCommand);
  assert.equal(r.fields.education, "本科");
  assert.equal(r.fields.expectations, profileBefore.expectations);
  assert.equal(r.receipt, receiptBefore);
  assert.equal(r.profileProgress.current, "expectation");
  assert.deepEqual(r.profileProgress.saved, ["life"]);
  assert.equal(
    (await registrationProfile(activity, s.token_hash, patch, profileCommand))
      .version,
    r.version,
  );
  await assert.rejects(
    registrationProfile(
      activity,
      s.token_hash,
      { ...patch, version: r.version, fields: { phone: "13900000000" } },
      randomUUID(),
    ),
    /无效字段/,
  );
  await assert.rejects(
    registrationProfile(
      activity,
      s.token_hash,
      { ...patch, version: r.version, fields: { height: "999" } },
      randomUUID(),
    ),
    /身高/,
  );
  await assert.rejects(
    registrationProfile(
      activity,
      other.token_hash,
      { ...patch, version: r.version },
      randomUUID(),
    ),
    /报名/,
  );
  await assert.rejects(
    registrationProfile(
      activity,
      s.token_hash,
      { ...patch, version: r.version - 1 },
      randomUUID(),
    ),
    /已更新/,
  );
  const agencyBefore = (
    await db.query(
      "SELECT record FROM dl_tongzhou_submissions WHERE actor=$1",
      ["registration:" + r.id],
    )
  ).rows[0];
  await db.query(
    "UPDATE dl_agency_profiles SET published=true WHERE actor=$1",
    ["registration:" + r.id],
  );
  r = await registrationProfile(
    activity,
    s.token_hash,
    {
      section: "expectation",
      intent: "visit",
      next: "album",
      fields: {},
      version: r.version,
    },
    randomUUID(),
  );
  assert.equal(
    (
      await db.query(
        "SELECT published FROM dl_agency_profiles WHERE actor=$1",
        ["registration:" + r.id],
      )
    ).rows[0].published,
    true,
  );
  r = await registrationProfile(
    activity,
    s.token_hash,
    {
      section: "preview",
      intent: "confirm",
      next: "preview",
      fields: {},
      version: r.version,
    },
    randomUUID(),
  );
  assert.ok(r.profileConfirmedAt);
  assert.deepEqual(
    (
      await db.query(
        "SELECT record FROM dl_tongzhou_submissions WHERE actor=$1",
        ["registration:" + r.id],
      )
    ).rows[0],
    agencyBefore,
  );
  assert.equal(
    (
      await db.query(
        "SELECT published FROM dl_agency_profiles WHERE actor=$1",
        ["registration:" + r.id],
      )
    ).rows[0].published,
    true,
  );
  r = await registrationProfile(
    activity,
    s.token_hash,
    {
      section: "expectation",
      intent: "save",
      next: "preview",
      fields: { family: "温暖融洽" },
      version: r.version,
    },
    randomUUID(),
  );
  assert.equal(r.fields.education, "本科");
  assert.equal(
    (
      await db.query(
        "SELECT published FROM dl_agency_profiles WHERE actor=$1",
        ["registration:" + r.id],
      )
    ).rows[0].published,
    false,
  );
  const actor = "registration:" + r.id;
  const agency = await agencyDetail(activity, actor);
  assert.equal(agency.record.fields?.occupation, "设计师");
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM dl_agency_photos WHERE actor=$1",
        [actor],
      )
    ).rows[0].n,
    1,
  );
  await db.query(
    "UPDATE dl_agency_profiles SET note='staff-note',signed=true WHERE actor=$1",
    [actor],
  );
  await assert.rejects(
    registrationWrite(
      activity,
      s.token_hash,
      { ...input, version: r.version - 1 },
      randomUUID(),
    ),
    /已更新/,
  );
  const results = await Promise.allSettled(
    [1, 2].map(() =>
      registrationWrite(
        activity,
        s.token_hash,
        {
          ...input,
          version: r.version,
          agencyAllowed: true,
          agencyConsent: REGISTRATION_AGENCY_CONSENT,
        },
        randomUUID(),
      ),
    ),
  );
  assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
  r = (await registrationView(activity, s.token_hash)).record!;
  const staff = (
    await db.query(
      "SELECT note,signed FROM dl_agency_profiles WHERE actor=$1",
      [actor],
    )
  ).rows[0];
  assert.equal(staff.note, "staff-note");
  assert.equal(staff.signed, true);
  assert.equal((await data()).rows[0].state.participants.length, 0);
  await assert.rejects(
    registrationManage(
      activity,
      { action: "checkin", id: r.id, version: r.version, receipt: "BAD" },
      randomUUID(),
    ),
    /凭证/,
  );
  for (const invalid of [
    "12345",
    "1234567",
    "012345",
    "ABCDEF",
    "FFFFFFFFFFFFFFFF",
  ]) {
    await assert.rejects(
      registrationManage(
        activity,
        { action: "checkin", id: r.id, version: r.version, receipt: invalid },
        randomUUID(),
      ),
      /凭证/,
    );
  }
  const foreign = "foreign-" + randomUUID().slice(0, 8);
  await db.query("INSERT INTO dl_activities(id,state) VALUES($1,$2)", [
    foreign,
    JSON.stringify(emptyActivity()),
  ]);
  await assert.rejects(
    registrationManage(
      foreign,
      { action: "checkin", id: r.id, version: r.version, receipt: r.receipt },
      randomUUID(),
    ),
    /不存在/,
  );
  await registrationManage(
    activity,
    { action: "checkin", id: r.id, version: r.version, receipt: legacy },
    randomUUID(),
  );
  assert.equal((await data()).rows[0].state.participants.length, 0);
  await Promise.all([
    registrationEnter(activity, s.token_hash, request(cookie)),
    registrationEnter(activity, s.token_hash, request(cookie)),
  ]);
  let saved = (await data()).rows[0].state;
  assert.equal(saved.participants.length, 1);
  assert.equal(saved.scans.length, 1);
  assert.ok(!JSON.stringify(saved).includes(input.fields.phone));
  assert.ok(!JSON.stringify(saved).includes(input.fields.birthYear));
  assert.equal(saved.participants[0].name, "清禾");
  r = (await registrationView(activity, s.token_hash)).record!;
  await assert.rejects(
    registrationManage(
      activity,
      { action: "cancel", id: r.id, version: r.version },
      randomUUID(),
    ),
    /离场/,
  );
  const reset = emptyActivity();
  reset.revision = saved.revision;
  await db.query("UPDATE dl_activities SET state=$2 WHERE id=$1", [
    activity,
    JSON.stringify(reset),
  ]);
  await assert.rejects(
    registrationEnter(activity, s.token_hash, request(cookie)),
    /重新签到/,
  );
  assert.equal(
    (await registrationView(activity, s.token_hash)).record?.effectiveStatus,
    "registered",
  );
  await registrationManage(
    activity,
    { action: "checkin", id: r.id, version: r.version, receipt: r.receipt },
    randomUUID(),
  );
  await registrationEnter(activity, s.token_hash, request(cookie));
  assert.equal((await data()).rows[0].state.participants.length, 1);
  r = (await registrationView(activity, s.token_hash)).record!;
  r = await registrationDeletePhoto(
    activity,
    s.token_hash,
    { photo: r.photos[0].id, version: r.version },
    randomUUID(),
  );
  assert.equal(r.photos.length, 0);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM dl_agency_photos WHERE actor=$1",
        [actor],
      )
    ).rows[0].n,
    0,
  );
  r = await registrationWrite(
    activity,
    s.token_hash,
    { ...input, version: r.version, agencyAllowed: false },
    randomUUID(),
  );
  await assert.rejects(agencyDetail(activity, actor), /不可查看/);
  assert.equal((await registrationList(activity, "清禾", 1)).total, 1);
  assert.ok(
    (await registrationList(activity, "", 1)).items[0].phone.includes("****"),
  );
  assert.equal(
    (await registrationDetail(activity, r.id)).fields.phone,
    input.fields.phone,
  );
  // A separately authenticated, pre-existing event identity keeps answers when entering.
  const p = newParticipant();
  p.answers = { q1: "保留原答题" };
  saved = (await data()).rows[0].state;
  saved.participants.push(p);
  await db.query("UPDATE dl_activities SET state=$2 WHERE id=$1", [
    activity,
    JSON.stringify(saved),
  ]);
  const token = randomBytes(32).toString("base64url");
  await db.query(
    "INSERT INTO dl_sessions(token_hash,activity_id,role,actor,expires_at) VALUES($1,$2,'participant',$3,now()+interval '1 day')",
    [digest(token), activity, p.id],
  );
  const second = await registrationSession(request(), activity, true);
  const r2 = await registrationWrite(
    activity,
    second.token_hash,
    {
      ...input,
      nickname: "知夏",
      fields: { ...input.fields, phone: "13800138112" },
    },
    randomUUID(),
  );
  await registrationManage(
    activity,
    { action: "checkin", id: r2.id, version: r2.version, receipt: r2.receipt },
    randomUUID(),
  );
  await registrationEnter(
    activity,
    second.token_hash,
    request(`dl-participant-${activity}=${token}`),
  );
  saved = (await data()).rows[0].state;
  assert.equal(saved.participants.length, 2);
  assert.equal(
    saved.participants.find((x: { id: string }) => x.id === p.id).answers.q1,
    "保留原答题",
  );
  const third = await registrationSession(request(), activity, true);
  const r3 = await registrationWrite(
    activity,
    third.token_hash,
    {
      ...input,
      nickname: "夏语",
      fields: { ...input.fields, phone: "13800138113" },
    },
    randomUUID(),
  );
  await registrationManage(
    activity,
    { action: "cancel", id: r3.id, version: r3.version },
    randomUUID(),
  );
  await assert.rejects(
    registrationEnter(activity, third.token_hash, request()),
    /核验签到/,
  );
  if (process.env.REGISTRATION_TEST_DIR)
    writeFileSync(
      process.env.REGISTRATION_TEST_DIR + "/fixture.json",
      JSON.stringify({
        activity,
        configuration,
        legacy: { id: r.id, receipt: legacy, nickname: "清禾" },
      }),
      { mode: 0o600 },
    );
});

test("private birthday survives retries and legacy edits, enforces version and does not project to agency", async () => {
  const id = "birthday-" + randomUUID().slice(0, 8);
  await db.query("INSERT INTO dl_activities(id,state) VALUES($1,$2)", [
    id,
    JSON.stringify(emptyActivity()),
  ]);
  await registrationManage(
    id,
    { action: "config", config: configuration },
    randomUUID(),
  );
  const session = await registrationSession(request(), id, true);
  const body = {
    nickname: "星禾",
    fields: {
      ...emptyTongzhouProfile(),
      gender: "女",
      birthYear: "1996",
      city: "银川",
      phone: "13800138222",
    },
    birthDate: "1996-02-29",
    version: 0,
    consent: REGISTRATION_CONSENT_VERSION,
    agencyAllowed: true,
    agencyConsent: REGISTRATION_AGENCY_CONSENT,
  };
  const key = randomUUID();
  let r = await registrationWrite(id, session.token_hash, body, key);
  assert.equal(r.birthDate, "1996-02-29");
  assert.equal(r.zodiac, "双鱼座");
  const again = await registrationWrite(id, session.token_hash, body, key);
  assert.equal(again.version, r.version);
  assert.equal(again.birthDate, r.birthDate);
  assert.equal(
    (await registrationView(id, session.token_hash)).record!.birthDate,
    r.birthDate,
  );
  const projected = (
    await db.query(
      "SELECT record FROM dl_tongzhou_submissions WHERE activity_id=$1",
      [id],
    )
  ).rows;
  assert.ok(!JSON.stringify(projected).includes("1996-02-29"));
  assert.ok(!JSON.stringify(projected).includes("birthDate"));
  assert.ok(
    !JSON.stringify(await registrationList(id, "", 1)).includes("1996-02-29"),
  );
  await assert.rejects(
    registrationWrite(
      id,
      session.token_hash,
      { ...body, birthDate: "1996-04-31", version: r.version },
      randomUUID(),
    ),
    /有效/,
  );
  await assert.rejects(
    registrationWrite(
      id,
      session.token_hash,
      { ...body, birthDate: "1995-02-28", version: r.version },
      randomUUID(),
    ),
    /不一致/,
  );
  await assert.rejects(
    registrationWrite(
      id,
      session.token_hash,
      { ...body, birthDate: "1996-10-13", version: 0 },
      randomUUID(),
    ),
    /已更新/,
  );
  assert.equal(
    (await registrationView(id, session.token_hash)).record!.version,
    r.version,
  );
  const oldClient: Partial<typeof body> = { ...body };
  delete oldClient.birthDate;
  r = await registrationWrite(
    id,
    session.token_hash,
    { ...oldClient, version: r.version },
    randomUUID(),
  );
  assert.equal(r.birthDate, "1996-02-29");
  r = await registrationProfile(
    id,
    session.token_hash,
    {
      section: "life",
      next: "expectation",
      intent: "save",
      version: r.version,
      fields: { realName: "测试姓名" },
    },
    randomUUID(),
  );
  assert.equal(r.birthDate, "1996-02-29");
  r = await registrationWrite(
    id,
    session.token_hash,
    { ...body, fields: r.fields, birthDate: "1996-10-13", version: r.version },
    randomUUID(),
  );
  assert.equal(r.zodiac, "天秤座");
  r = await registrationWrite(
    id,
    session.token_hash,
    { ...body, birthDate: null, version: r.version },
    randomUUID(),
  );
  assert.equal(r.birthDate, null);
  assert.equal(r.zodiac, null);
});
