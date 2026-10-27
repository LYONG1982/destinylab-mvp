import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { writeFileSync } from "node:fs";
import { database, transaction } from "../../src/server/db";
import { emptyActivity, newParticipant } from "../../src/server/state";
import { fieldAction, fieldPreview } from "../../src/server/field-service";
import { rejoinField } from "../../src/server/field-rejoin";
import { reenterField } from "../../src/server/field-reentry";
import {
  execute,
  load,
  save,
  snapshot,
  join,
  digest,
} from "../../src/server/service";
import { miniLogin, miniEnter } from "../../src/server/wechat-service";
import {
  registrationWrite,
  registrationView,
  registrationManage,
} from "../../src/server/registration-service";
import {
  DEFAULT_REGISTRATION_CONFIG,
  REGISTRATION_CONSENT_VERSION,
  REGISTRATION_AGENCY_CONSENT,
} from "../../src/domain/registration";
import {
  emptyTongzhouProfile,
  TONGZHOU_CONSENT_VERSION,
} from "../../src/domain/tongzhou";
import { tongzhouCommand } from "../../src/server/tongzhou-service";
import { uploadAvatar } from "../../src/server/avatar-service";
import {
  agencyDetail,
  agencyList,
  agencyAction,
  publishedProfile,
  publishedGalleryPhoto,
} from "../../src/server/agency-service";
import { galleryPhoto } from "../../src/server/agency-gallery";
import { POST, GET } from "../../src/app/api/field/[...path]/route";
const url = new URL(process.env.DATABASE_URL || "http://invalid");
if (
  !["127.0.0.1", "localhost"].includes(url.hostname) ||
  !url.pathname.endsWith("_test")
)
  throw Error("Isolated test DB only");
