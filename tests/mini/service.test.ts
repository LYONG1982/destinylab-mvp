import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { database } from "../../src/server/db";
import { emptyActivity } from "../../src/server/state";
import {
  miniLogin as identityLogin,
  miniEnter,
  limitMiniLoginSource,
} from "../../src/server/wechat-service";
import { exchangeWechatCode } from "../../src/server/wechat-provider";
import { snapshot, execute, digest } from "../../src/server/service";
import { QUESTIONS, AGES } from "../../src/data/questions";
import {
  emptyTongzhouProfile,
  TONGZHOU_CONSENT_VERSION,
} from "../../src/domain/tongzhou";
import { SnapshotGate, retryDelay } from "../../miniapp/src/lib/session-core";
import { WALL_CONSENT_VERSION } from "../../src/domain/member-wall";
import {
  registrationView,
  registrationWrite,
  registrationManage,
} from "../../src/server/registration-service";
import {
  DEFAULT_REGISTRATION_CONFIG,
  REGISTRATION_CONSENT_VERSION,
} from "../../src/domain/registration";
// Existing interaction regression now prepares an explicitly registered and staff-
// checked-in fixture. Login-without-admission is tested in registration.test.ts.
const admissionFixtures = new Map<
  string,
  Promise<{ actor: string; role: "participant" }>
>();
async function miniLogin(...args: Parameters<typeof identityLogin>) {
  const login = await identityLogin(...args);
  const activity = args[0],
    key = `${activity}:${login.identity}`;
  let fixture = admissionFixtures.get(key);
  if (!fixture) {
    fixture = (async () => {
      await database().query(
        "INSERT INTO dl_registration_config(activity_id,config) VALUES($1,$2) ON CONFLICT(activity_id) DO NOTHING",
        [
          activity,
          JSON.stringify({ ...DEFAULT_REGISTRATION_CONFIG, open: true }),
        ],
      );
      const who = `mini:${login.identity}`;
      let record = (await registrationView(activity, who)).record;
      if (!record)
        record = await registrationWrite(
          activity,
          who,
          {
            nickname: "测试参与者",
            fields: {
              ...emptyTongzhouProfile(),
              gender: "女",
              birthYear: "1995",
              city: "银川",
              phone:
                "138" +
                String(
                  parseInt(login.identity.replaceAll("-", "").slice(0, 8), 16) %
                    100000000,
                ).padStart(8, "0"),
            },
            version: 0,
            consent: REGISTRATION_CONSENT_VERSION,
            agencyAllowed: false,
          },
          `setup-${login.identity}`,
        );
      if (record.effectiveStatus !== "checked_in")
        await registrationManage(
          activity,
          {
            action: "checkin",
            id: record.id,
            version: record.version,
            receipt: record.receipt,
          },
          `check-${login.identity}`,
        );
      return miniEnter(login.identity, activity);
    })();
    admissionFixtures.set(key, fixture);
  }
  return { ...login, session: await fixture };
}
const origin = process.env.DESTINY_PUBLIC_URL!;
if (
  !["http://127.0.0.1:3215", "http://127.0.0.1:3227"].includes(origin) ||
  !new URL(process.env.DATABASE_URL!).pathname.endsWith("_test")
)
  throw new Error("Isolated mini test configuration required");
if (
  !process.env.DESTINY_MINI_TEST_AGENCY_LOGIN ||
  !process.env.DESTINY_MINI_TEST_RESTART ||
  !process.env.DESTINY_MINI_TEST_RESULT
)
  throw new Error("Protected test login and output paths required");
