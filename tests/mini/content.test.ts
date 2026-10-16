import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  randomUUID,
  randomBytes,
  createCipheriv,
  createHash,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { database } from "../../src/server/db";
import { emptyActivity, newParticipant } from "../../src/server/state";
import { uploadAvatar } from "../../src/server/avatar-service";
import {
  checkMiniText,
  reviewMiniAvatar,
  requireMiniAvatarPass,
  reviewMedia,
  moderationConfig,
} from "../../src/server/wechat-content";
import { GET, POST } from "../../src/app/api/wechat/content/[action]/route";

const url = new URL(process.env.DATABASE_URL || "http://invalid");
if (
  !["127.0.0.1", "localhost"].includes(url.hostname) ||
  !url.pathname.endsWith("_test")
)
  throw Error("Isolated test database required");
const activity = `content-${randomBytes(4).toString("hex")}`,
  identity = randomUUID();
const state = emptyActivity(),
  actor = newParticipant();
state.participants.push(actor);
const appid = process.env.DESTINY_WECHAT_APPID!;
const key = randomBytes(32),
  token = randomBytes(16).toString("hex");
process.env.DESTINY_MINI_MODERATION = "wechat";
process.env.DESTINY_WECHAT_CALLBACK_TOKEN = token;
process.env.DESTINY_WECHAT_CALLBACK_AES_KEY = key
  .toString("base64")
  .slice(0, -1);
const originalFetch = globalThis.fetch;
let suggestion = "pass",
  errcode: number | undefined = 0,
  early = false;
let submittedUrl = "",
  lastText: Record<string, unknown> = {},
  providerFails = false;
const traces: string[] = [];
const context = { params: Promise.resolve({ action: "callback" }) };

function signed(
  message?: object,
  receiveId = appid,
  timestamp = String(Math.floor(Date.now() / 1000)),
) {
  const nonce = randomBytes(10).toString("hex");
  const url = new URL("http://localhost/api/wechat/content/callback");
  url.searchParams.set("timestamp", timestamp);
  url.searchParams.set("nonce", nonce);
  if (!message) {
    url.searchParams.set(
      "signature",
      createHash("sha1")
        .update([token, timestamp, nonce].sort().join(""))
        .digest("hex"),
    );
    url.searchParams.set("echostr", "challenge-ok");
    return { url, body: {} };
  }
  const json = Buffer.from(JSON.stringify(message)),
    size = Buffer.alloc(4);
  size.writeUInt32BE(json.length);
  const raw = Buffer.concat([
      randomBytes(16),
      size,
      json,
      Buffer.from(receiveId),
    ]),
    count = 32 - (raw.length % 32);
  const cipher = createCipheriv("aes-256-cbc", key, key.subarray(0, 16));
  cipher.setAutoPadding(false);
  const encrypted = Buffer.concat([
    cipher.update(Buffer.concat([raw, Buffer.alloc(count, count)])),
    cipher.final(),
  ]).toString("base64");
  url.searchParams.set("encrypt_type", "aes");
  url.searchParams.set(
    "msg_signature",
    createHash("sha1")
      .update([token, timestamp, nonce, encrypted].sort().join(""))
      .digest("hex"),
  );
  return { url, body: { Encrypt: encrypted } };
}
function event(trace: string, suggest = "pass", code: number | undefined = 0) {
  return {
    Event: "wxa_media_check",
    MsgType: "event",
    appid,
    trace_id: trace,
    version: 2,
    errcode: code,
    result: { suggest },
  };
}
async function callback(data: object, receiveId = appid, timestamp?: string) {
  const value = signed(data, receiveId, timestamp);
  return POST(
    new Request(value.url, {
      method: "POST",
      body: JSON.stringify(value.body),
    }),
    context,
  );
}
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (!url.startsWith("https://api.weixin.qq.com/"))
    throw Error("Unexpected test network call");
  if (url.includes("stable_token"))
    return Response.json({
      access_token: "content-test-only-token",
      expires_in: 7200,
    });
  if (providerFails) throw Error("Simulated transport failure");
  const payload = JSON.parse(String(init?.body));
  if (url.includes("msg_sec_check")) {
    lastText = payload;
    return Response.json({ errcode, result: { suggest: suggestion } });
  }
  if (url.includes("media_check_async")) {
    submittedUrl = payload.media_url;
    assert.equal(payload.version, 2);
    assert.equal(payload.media_type, 2);
    assert.equal(payload.scene, 1);
    const trace = `trace-${randomUUID()}`;
    traces.push(trace);
    if (early) assert.equal((await callback(event(trace))).status, 200);
    return Response.json({ errcode: 0, trace_id: trace });
  }
  throw Error("Unexpected provider API");
};
after(async () => {
  globalThis.fetch = originalFetch;
  await database().query(
    "DELETE FROM dl_mini_review_results WHERE trace_id=ANY($1::text[])",
    [traces],
  );
  await database().query("DELETE FROM dl_avatar_assets WHERE activity_id=$1", [
    activity,
  ]);
  await database().query(
    "DELETE FROM dl_wechat_participants WHERE activity_id=$1",
    [activity],
  );
  await database().query("DELETE FROM dl_wechat_identities WHERE id=$1", [
    identity,
  ]);
  await database().query("DELETE FROM dl_activities WHERE id=$1", [activity]);
  await database().end();
});