after(() => database().end());
const key = () => randomUUID();
const read = (a: string) => transaction((c) => load(c, a));
async function fixture() {
  const a = "field-" + key().slice(0, 8),
    s = emptyActivity();
  await database().query("INSERT INTO dl_activities(id,state) VALUES($1,$2)", [
    a,
    JSON.stringify(s),
  ]);
  await database().query(
    "INSERT INTO dl_registration_config(activity_id,config) VALUES($1,$2)",
    [a, JSON.stringify({ ...DEFAULT_REGISTRATION_CONFIG, open: true })],
  );
  return { a, s };
}
async function person(a: string, name = "测试清禾") {
  return transaction(async (c) => {
    const before = await load(c, a, true),
      next = structuredClone(before),
      p = newParticipant();
    Object.assign(p, {
      name,
      gender: "female",
      age: "26–29",
      avatarId: "female_01",
      profileComplete: true,
    });
    next.participants.push(p);
    next.scans.push(p.id);
    await save(c, a, before, next);
    return p;
  });
}
async function action(a: string, type: string, ids: string[] = []) {
  const s = await read(a),
    input = { action: type, ids, epoch: s.epoch };
  const p = await fieldPreview(a, input);
  return fieldAction(
    a,
    { ...input, preview: p.token, confirmation: a, cleared: true },
    key(),
  );
}
const fields = {
  ...emptyTongzhouProfile(),
  realName: "合成测试用户",
  phone: "13800000018",
  gender: "女",
  birthYear: "1995",
  city: "银川",
  ethnicity: "汉族",
  maritalStatus: "未婚",
};
test("field lifecycle, privacy preservation and admission", async (t) => {
  const f = await fixture(),
    other = await fixture();
  const auth = await miniLogin(f.a, key(), async () => ({
    appid: process.env.DESTINY_WECHAT_APPID!,
    openid: key(),
  }));
  let actor: string;
  await t.test(
    "unregistered mini identity enters independently and idempotently",
    async () => {
      const [a, b] = await Promise.all([
        miniEnter(auth.identity, f.a),
        miniEnter(auth.identity, f.a),
      ]);
      assert.equal(a.actor, b.actor);
      actor = a.actor;
      assert.equal((await read(f.a)).participants.length, 1);
      assert.equal(
        (await registrationView(f.a, "mini:" + auth.identity)).record,
        null,
      );
    },
  );
  const owner = "mini:" + auth.identity;
  let registration = await registrationWrite(
    f.a,
    owner,
    {
      fields,
      nickname: "测试清禾",
      birthDate: "1995-02-18",
      version: 0,
      consent: REGISTRATION_CONSENT_VERSION,
      agencyAllowed: true,
      agencyConsent: REGISTRATION_AGENCY_CONSENT,
    },
    key(),
  );
  // Reuse verified identity when registration is created after interaction.
  assert.equal(
    (
      await database().query(
        "SELECT participant_id FROM dl_registrations WHERE id=$1",
        [registration.id],
      )
    ).rows[0].participant_id,
    actor!,
  );
  registration = (await registrationView(f.a, owner)).record!;
  await registrationManage(
    f.a,
    {
      action: "checkin",
      id: registration.id,
      version: registration.version,
      receipt: registration.receipt,
    },
    key(),
  );
  const session = { actor: actor!, role: "participant" as const };
  await execute(
    f.a,
    session,
    {
      type: "profile",
      name: "测试清禾",
      gender: "female",
      age: "26–29",
      avatarId: "female_01",
      ready: false,
    },
    key(),
    f.s.epoch,
  );
  await tongzhouCommand(
    f.a,
    session,
    {
      epoch: f.s.epoch,
      command: {
        type: "tongzhou-submit",
        expectedVersion: 0,
        fields,
        consent: true,
        consentVersion: TONGZHOU_CONSENT_VERSION,
      },
    },
    key(),
  );
  const photo = await sharp({
    create: { width: 64, height: 64, channels: 3, background: "#800020" },
  })
    .png()
    .toBuffer();
  const asset = await uploadAvatar(f.a, session, photo);
  // Simulate a photo attached before custom uploads were disabled.
  await transaction(async (c) => {
    const before = await load(c, f.a, true),
      next = structuredClone(before);
    const me = next.participants.find((p) => p.id === actor)!;
    me.photo = { id: asset.id, screen: true };
    me.avatarVersion = 1;
    await c.query("UPDATE dl_avatar_assets SET attached=true WHERE id=$1", [
      asset.id,
    ]);
    await save(c, f.a, before, next);
  });
  const member = (await agencyList(f.a, "", 1, "", "", "")).records[0].actor;
  let d = await agencyDetail(f.a, member);
  const draft = {
    note: "清零后仍需跟进",
    signed: true,
    service: "active",
    nickname: "清禾",
    code: d.management.code,
    intro: "合成测试",
    fields: ["photo", "city"],
    photoIds: [asset.id],
  };
  await agencyAction(
    f.a,
    {
      actor: member,
      action: "save",
      scope: "followup",
      expectedVersion: d.management.version,
      sourceVersion: d.record.version,
      draft,
    },
    key(),
  );
  d = await agencyDetail(f.a, member);
  await agencyAction(
    f.a,
    {
      actor: member,
      action: "publish",
      confirmed: true,
      expectedVersion: d.management.version,
      sourceVersion: d.record.version,
      expectedGalleryVersion: d.gallery.version,
      expectedUserPhoto: d.gallery.userPhotoId,
      draft,
    },
    key(),
  );
  const published = await agencyDetail(f.a, member),
    slug = published.management.url.split("/").pop()!;
  const beforePhoto = await publishedGalleryPhoto(slug, asset.id);
  await t.test(
    "leave blocks profile/rediscovery/upload and administrator can restore",
    async () => {
      await action(f.a, "leave", [actor!]);
      await assert.rejects(
        execute(
          f.a,
          session,
          {
            type: "profile",
            name: "改名",
            gender: "female",
            age: "26–29",
            avatarId: "female_01",
            ready: true,
          },
          key(),
          f.s.epoch,
        ),
        /离场/,
      );
      await assert.rejects(uploadAvatar(f.a, session, photo), /离场/);
      assert.equal(
        (await agencyDetail(f.a, member)).management.note,
        draft.note,
      );
      await action(f.a, "return", [actor!]);
      assert.equal((await read(f.a)).participants[0].present, true);
    },
  );
  await t.test(
    "self reentry preserves registration, agency records and authorized published photo",
    async () => {
      const registrationBefore = (await registrationView(f.a, owner)).record;
      const agencyBefore = await agencyDetail(f.a, member);
      const publicBefore = await publishedProfile(slug);
      await action(f.a, "leave", [actor!]);
      await reenterField(
        f.a,
        session,
        { epoch: (await read(f.a)).epoch },
        key(),
      );
      assert.equal(
        (await read(f.a)).participants.find((p) => p.id === actor)!.present,
        true,
      );
      assert.deepEqual(
        (await registrationView(f.a, owner)).record,
        registrationBefore,
      );
      assert.deepEqual(await agencyDetail(f.a, member), agencyBefore);
      assert.deepEqual(await publishedProfile(slug), publicBefore);
      assert.deepEqual(
        await publishedGalleryPhoto(slug, asset.id),
        beforePhoto,
      );
    },
  );
  await t.test(
    "stale preview and unauthorised API cannot change data",
    async () => {
      const input = { action: "remove", ids: [actor!], epoch: f.s.epoch },
        p = await fieldPreview(f.a, input);
      await execute(
        f.a,
        session,
        { type: "answer", questionId: "q1", value: "慢慢熟悉" },
        key(),
        f.s.epoch,
      ).catch(() => {});
      await action(f.a, "leave", [actor!]);
      await assert.rejects(
        fieldAction(f.a, { ...input, preview: p.token }, key()),
        /变化/,
      );
      await action(f.a, "return", [actor!]);
      const response = await GET(
        new Request("http://localhost/api/field/overview?activity=" + f.a),
      );
      assert.equal(response.status, 401);
      const noAuth = await POST(
        new Request("http://localhost/api/field/action?activity=" + f.a, {
          method: "POST",
          body: JSON.stringify(input),
          headers: { "content-type": "application/json" },
        }),
        { params: Promise.resolve({ path: ["action"] }) },
      );
      assert.equal(noAuth.status, 401);
    },
  );
  const second = await person(f.a, "测试小溪");
  await t.test("batch removal is scoped, atomic and idempotent", async () => {
    await assert.rejects(action(f.a, "remove", [actor!, "missing"]), /变化/);
    assert.equal((await read(f.a)).participants.length, 2);
    const input = { action: "remove", ids: [second.id], epoch: f.s.epoch },
      p = await fieldPreview(f.a, input),
      id = key(),
      req = { ...input, preview: p.token };
    const one = await fieldAction(f.a, req, id);
    assert.deepEqual(await fieldAction(f.a, req, id), one);
    assert.equal((await read(f.a)).participants.length, 1);
    assert.equal((await read(other.a)).participants.length, 0);
  });
  await t.test(
    "removed rejoin preserves private records and updates only verified admission binding",
    async () => {
      const regBefore = (await registrationView(f.a, owner)).record!;
      const agencyBefore = await agencyDetail(f.a, member),
        publicBefore = await publishedProfile(slug);
      const oldActor = actor!;
      await action(f.a, "remove", [oldActor]);
      const rejoined = await rejoinField(
        f.a,
        { identity: auth.identity },
        { actor: oldActor, epoch: f.s.epoch },
      );
      actor = rejoined.session.actor;
      assert.notEqual(actor, oldActor);
      const regAfter = (await registrationView(f.a, owner)).record!;
      // Public form data/version/consent remain unchanged; the checked-in identity gets a new live link.
      assert.deepEqual({ ...regAfter, entered: regBefore.entered }, regBefore);
      const binding = (
        await database().query(
          "SELECT participant_id,participant_epoch FROM dl_registrations WHERE id=$1",
          [regBefore.id],
        )
      ).rows[0];
      assert.equal(binding.participant_id, actor);
      assert.equal(binding.participant_epoch, f.s.epoch);
      assert.deepEqual(await agencyDetail(f.a, member), agencyBefore);
      assert.deepEqual(await publishedProfile(slug), publicBefore);
      assert.deepEqual(
        await galleryPhoto(f.a, member, asset.id, false),
        beforePhoto,
      );
      assert.deepEqual(
        await publishedGalleryPhoto(slug, asset.id),
        beforePhoto,
      );
      const fresh = (await read(f.a)).participants[0];
      assert.equal(fresh.name, "");
      assert.deepEqual(fresh.answers, {});
      assert.ok(!fresh.photo);
    },
  );
  const regBefore = JSON.stringify((await registrationView(f.a, owner)).record),
    agencyBefore = JSON.stringify(await agencyDetail(f.a, member)),
    otherBefore = JSON.stringify(await read(other.a));
  await t.test(
    "reset requires closed field and explicit physical clearance",
    async () => {
      await assert.rejects(action(f.a, "reset"), /先关闭/);
      await action(f.a, "close");
      const input = { action: "reset", ids: [], epoch: f.s.epoch },
        p = await fieldPreview(f.a, input);
      await assert.rejects(
        fieldAction(
          f.a,
          { ...input, preview: p.token, confirmation: f.a },
          key(),
        ),
        /清场/,
      );
    },
  );
  await t.test(
    "reset preserves registration, institutional archive, photos and published URL",
    async () => {
      await action(f.a, "reset");
      const state = await read(f.a);
      assert.notEqual(state.epoch, f.s.epoch);
      assert.equal(state.participants.length, 0);
      assert.equal(state.fieldOpen, false);
      assert.ok(state.revision > f.s.revision);
      const reg = JSON.parse(regBefore),
        after = (await registrationView(f.a, owner)).record!;
      assert.deepEqual({ ...after, entered: reg.entered }, reg);
      const current = await agencyDetail(f.a, member);
      assert.deepEqual(current, JSON.parse(agencyBefore));
      assert.deepEqual(
        await galleryPhoto(f.a, member, asset.id, false),
        beforePhoto,
      );
      assert.deepEqual(
        await publishedGalleryPhoto(slug, asset.id),
        beforePhoto,
      );
      assert.equal((await publishedProfile(slug)).profile.title, "清禾");
      assert.equal(JSON.stringify(await read(other.a)), otherBefore);
    },
  );
  await t.test(
    "old identities cannot poll/replay into new round; entry is explicit",
    async () => {
      await assert.rejects(snapshot(f.a, "participant", session), /本轮/);
      await assert.rejects(miniEnter(auth.identity, f.a), /尚未开放/);
      const token = key().replaceAll("-", "") + "abcdefghijk";
      await database().query(
        "INSERT INTO dl_sessions VALUES($1,$2,'participant',$3,now()+interval '1 day',now())",
        [digest(token), f.a, actor!],
      );
      const request = new Request("http://localhost", {
        headers: { cookie: `dl-participant-${f.a}=${token}` },
      });
      await action(f.a, "open");
      await assert.rejects(join(request, f.a), /本轮/);
      assert.equal((await read(f.a)).participants.length, 0);
      await assert.rejects(
        execute(
          f.a,
          session,
          { type: "answer", questionId: "q1", value: "x" },
          key(),
          f.s.epoch,
        ),
      );
      const newSession = await miniEnter(auth.identity, f.a);
      assert.notEqual(newSession.actor, actor!);
      assert.equal((await read(f.a)).participants.length, 1);
    },
  );
  await t.test(
    "new activity is closed and contains no copied people",
    async () => {
      const newId = "field-new-" + key().slice(0, 8);
      await fieldAction(
        f.a,
        {
          action: "create",
          target: newId,
          copySettings: true,
          epoch: (await read(f.a)).epoch,
        },
        key(),
      );
      const created = await read(newId);
      assert.equal(created.fieldOpen, false);
      assert.equal(created.participants.length, 0);
      assert.equal(created.points.length, 30);
    },
  );
  if (process.env.FIELD_TEST_FIXTURE)
    writeFileSync(
      process.env.FIELD_TEST_FIXTURE,
      JSON.stringify({ activity: f.a, other: other.a, member, slug }),
      { mode: 0o600 },
    );
});

