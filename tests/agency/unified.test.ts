import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { database, transaction } from "../../src/server/db";
import { emptyActivity, newParticipant } from "../../src/server/state";
import { miniLogin, miniEnter } from "../../src/server/wechat-service";
import {
  registrationWrite,
  registrationManage,
  registrationView,
  registrationProfile,
  registrationUpload,
} from "../../src/server/registration-service";
import {
  agencyList,
  agencyDetail,
  agencyAction,
  publishedProfile,
  publishedGalleryPhoto,
} from "../../src/server/agency-service";
import {
  uploadAgencyPhoto,
  galleryPhoto,
} from "../../src/server/agency-gallery";
import { tongzhouCommand } from "../../src/server/tongzhou-service";
import {
  emptyTongzhouProfile,
  TONGZHOU_CONSENT_VERSION,
} from "../../src/domain/tongzhou";
import {
  DEFAULT_REGISTRATION_CONFIG,
  REGISTRATION_CONSENT_VERSION,
  REGISTRATION_AGENCY_CONSENT,
} from "../../src/domain/registration";
const url = new URL(process.env.DATABASE_URL || "http://invalid");
if (
  !["127.0.0.1", "localhost"].includes(url.hostname) ||
  !url.pathname.endsWith("_test")
)
  throw Error("Isolated test database required");