const appid = process.env.DESTINY_WECHAT_APPID!;
const activity = "cloudtest-mini-" + randomUUID().slice(0, 8);
const provider = async () => ({ appid, openid: "test_identity_" + activity });
const code = () => randomBytes(24).toString("hex");
const api = (
  path: string,
  token = "",
  data?: object | Buffer,
  more: Record<string, string> = {},
) =>
  fetch(
    origin +
      "/api/mini/" +
      path +
      (path.includes("?") ? "&" : "?") +
      "activity=" +
      activity,
    {
      method: data === undefined ? "GET" : "POST",
      headers: {
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(data !== undefined ? { "Content-Type": "application/json" } : {}),
        ...more,
      },
      body:
        data === undefined
          ? undefined
          : Buffer.isBuffer(data)
            ? new Uint8Array(data)
            : JSON.stringify(data),
    },
  );
after(() => database().end());
test("snapshot generation, epoch, revision and backoff gates", () => {
  const gate = new SnapshotGate();
  assert.equal(gate.accept(0, "one", 3), true);
  assert.equal(gate.accept(0, "one", 2), false);
  assert.equal(gate.accept(0, "two", 4), false);
  gate.reset();
  assert.equal(gate.accept(0, "one", 5), false);
  assert.equal(gate.accept(1, "two", 0), true);
  assert.equal(retryDelay(0, 0), 2000);
  assert.equal(retryDelay(10, 0), 30000);
});
test("WeChat exchange uses fixed endpoint, keeps server secrets private, rejects provider failures", async () => {
  const realFetch = global.fetch;
  try {
    global.fetch = (async (input: string | URL | Request) => {
      const u = new URL(String(input));
      assert.equal(u.origin, "https://api.weixin.qq.com");
      assert.equal(u.pathname, "/sns/jscode2session");
      return Response.json({
        openid: "openid_1234567890",
        session_key: "must-never-leave-server",
      });
    }) as typeof fetch;
    assert.deepEqual(await exchangeWechatCode("code_12345678"), {
      appid,
      openid: "openid_1234567890",
    });
    global.fetch = (async () =>
      Response.json({
        errcode: 40029,
        errmsg: "secret details",
      })) as typeof fetch;
    await assert.rejects(
      exchangeWechatCode("code_12345678"),
      (e) => e instanceof Error && !e.message.includes("secret details"),
    );
  } finally {
    global.fetch = realFetch;
  }
});
test("real mini API, identity races, 20 users, consent and Web isolation", async () => {
  await database().query("INSERT INTO dl_activities(id,state) VALUES($1,$2)", [
    activity,
    JSON.stringify(emptyActivity()),
  ]);
  const [first, second] = await Promise.all([
    miniLogin(activity, code(), provider),
    miniLogin(activity, code(), provider),
  ]);
  assert.equal(first.session.actor, second.session.actor);
  const counts = await database().query(
    "SELECT state FROM dl_activities WHERE id=$1",
    [activity],
  );
  assert.equal(counts.rows[0].state.participants.length, 1);
  const valid =
    (await api("snapshot", second.token)).status === 200 ? second : first;
  const stale = valid === first ? second : first;
  assert.equal((await api("snapshot", stale.token)).status, 200);
  const oneTime = code();
  const extra = await miniLogin(activity, oneTime, async () => ({
    appid,
    openid: "different_identity_one",
  }));
  await assert.rejects(miniLogin(activity, oneTime, provider), /重新获取/);
  assert.equal((await api("snapshot")).status, 401);
  assert.equal((await api("snapshot", "bad")).status, 401);
  const otherActivity = "cloudtest-other-" + randomUUID().slice(0, 8);
  await database().query("INSERT INTO dl_activities(id,state) VALUES($1,$2)", [
    otherActivity,
    JSON.stringify(emptyActivity()),
  ]);
  assert.equal(
    (
      await fetch(origin + "/api/mini/snapshot?activity=" + otherActivity, {
        headers: { Authorization: "Bearer " + valid.token },
      })
    ).status,
    401,
  );
  const before = await (await api("snapshot", valid.token)).json();
  const epoch = before.state.epoch;
  async function command(
    value: object,
    token = valid.token,
    path = "command",
    id = randomUUID(),
  ) {
    const response = await api(
      path,
      token,
      { epoch, command: value },
      { "Idempotency-Key": id },
    );
    assert.equal(response.status, 200);
    return response.json();
  }
  const id = randomUUID(),
    answer = {
      type: "answer",
      questionId: "q1",
      value: QUESTIONS[0].options[0],
    };
  await command(answer, valid.token, "command", id);
  const replay = await command(answer, valid.token, "command", id);
  assert.equal(
    replay.state.participants.find(
      (p: { id: string }) => p.id === valid.session.actor,
    ).answers.q1,
    QUESTIONS[0].options[0],
  );
  assert.equal(
    (
      await api(
        "command",
        valid.token,
        { epoch, command: { ...answer, actor: "another" } },
        { "Idempotency-Key": randomUUID() },
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await api(
        "command",
        valid.token,
        { epoch, command: { type: "point-add", name: "Meet99" } },
        { "Idempotency-Key": randomUUID() },
      )
    ).status,
    400,
  );
  await command({
    type: "profile",
    name: "测试甲",
    gender: "male",
    age: AGES[1],
    avatarId: "male_01",
    ready: true,
  });
  const bytes = await sharp({
    create: { width: 650, height: 650, channels: 3, background: "#aa7799" },
  })
    .jpeg()
    .toBuffer();
  const upload = await api("avatar/upload", valid.token, bytes, {
    "Content-Type": "image/jpeg",
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
    valid.token,
    "avatar/command",
  );
  assert.equal((await api("avatar/" + asset.id, valid.token)).status, 200);
  if (process.env.DESTINY_MEMBER_WALL_ENABLED === "true") {
    const wall = await (await api("wall/me", valid.token)).json();
    assert.equal(wall.allowed, false);
    assert.equal((await api("wall/me")).status, 401);
    const granted = await api("wall/consent", valid.token, {
      allow: true,
      nickname: "小程序清禾",
      expectedVersion: wall.version,
      consentVersion: WALL_CONSENT_VERSION,
    });
    assert.equal(granted.status, 200);
    const card = await granted.json();
    assert.equal(card.allowed, true);
    assert.ok(card.preview.avatarUrl.startsWith("/assets/avatars/"));
    assert.equal(JSON.stringify(card).includes(asset.id), false);
    const revoked = await api("wall/consent", valid.token, {
      allow: false,
      nickname: "",
      expectedVersion: card.version,
      consentVersion: WALL_CONSENT_VERSION,
    });
    assert.equal(revoked.status, 200);
    assert.equal((await revoked.json()).allowed, false);
  }
  assert.equal(
    (await fetch(origin + "/api/avatar/" + asset.id + "?screen=1")).status,
    404,
  );
  const fields = {
    ...emptyTongzhouProfile(),
    realName: "虚构资料",
    phone: "13800000000",
    gender: "男",
    birthYear: "1995",
    city: "测试市",
    ethnicity: "汉族",
    maritalStatus: "未婚",
  };
  await command(
    {
      type: "tongzhou-submit",
      fields,
      consent: true,
      consentVersion: TONGZHOU_CONSENT_VERSION,
      expectedVersion: 0,
    },
    valid.token,
    "tongzhou/command",
  );
  const agency = JSON.parse(
    readFileSync(process.env.DESTINY_MINI_TEST_AGENCY_LOGIN!, "utf8"),
  );
  const agencyLogin = await fetch(
    origin + "/api/tongzhou/login?activity=" + activity,
    {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify(agency),
    },
  );
  assert.equal(agencyLogin.status, 200);
  const cookie = agencyLogin.headers.get("set-cookie")!.split(";")[0];
  const records = await fetch(
    origin + "/api/tongzhou/records?activity=" + activity,
    { headers: { Cookie: cookie } },
  );
  assert.equal(records.status, 200);
  const list = await records.text();
  assert.ok(!list.includes(fields.phone));
  assert.ok(list.includes("138****0000"));
  const publicState = await (
    await fetch(
      origin + "/api/live/snapshot?activity=" + activity + "&audience=screen",
    )
  ).text();
  assert.ok(!publicState.includes(fields.phone));
  assert.ok(!publicState.includes(provider.toString()));
  assert.equal(
    (
      await fetch(
        origin +
          "/api/live/command?activity=" +
          activity +
          "&audience=participant",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + valid.token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ epoch, command: answer }),
        },
      )
    ).status,
    403,
  );
  await command(
    { type: "tongzhou-withdraw", expectedVersion: 1 },
    valid.token,
    "tongzhou/command",
  );
  assert.equal(
    (
      await fetch(
        origin +
          "/api/tongzhou/records?activity=" +
          activity +
          "&id=" +
          valid.session.actor,
        { headers: { Cookie: cookie } },
      )
    ).status,
    404,
  );
  await command(
    { type: "tongzhou-delete", expectedVersion: 2 },
    valid.token,
    "tongzhou/command",
  );
  const users = await Promise.all(
    Array.from({ length: 18 }, (_, i) =>
      miniLogin(activity, code(), async () => ({
        appid,
        openid: "parallel_" + activity + "_" + i,
      })),
    ),
  );
  const started = Date.now();
  await Promise.all(
    [...users, valid, extra].map((u) => command(answer, u.token)),
  );
  const concurrentAnswerMs = Date.now() - started;
  const data = await snapshot(activity, "screen");
  assert.ok("world" in data);
  const rows = await database().query(
    "SELECT state FROM dl_activities WHERE id=$1",
    [activity],
  );
  assert.equal(rows.rows[0].state.participants.length, 20);
  assert.equal((await api("avatar/" + asset.id, users[0].token)).status, 404);
  await command(
    {
      type: "avatar",
      assetId: asset.id,
      avatarId: "male_01",
      allowScreen: true,
      expectedVersion: 1,
    },
    valid.token,
    "avatar/command",
  );
  assert.equal(
    (await fetch(origin + "/api/avatar/" + asset.id + "?screen=1")).status,
    200,
  );
  await command(
    {
      type: "avatar",
      assetId: asset.id,
      avatarId: "male_01",
      allowScreen: false,
      expectedVersion: 2,
    },
    valid.token,
    "avatar/command",
  );
  assert.equal(
    (await fetch(origin + "/api/avatar/" + asset.id + "?screen=1")).status,
    404,
  );
  const reenter = await miniLogin(activity, code(), provider);
  assert.equal(reenter.session.actor, valid.session.actor);
  assert.equal((await api("snapshot", valid.token)).status, 200);
  const restored = await (await api("snapshot", reenter.token)).json();
  assert.equal(
    restored.state.participants.find(
      (p: { id: string }) => p.id === reenter.session.actor,
    ).photo.id,
    asset.id,
  );
  await execute(
    activity,
    { role: "operator", actor: "operator" },
    { type: "point-add", name: "Meet21" },
    randomUUID(),
    epoch,
  );
  // Both participants run normal API commands; no fake meeting/statistics rows.
  const partner = users[0];
  for (const q of QUESTIONS) {
    await command(
      { type: "answer", questionId: q.id, value: q.options[0] },
      reenter.token,
    );
    await command(
      { type: "answer", questionId: q.id, value: q.options[0] },
      partner.token,
    );
  }
  await command(
    {
      type: "profile",
      name: "测试乙",
      gender: "female",
      age: AGES[1],
      avatarId: "female_01",
      ready: true,
    },
    partner.token,
  );
  const invited = await command(
    { type: "invite", targetId: partner.session.actor },
    reenter.token,
  );
  const invitationId = invited.state.participants.find(
    (p: { id: string }) => p.id === reenter.session.actor,
  ).currentId;
  await command({ type: "accept", invitationId }, partner.token);
  const accepted = await (await api("snapshot", reenter.token)).json();
  const current = accepted.state.invitations.find(
    (i: { id: string }) => i.id === invitationId,
  );
  if (!current.pointId)
    await execute(
      activity,
      { role: "operator", actor: "operator" },
      { type: "assign", invitationId, pointId: "point-Meet21" },
      randomUUID(),
      epoch,
    );
  for (const u of [reenter, partner]) {
    await command({ type: "depart", invitationId }, u.token);
    await command({ type: "arrive", invitationId }, u.token);
  }
  await command({ type: "confirm", invitationId }, reenter.token);
  const single = await (await api("snapshot", reenter.token)).json();
  assert.ok(
    !single.state.invitations.find((i: { id: string }) => i.id === invitationId)
      .realMeetAt,
  );
  const confirmId = randomUUID();
  await command(
    { type: "confirm", invitationId },
    partner.token,
    "command",
    confirmId,
  );
  const confirmed = await command(
    { type: "confirm", invitationId },
    partner.token,
    "command",
    confirmId,
  );
  assert.ok(
    confirmed.state.invitations.find(
      (i: { id: string }) => i.id === invitationId,
    ).realMeetAt,
  );
  await command(
    { type: "display-consent", invitationId, allow: true },
    reenter.token,
  );
  await command(
    { type: "display-consent", invitationId, allow: true },
    partner.token,
  );
  await command(
    { type: "display-consent", invitationId, allow: false },
    reenter.token,
  );
  await command({ type: "next", invitationId, choice: "WALK" }, reenter.token);
  await command({ type: "rediscover", invitationId }, reenter.token);
  assert.equal((await api("logout", reenter.token, {})).status, 200);
  assert.equal((await api("snapshot", reenter.token)).status, 401);
  const restoredSession = await miniLogin(activity, code(), provider);
  writeFileSync(
    process.env.DESTINY_MINI_TEST_RESTART!,
    JSON.stringify({
      activity,
      token: restoredSession.token,
      actor: restoredSession.session.actor,
      asset: asset.id,
    }),
    { mode: 0o600 },
  );
  writeFileSync(
    process.env.DESTINY_MINI_TEST_RESULT!,
    JSON.stringify({
      activity,
      identities: 20,
      concurrentAnswerMs,
      identityProvider: "injected-test-only",
      realWechatLogin: false,
      realDevices: 0,
      fullPair: true,
      privacy: true,
    }),
  );
  await database().query(
    "DELETE FROM dl_mini_identity_sessions WHERE token_hash=$1",
    [digest(stale.token)],
  );
});

test("trusted source quota rejects missing or multi-source headers and isolates callers", async () => {
  const previous = process.env.DESTINY_TRUSTED_CLIENT_IP_HEADER;
  process.env.DESTINY_TRUSTED_CLIENT_IP_HEADER = "x-real-ip";
  try {
    await assert.rejects(
      limitMiniLoginSource(new Request(origin)),
      /暂不可验证/,
    );
    await assert.rejects(
      limitMiniLoginSource(
        new Request(origin, { headers: { "x-real-ip": "1.1.1.1, 2.2.2.2" } }),
      ),
      /暂不可验证/,
    );
    const bytes = randomBytes(2),
      ip = `198.18.${bytes[0]}.${bytes[1]}`;
    for (let i = 0; i < 20; i++)
      await limitMiniLoginSource(
        new Request(origin, { headers: { "x-real-ip": ip } }),
      );
    await assert.rejects(
      limitMiniLoginSource(
        new Request(origin, { headers: { "x-real-ip": ip } }),
      ),
      /过于频繁/,
    );
  } finally {
    if (previous === undefined)
      delete process.env.DESTINY_TRUSTED_CLIENT_IP_HEADER;
    else process.env.DESTINY_TRUSTED_CLIENT_IP_HEADER = previous;
  }
});