test("in-flight point ownership and cleanup remain consistent in every field phase", async () => {
  for (const status of [
    "SENT",
    "ACCEPTED",
    "MEET_ASSIGNED",
    "ARRIVING",
    "CONFIRMED",
    "MEET_FAILED",
    "CANCELLED",
  ] as const) {
    const { a } = await fixture();
    const p = await person(a),
      q = await person(a, "测试白杨");
    const id = key(),
      departed = ["ARRIVING", "CONFIRMED", "MEET_FAILED"].includes(status);
    await transaction(async (c) => {
      const before = await load(c, a, true),
        s = structuredClone(before);
      s.participants.forEach((p) => (p.currentId = id));
      s.invitations.push({
        id,
        from: p.id,
        to: q.id,
        status,
        createdAt: Date.now(),
        pointId: s.points[0].id,
        departures: departed ? { [p.id]: Date.now() } : {},
        arrivals: {},
        confirmations: {},
        common: [],
        choices: {},
        pass: "123456",
        code: "test",
      });
      s.points[0].occupant = id;
      s.helps.push({
        id: key(),
        participantId: q.id,
        invitationId: id,
        createdAt: Date.now(),
        status: "NEW",
        reply: "",
      });
      await save(c, a, before, s);
    });
    await action(a, "leave", [p.id]);
    let s = await read(a);
    assert.equal(s.participants.find((x) => x.id === p.id)!.present, false);
    assert.equal(s.helps[0].status, "RESOLVED");
    if (departed) assert.equal(s.points[0].occupant, id);
    await action(a, "remove", [p.id]);
    s = await read(a);
    assert.equal(s.invitations.length, 0);
    assert.equal(s.helps.length, 0);
    assert.equal(s.participants[0].currentId, null);
    assert.equal(s.points[0].occupant, null);
    if (departed) assert.equal(s.points[0].closed, true);
  }
});

test("failure while retaining an authorized photo rolls back all field changes", async () => {
  const { a } = await fixture(),
    p = await person(a);
  const session = { actor: p.id, role: "participant" as const };
  await tongzhouCommand(
    a,
    session,
    {
      epoch: (await read(a)).epoch,
      command: {
        type: "tongzhou-submit",
        expectedVersion: 0,
        fields,
        consent: true,
        consentVersion: TONGZHOU_CONSENT_VERSION,
      },
    },
    key(),
  );
  await transaction(async (c) => {
    const before = await load(c, a, true),
      s = structuredClone(before);
    s.participants[0].photo = { id: key(), screen: true };
    await save(c, a, before, s);
  });
  const before = JSON.stringify(await read(a));
  await assert.rejects(action(a, "remove", [p.id]), /照片暂不可保留/);
  assert.equal(JSON.stringify(await read(a)), before);
  assert.equal(
    (
      await database().query(
        "SELECT count(*)::int n FROM dl_field_archives WHERE activity_id=$1",
        [a],
      )
    ).rows[0].n,
    0,
  );
});