const key = () => randomUUID();
const list = (a: string) => agencyList(a, "", 1, "", "", "");
after(() => database().end());
async function fixture(allowed: boolean) {
  const activity = "unified-" + randomBytes(4).toString("hex"),
    state = emptyActivity();
  await database().query("INSERT INTO dl_activities(id,state) VALUES($1,$2)", [
    activity,
    JSON.stringify(state),
  ]);
  await database().query(
    "INSERT INTO dl_registration_config(activity_id,config) VALUES($1,$2)",
    [activity, JSON.stringify({ ...DEFAULT_REGISTRATION_CONFIG, open: true })],
  );
  const auth = await miniLogin(activity, key(), async () => ({
    appid: process.env.DESTINY_WECHAT_APPID!,
    openid: "test_" + activity,
  }));
  const fields = {
    ...emptyTongzhouProfile(),
    realName: "测试统一档案",
    phone: "13900000718",
    gender: "女",
    birthYear: "1995",
    city: "银川",
    occupation: "报名职业",
    ethnicity: "汉族",
    maritalStatus: "未婚",
  };
  const input = {
    nickname: "测试晴禾",
    birthDate: "1995-02-18",
    fields,
    version: 0,
    consent: REGISTRATION_CONSENT_VERSION,
    agencyAllowed: allowed,
    agencyConsent: REGISTRATION_AGENCY_CONSENT,
  };
  const owner = "mini:" + auth.identity;
  let registration = await registrationWrite(activity, owner, input, key());
  await registrationManage(
    activity,
    {
      action: "checkin",
      id: registration.id,
      receipt: registration.receipt,
      version: registration.version,
    },
    key(),
  );
  const session = await miniEnter(auth.identity, activity);
  registration = (await registrationView(activity, owner)).record!;
  return { activity, state, auth, owner, fields, input, registration, session };
}
function draft(d: Awaited<ReturnType<typeof agencyDetail>>) {
  const { note, signed, service, nickname, code, intro, fields, photoIds } =
    d.management;
  return { note, signed, service, nickname, code, intro, fields, photoIds };
}
async function saveFollowup(a: string, actor: string, note: string) {
  const d = await agencyDetail(a, actor);
  await agencyAction(
    a,
    {
      actor,
      action: "save",
      scope: "followup",
      expectedVersion: d.management.version,
      sourceVersion: d.record.version,
      draft: { ...draft(d), note, signed: true, service: "active" },
    },
    key(),
  );
}
async function submit(
  f: Awaited<ReturnType<typeof fixture>>,
  version = 0,
  occupation = "活动职业",
) {
  await tongzhouCommand(
    f.activity,
    f.session,
    {
      epoch: f.state.epoch,
      command: {
        type: "tongzhou-submit",
        expectedVersion: version,
        fields: { ...f.fields, occupation },
        consent: true,
        consentVersion: TONGZHOU_CONSENT_VERSION,
      },
    },
    key(),
  );
}
test("unified agency sources: identity, consent, management, photos and publication", async (t) => {
  for (const file of (await readdir("database"))
    .filter((n) => /^\d.*\.sql$/.test(n))
    .sort())
    await database().query(await readFile("database/" + file, "utf8"));
  const f = await fixture(true),
    actor = "registration:" + f.registration.id;
  await t.test(
    "registration authorization creates one member and preserves private birthday",
    async () => {
      const l = await list(f.activity);
      assert.equal(l.total, 1);
      assert.deepEqual(l.records[0].sources, ["registration"]);
      await saveFollowup(f.activity, actor, "报名沟通记录");
      const d = await agencyDetail(f.activity, actor);
      assert.ok(!JSON.stringify(d).includes("1995-02-18"));
    },
  );
  const bytes = await sharp({
    create: { width: 40, height: 40, channels: 3, background: "#884466" },
  })
    .png()
    .toBuffer();
  await t.test(
    "both entries share one member; fields, counters and staff follow-up persist",
    async () => {
      await submit(f);
      const l = await list(f.activity);
      assert.equal(l.total, 1);
      assert.equal(l.stats.female, 1);
      assert.deepEqual(l.records[0].sources, ["encounter", "registration"]);
      const d = await agencyDetail(f.activity, actor);
      assert.equal(d.record.fields?.occupation, "活动职业");
      assert.equal(d.management.note, "报名沟通记录");
      assert.equal(d.management.signed, true);
      const stale = d.record.version;
      await submit(f, 1, "活动更新职业");
      await assert.rejects(
        agencyAction(
          f.activity,
          {
            actor,
            action: "save",
            scope: "followup",
            sourceVersion: stale,
            expectedVersion: d.management.version,
            draft: draft(d),
          },
          key(),
        ),
        /已更新/,
      );
    },
  );
  await t.test(
    "registration edits update same archive; both source albums remain readable",
    async () => {
      f.registration = await registrationProfile(
        f.activity,
        f.owner,
        {
          section: "life",
          next: "preview",
          fields: { occupation: "报名再次更新" },
          intent: "save",
          version: f.registration.version,
        },
        key(),
      );
      f.registration = await registrationUpload(
        f.activity,
        f.owner,
        f.registration.version,
        key(),
        bytes,
      );
      let d = await agencyDetail(f.activity, actor);
      assert.equal(d.record.fields?.occupation, "报名再次更新");
      assert.equal(d.management.note, "报名沟通记录");
      await uploadAgencyPhoto(
        f.activity,
        actor,
        d.gallery.version,
        key(),
        bytes,
      );
      d = await agencyDetail(f.activity, actor);
      assert.equal(d.gallery.photos.length, 2);
      for (const photo of d.gallery.photos)
        assert.ok(
          (await galleryPhoto(f.activity, actor, photo.id, false)).length > 0,
        );
    },
  );
  await t.test(
    "public profile excludes name, phone and full birthday; update unpublishes",
    async () => {
      const d = await agencyDetail(f.activity, actor);
      await agencyAction(
        f.activity,
        {
          actor,
          action: "publish",
          confirmed: true,
          sourceVersion: d.record.version,
          expectedVersion: d.management.version,
          expectedGalleryVersion: d.gallery.version,
          expectedUserPhoto: d.gallery.userPhotoId,
          draft: {
            ...draft(d),
            nickname: "测试公开昵称",
            photoIds: d.gallery.photos.map((p) => p.id),
          },
        },
        key(),
      );
      const slug = (await agencyDetail(f.activity, actor)).management.url
        .split("/")
        .pop()!;
      const pub = await publishedProfile(slug);
      assert.equal(pub.profile.title, "测试公开昵称");
      for (const privateValue of [
        f.fields.realName,
        f.fields.phone,
        "1995-02-18",
        "报名沟通记录",
      ])
        assert.ok(!JSON.stringify(pub.profile).includes(privateValue));
      assert.ok(
        (await publishedGalleryPhoto(slug, d.gallery.photos[0].id)).length > 0,
      );
      await submit(f, 2, "再提交");
      await assert.rejects(publishedProfile(slug), /下架/);
    },
  );
  await t.test(
    "one withdrawn source is hidden; the other authorized source remains",
    async () => {
      await tongzhouCommand(
        f.activity,
        f.session,
        {
          epoch: f.state.epoch,
          command: { type: "tongzhou-withdraw", expectedVersion: 3 },
        },
        key(),
      );
      const l = await list(f.activity);
      assert.equal(l.total, 1);
      assert.deepEqual(l.records[0].sources, ["registration"]);
      const d = await agencyDetail(f.activity, actor);
      assert.equal(d.record.fields?.occupation, "报名再次更新");
      assert.equal(d.management.note, "报名沟通记录");
    },
  );
  await t.test(
    "no authorization creates no archive; activity-first then registration still one",
    async () => {
      const b = await fixture(false);
      assert.equal((await list(b.activity)).total, 0);
      await submit(b);
      await saveFollowup(b.activity, b.session.actor, "活动先行备注");
      b.registration = await registrationWrite(
        b.activity,
        b.owner,
        { ...b.input, version: b.registration.version, agencyAllowed: true },
        key(),
      );
      const l = await list(b.activity);
      assert.equal(l.total, 1);
      assert.equal(l.records[0].actor, b.session.actor);
      assert.equal(
        (await agencyDetail(b.activity, b.session.actor)).management.note,
        "活动先行备注",
      );
      await tongzhouCommand(
        b.activity,
        b.session,
        {
          epoch: b.state.epoch,
          command: { type: "tongzhou-withdraw", expectedVersion: 1 },
        },
        key(),
      );
      assert.equal((await list(b.activity)).total, 1);
      // Canonical source can be withdrawn while the registration remains active.
      const remaining = await agencyDetail(b.activity, b.session.actor);
      const album = await uploadAgencyPhoto(
        b.activity,
        b.session.actor,
        remaining.gallery.version,
        key(),
        bytes,
      );
      assert.equal(album.photos.length, 1);
      assert.ok(
        (
          await galleryPhoto(
            b.activity,
            b.session.actor,
            album.photos[0].id,
            false,
          )
        ).length,
      );
      await registrationWrite(
        b.activity,
        b.owner,
        { ...b.input, version: b.registration.version, agencyAllowed: false },
        key(),
      );
      assert.equal((await list(b.activity)).total, 0);
    },
  );
  await t.test("unrelated actor with same phone is never merged", async () => {
    const p = newParticipant();
    await transaction(async (c) => {
      const r = await c.query(
        "SELECT state FROM dl_activities WHERE id=$1 FOR UPDATE",
        [f.activity],
      );
      const state = r.rows[0].state;
      state.participants.push(p);
      await c.query("UPDATE dl_activities SET state=$2 WHERE id=$1", [
        f.activity,
        JSON.stringify(state),
      ]);
    });
    await tongzhouCommand(
      f.activity,
      { actor: p.id, role: "participant" },
      {
        epoch: f.state.epoch,
        command: {
          type: "tongzhou-submit",
          expectedVersion: 0,
          fields: f.fields,
          consent: true,
          consentVersion: TONGZHOU_CONSENT_VERSION,
        },
      },
      key(),
    );
    assert.equal((await list(f.activity)).total, 2);
  });
  await t.test(
    "migration is repeatable and keeps legacy management histories and photos",
    async () => {
      const before = await agencyDetail(f.activity, actor);
      const sql = await readFile(
        "database/014-agency-unified-members.sql",
        "utf8",
      );
      await database().query(sql);
      await database().query(sql);
      const after = await agencyDetail(f.activity, actor);
      assert.equal(after.management.note, before.management.note);
      assert.equal(after.gallery.photos.length, before.gallery.photos.length);
      assert.equal(after.record.version, before.record.version);
    },
  );
  await t.test(
    "legacy duplicate backfill preserves both follow-ups, albums and old URL",
    async () => {
      const b = await fixture(true);
      await submit(b);
      const regActor = "registration:" + b.registration.id;
      await saveFollowup(b.activity, regActor, "原报名备注");
      // Recreate pre-upgrade duplicate management without changing any other activity.
      await database().query(
        "DELETE FROM dl_agency_source_links WHERE activity_id=$1",
        [b.activity],
      );
      await saveFollowup(b.activity, b.session.actor, "原活动备注");
      let d = await agencyDetail(b.activity, b.session.actor);
      await uploadAgencyPhoto(
        b.activity,
        b.session.actor,
        d.gallery.version,
        key(),
        bytes,
      );
      d = await agencyDetail(b.activity, b.session.actor);
      const oldSlug = d.management.url.split("/").pop()!;
      assert.equal((await list(b.activity)).total, 2);
      await database().query("SELECT dl_refresh_agency_members($1)", [
        b.activity,
      ]);
      assert.equal((await list(b.activity)).total, 1);
      d = await agencyDetail(b.activity, regActor);
      assert.ok(d.management.note.includes("原报名备注"));
      assert.ok(d.management.note.includes("原活动备注"));
      assert.equal(d.history[0].note, "原活动备注");
      assert.equal(d.gallery.photos.length, 1);
      assert.ok(
        (
          await galleryPhoto(
            b.activity,
            regActor,
            d.gallery.photos[0].id,
            false,
          )
        ).length,
      );
      await agencyAction(
        b.activity,
        {
          actor: regActor,
          action: "publish",
          confirmed: true,
          sourceVersion: d.record.version,
          expectedVersion: d.management.version,
          expectedGalleryVersion: d.gallery.version,
          expectedUserPhoto: d.gallery.userPhotoId,
          draft: {
            ...draft(d),
            nickname: "合并后昵称",
            photoIds: d.gallery.photos.map((p) => p.id),
          },
        },
        key(),
      );
      assert.equal(
        (await publishedProfile(oldSlug)).profile.title,
        "合并后昵称",
      );
      assert.ok(
        (await publishedGalleryPhoto(oldSlug, d.gallery.photos[0].id)).length,
      );
    },
  );
  if (process.env.AGENCY_UNIFIED_FIXTURE) {
    const ui = await fixture(true);
    await saveFollowup(
      ui.activity,
      "registration:" + ui.registration.id,
      "Playwright 原备注",
    );
    await writeFile(
      process.env.AGENCY_UNIFIED_FIXTURE,
      JSON.stringify({
        activity: ui.activity,
        actor: "registration:" + ui.registration.id,
        token: ui.auth.token,
        fields: ui.fields,
        epoch: ui.state.epoch,
      }),
      { mode: 0o600 },
    );
  }
});