test("WeChat content gate and authenticated asynchronous callbacks", async (t) => {
  await database().query(
    await readFile(
      new URL("../../database/013-mini-content-review.sql", import.meta.url),
      "utf8",
    ),
  );
  await database().query("INSERT INTO dl_activities(id,state) VALUES($1,$2)", [
    activity,
    state,
  ]);
  await database().query(
    "INSERT INTO dl_wechat_identities(id,appid,openid) VALUES($1,$2,$3)",
    [identity, appid, `test-${identity}`],
  );
  await database().query(
    "INSERT INTO dl_wechat_participants(identity_id,activity_id,actor) VALUES($1,$2,$3)",
    [identity, activity, actor.id],
  );
  const bytes = await sharp({
    create: { width: 20, height: 20, channels: 3, background: "#ccbbaa" },
  })
    .png()
    .toBuffer();
  const upload = () =>
    uploadAvatar(activity, { actor: actor.id, role: "participant" }, bytes);
  await t.test(
    "text accepts only a valid pass and never sends private registration fields",
    async () => {
      await checkMiniText(identity, "清禾");
      assert.deepEqual(Object.keys(lastText).sort(), [
        "content",
        "openid",
        "scene",
        "version",
      ]);
      for (const value of ["review", "risky", "unknown"]) {
        suggestion = value;
        await assert.rejects(checkMiniText(identity, "清禾"), /暂不能公开/);
      }
      suggestion = "pass";
      errcode = undefined;
      await assert.rejects(checkMiniText(identity, "清禾"), /暂未完成/);
      errcode = 0;
      providerFails = true;
      await assert.rejects(checkMiniText(identity, "清禾"), /暂未完成/);
      providerFails = false;
    },
  );
  await t.test(
    "photo stays private and unattached until signed pass; replay is idempotent",
    async () => {
      const asset = await upload();
      await assert.rejects(
        requireMiniAvatarPass(activity, identity, asset.id),
        /尚未通过/,
      );
      assert.equal(
        (await reviewMiniAvatar(activity, identity, asset.id)).status,
        "pending",
      );
      const media = new URL(submittedUrl);
      assert.equal(
        (
          await sharp(
            await reviewMedia(asset.id, media.searchParams.get("token")!),
          ).metadata()
        ).format,
        "png",
      );
      await assert.rejects(
        reviewMedia(asset.id, randomBytes(32).toString("base64url")),
      );
      await assert.rejects(requireMiniAvatarPass(activity, identity, asset.id));
      const trace = traces.at(-1)!;
      assert.equal(
        (await callback(event(trace), "wx1111111111111111")).status,
        403,
      );
      assert.equal(
        (
          await callback(
            event(trace),
            appid,
            String(Math.floor(Date.now() / 1000) - 1000),
          )
        ).status,
        403,
      );
      assert.equal((await callback(event(trace))).status, 200);
      await requireMiniAvatarPass(activity, identity, asset.id);
      assert.equal((await callback(event(trace))).status, 200);
      assert.equal((await callback(event(trace, "risky"))).status, 409);
      await requireMiniAvatarPass(activity, identity, asset.id);
      await assert.rejects(
        reviewMedia(asset.id, media.searchParams.get("token")!),
      );
      assert.equal(
        (
          await database().query(
            "SELECT attached FROM dl_avatar_assets WHERE id=$1",
            [asset.id],
          )
        ).rows[0].attached,
        false,
      );
    },
  );
  await t.test(
    "early callback is retained; missing errcode and review never pass; ownership enforced",
    async () => {
      const asset = await upload();
      early = true;
      assert.equal(
        (await reviewMiniAvatar(activity, identity, asset.id)).status,
        "pass",
      );
      early = false;
      const pending = await upload();
      await reviewMiniAvatar(activity, identity, pending.id);
      const missingCode: Record<string, unknown> = event(traces.at(-1)!);
      delete missingCode.errcode;
      assert.equal(
        (await callback(missingCode)).status,
        200,
      );
      await assert.rejects(
        requireMiniAvatarPass(activity, identity, pending.id),
      );
      await assert.rejects(
        reviewMiniAvatar(activity, randomUUID(), pending.id),
        /不属于你/,
      );
      const review = await upload();
      await reviewMiniAvatar(activity, identity, review.id);
      assert.equal(
        (await callback(event(traces.at(-1)!, "review"))).status,
        200,
      );
      await assert.rejects(
        requireMiniAvatarPass(activity, identity, review.id),
      );
    },
  );
  await t.test(
    "signed challenge, invalid signatures, plaintext and production bypass are rejected",
    async () => {
      const value = signed();
      assert.equal(
        await (await GET(new Request(value.url), context)).text(),
        "challenge-ok",
      );
      value.url.searchParams.set("signature", "0".repeat(40));
      assert.equal((await GET(new Request(value.url), context)).status, 403);
      assert.equal(
        (
          await POST(
            new Request("http://localhost/api/wechat/content/callback", {
              method: "POST",
              body: JSON.stringify(event("forged")),
            }),
            context,
          )
        ).status,
        403,
      );
      process.env.DESTINY_MINI_MODERATION = "local-test";
      const original = process.env.DESTINY_WECHAT_APPID;
      process.env.DESTINY_WECHAT_APPID = "wx1111111111111111";
      assert.throws(moderationConfig, /本地测试模式/);
      process.env.DESTINY_WECHAT_APPID = original;
      process.env.DESTINY_MINI_MODERATION = "wechat";
    },
  );
});
