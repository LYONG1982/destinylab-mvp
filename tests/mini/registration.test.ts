import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import sharp from "sharp";
import { database } from "../../src/server/db";
import { emptyActivity } from "../../src/server/state";
import {
  miniLogin,
  miniIdentity,
  miniSession,
  miniEnter,
  entryCode,
  resolveScene,
} from "../../src/server/wechat-service";
import {
  registrationManage,
  registrationView,
} from "../../src/server/registration-service";
import { GET, POST } from "../../src/app/api/mini/[...path]/route";
import { emptyTongzhouProfile } from "../../src/domain/tongzhou";
import {
  REGISTRATION_CONSENT_VERSION,
  DEFAULT_REGISTRATION_CONFIG,
} from "../../src/domain/registration";
import { digest } from "../../src/server/service";
const dbUrl = new URL(process.env.DATABASE_URL || "http://invalid");
if (
  !["127.0.0.1", "localhost"].includes(dbUrl.hostname) ||
  !dbUrl.pathname.endsWith("_test")
)
  throw Error("Isolated local test database required");
const activity = `weapp-${randomBytes(5).toString("hex")}`;
const provider = async () => ({
  appid: process.env.DESTINY_WECHAT_APPID!,
  openid: "test_weapp_identity_01",
});
const code = () => randomBytes(20).toString("hex");
const id = () => "check-" + code();
function req(path: string, token = "", data?: object | Buffer, command = id()) {
  return new Request(
    `${process.env.DESTINY_PUBLIC_URL}/api/mini/${path}${path.includes("?") ? "&" : "?"}activity=${activity}`,
    {
      method: data === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Idempotency-Key": command,
      },
      body:
        data === undefined
          ? undefined
          : Buffer.isBuffer(data)
            ? new Uint8Array(data)
            : JSON.stringify(data),
    },
  );
}
async function api(
  path: string,
  token = "",
  data?: object | Buffer,
  command?: string,
) {
  const context = {
    params: Promise.resolve({ path: path.split("?")[0].split("/") }),
  };
  const r = await (data === undefined ? GET : POST)(
    req(path, token, data, command),
    context,
  );
  return {
    status: r.status,
    data: r.headers.get("content-type")?.includes("json")
      ? await r.json()
      : Buffer.from(await r.arrayBuffer()),
  };
}
after(async () => database().end());
test("native registration, admission, dual codes and privacy integration", async (t) => {
  for (const file of (await readdir("database"))
    .filter((n) => /^\d.*\.sql$/.test(n))
    .sort())
    await database().query(await readFile(`database/${file}`, "utf8"));
  const state = emptyActivity();
  await database().query("INSERT INTO dl_activities(id,state) VALUES($1,$2)", [
    activity,
    JSON.stringify(state),
  ]);
  await database().query(
    "INSERT INTO dl_registration_config(activity_id,config) VALUES($1,$2)",
    [activity, JSON.stringify({ ...DEFAULT_REGISTRATION_CONFIG, open: true })],
  );
  const [one, second] = await Promise.all([
    miniLogin(activity, code(), provider),
    miniLogin(activity, code(), provider),
  ]);
  let record: import("../../src/domain/registration").RegistrationRecord;
  const input = {
    nickname: "测试晴禾",
    birthDate: "1995-02-18",
    fields: {
      ...emptyTongzhouProfile(),
      realName: "测试姓名",
      phone: "13800000071",
      gender: "女",
      birthYear: "1995",
      city: "银川",
    },
    version: 0,
    consent: REGISTRATION_CONSENT_VERSION,
    agencyAllowed: false,
  };
  const count = async () =>
    (
      await database().query("SELECT state FROM dl_activities WHERE id=$1", [
        activity,
      ])
    ).rows[0].state.participants.length;
  await t.test(
    "login and repeated login never create participants; independent identity persists",
    async () => {
      assert.equal(one.identity, second.identity);
      assert.equal(await count(), 0);
      assert.equal(
        await miniIdentity(req("registration/me", one.token), activity),
        one.identity,
      );
      assert.equal((await api("snapshot", one.token)).status, 410);
      assert.equal((await api("registration/me", one.token)).data.record, null);
      assert.equal(await count(), 0);
    },
  );
  await t.test(
    "concurrent signup is idempotent and registration is private",
    async () => {
      const key = id();
      const results = await Promise.all([
        api("registration/save", one.token, input, key),
        api("registration/save", second.token, input, key),
      ]);
      assert.deepEqual(
        results.map((r) => r.status),
        [200, 200],
      );
      assert.equal(results[0].data.id, results[1].data.id);
      record = results[0].data;
      assert.match(record.receipt, /^\d{6}$/);
      assert.equal(record.zodiac, "水瓶座");
      assert.equal(await count(), 0);
      assert.equal(await count(), 0);
      const stranger = await miniLogin(activity, code(), async () => ({
        appid: process.env.DESTINY_WECHAT_APPID!,
        openid: "test_another_identity",
      }));
      assert.equal(
        (await api("registration/me", stranger.token)).data.record,
        null,
      );
      assert.equal(
        (await api("registration/save", stranger.token, input)).status,
        409,
      );
    },
  );
  await t.test(
    "three station saves, failed version, preview reads and return edits preserve server state",
    async () => {
      for (const [section, next, patch] of [
        ["life", "expectation", { occupation: "测试职业" }],
        ["expectation", "album", { expectations: "希望真诚相处" }],
        ["album", "preview", {}],
      ] as const) {
        const result = await api("registration/profile", one.token, {
          section,
          next,
          fields: patch,
          intent: "save",
          version: record.version,
        });
        assert.equal(result.status, 200);
        record = result.data;
      }
      const version = record.version;
      for (let i = 0; i < 3; i++)
        assert.equal(
          (await api("registration/me", second.token)).data.record.version,
          version,
        );
      const wrong = await api("registration/profile", one.token, {
        section: "life",
        next: "preview",
        fields: { occupation: "不应保存" },
        intent: "save",
        version: version - 1,
      });
      assert.equal(wrong.status, 409);
      assert.equal(
        (await api("registration/me", one.token)).data.record.fields.occupation,
        "测试职业",
      );
      const edited = await api("registration/profile", one.token, {
        section: "life",
        next: "preview",
        fields: { occupation: "修改后的职业" },
        intent: "save",
        version,
      });
      assert.equal(edited.status, 200);
      record = edited.data;
      assert.equal(record.profileProgress.current, "preview");
    },
  );
  await t.test(
    "album upload is retry safe; strangers cannot read private photos",
    async () => {
      const bytes = await sharp({
        create: { width: 32, height: 32, channels: 3, background: "#886677" },
      })
        .png()
        .toBuffer();
      const key = id(),
        path = `registration/upload?version=${record.version}`;
      const result = await api(path, one.token, bytes, key);
      assert.equal(result.status, 200);
      record = result.data;
      assert.equal(
        (await api(path, one.token, bytes, key)).data.photos.length,
        1,
      );
      assert.equal(
        (
          await api(
            `registration/photo?photo=${record.photos[0].id}`,
            one.token,
          )
        ).status,
        200,
      );
      const stranger = await miniLogin(activity, code(), async () => ({
        appid: process.env.DESTINY_WECHAT_APPID!,
        openid: "test_photo_stranger",
      }));
      assert.equal(
        (
          await api(
            `registration/photo?photo=${record.photos[0].id}`,
            stranger.token,
          )
        ).status,
        404,
      );
      assert.equal(
        (await api(`registration/photo?photo=${record.photos[0].id}`)).status,
        401,
      );
    },
  );
  await t.test(
    "staff verification then concurrent entry produces one actor; repeat login preserves it",
    async () => {
      await registrationManage(
        activity,
        {
          action: "checkin",
          id: record.id,
          version: record.version,
          receipt: record.receipt,
        },
        id(),
      );
      assert.equal(await count(), 0);
      const [a, b] = await Promise.all([
        miniEnter(one.identity, activity),
        miniEnter(one.identity, activity),
      ]);
      assert.equal(a.actor, b.actor);
      assert.equal(await count(), 1);
      const third = await miniLogin(activity, code(), provider);
      assert.equal(
        (await miniSession(req("snapshot", third.token), activity)).actor,
        a.actor,
      );
      assert.equal((await api("snapshot", third.token)).status, 200);
      const publicView = JSON.stringify(
        (await api("snapshot", third.token)).data,
      );
      assert.ok(!publicView.includes("1995-02-18"));
      assert.ok(!publicView.includes("13800000071"));
      assert.ok(!publicView.includes("测试姓名"));
    },
  );
  await t.test(
    "two entry codes have distinct scenes; old migration and operator boundary are preserved",
    async () => {
      const original = globalThis.fetch;
      const png = await sharp({
        create: { width: 10, height: 10, channels: 3, background: "#fff" },
      })
        .png()
        .toBuffer();
      const paths: string[] = [];
      globalThis.fetch = (async (
        url: string | URL | Request,
        options?: RequestInit,
      ) => {
        if (String(url).includes("stable_token"))
          return Response.json({
            access_token: "isolated_test_token",
            expires_in: 7200,
          });
        paths.push(JSON.parse(String(options?.body)).page);
        return new Response(new Uint8Array(png), {
          headers: { "Content-Type": "image/png" },
        });
      }) as typeof fetch;
      try {
        const a = await entryCode(activity, true, "registration"),
          b = await entryCode(activity, true, "encounter");
        assert.notEqual(a.scene, b.scene);
        assert.deepEqual(paths, [
          "pages/registration/index",
          "pages/encounter/index",
        ]);
        assert.deepEqual(await resolveScene(a.scene), {
          activity,
          entry: "registration",
        });
        assert.deepEqual(await resolveScene(b.scene), {
          activity,
          entry: "encounter",
        });
        await database().query(
          await readFile("database/012-mini-registration-entry.sql", "utf8"),
        );
        assert.equal(
          (await entryCode(activity, false, "encounter")).scene,
          b.scene,
        );
        assert.equal(
          (await api(`resolve?scene=${a.scene}`)).data.entry,
          "registration",
        );
        assert.equal((await api("code?entry=invalid")).status, 400);
        assert.notEqual(
          (await api("code?entry=registration", one.token, {})).status,
          200,
        );
      } finally {
        globalThis.fetch = original;
      }
    },
  );
  await t.test(
    "expired identity and another activity are rejected; reset preserves checkin and requires explicit re-entry",
    async () => {
      const invalid = req("registration/me", one.token);
      await assert.rejects(miniIdentity(invalid, "other-activity"), /登录/);
      const reset = emptyActivity();
      reset.revision = (
        await database().query("SELECT state FROM dl_activities WHERE id=$1", [
          activity,
        ])
      ).rows[0].state.revision;
      await database().query("UPDATE dl_activities SET state=$2 WHERE id=$1", [
        activity,
        JSON.stringify(reset),
      ]);
      assert.equal((await api("snapshot", one.token)).status, 410);
      assert.equal((await api("enter", one.token, {})).status, 200);
      assert.equal(
        (await api("registration/me", one.token)).data.record.effectiveStatus,
        "checked_in",
      );
      await database().query(
        "UPDATE dl_mini_identity_sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",
        [digest(one.token)],
      );
      assert.equal((await api("registration/me", one.token)).status, 401);
      assert.equal(
        (await registrationView(activity, `mini:${second.identity}`)).record
          ?.id,
        record.id,
      );
    },
  );
});
