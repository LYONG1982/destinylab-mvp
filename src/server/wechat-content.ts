import "server-only";
import {
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import sharp from "sharp";
import { database, transaction } from "./db";
import { liveConfig } from "./config";
import { digest, HttpError, rateLimit } from "./service";
import { accessToken, wechatConfig } from "./wechat-provider";

type Status = "pending" | "pass" | "review" | "risky" | "error";
export function moderationConfig() {
  const { appid } = wechatConfig();
  const mode = process.env.DESTINY_MINI_MODERATION || "wechat";
  if (mode === "local-test") {
    const origin = new URL(liveConfig().origin);
    const db = new URL(liveConfig().databaseUrl);
    if (
      !["localhost", "127.0.0.1"].includes(origin.hostname) ||
      !["localhost", "127.0.0.1", "host.docker.internal"].includes(
        db.hostname,
      ) ||
      !db.pathname.endsWith("_test") ||
      appid !== "wx0000000000000000"
    )
      throw new HttpError(503, "本地测试模式不能用于真实微信账号或公开环境。");
    return { local: true as const, appid, token: "", key: Buffer.alloc(0) };
  }
  const token = process.env.DESTINY_WECHAT_CALLBACK_TOKEN || "";
  const aes = process.env.DESTINY_WECHAT_CALLBACK_AES_KEY || "";
  if (
    mode !== "wechat" ||
    !/^[A-Za-z0-9]{16,32}$/.test(token) ||
    !/^[A-Za-z0-9+/]{43}$/.test(aes)
  )
    throw new HttpError(503, "请先配置微信内容检测与安全模式消息推送。");
  return {
    local: false as const,
    appid,
    token,
    key: Buffer.from(aes + "=", "base64"),
  };
}

async function identityOpenid(identity: string) {
  const { appid } = wechatConfig();
  const result = await database().query(
    "SELECT openid FROM dl_wechat_identities WHERE id=$1 AND appid=$2",
    [identity, appid],
  );
  if (!result.rows[0]) throw new HttpError(401, "请重新登录微信。");
  return result.rows[0].openid as string;
}
async function contentRequest(path: string, payload: object) {
  try {
    const token = await accessToken();
    const response = await fetch(
      `https://api.weixin.qq.com/wxa/${path}?access_token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok) throw Error();
    const result = await response.json();
    if (result.errcode !== 0) throw Error();
    return result;
  } catch {
    throw new HttpError(
      503,
      "内容检测暂未完成，请稍后重试；长时间未操作请重新登录微信。",
    );
  }
}
export async function checkMiniText(identity: string, text: unknown) {
  if (typeof text !== "string" || !text.trim() || [...text].length > 2500)
    throw new HttpError(400, "请填写有效的公开文字。");
  if (moderationConfig().local) return;
  await rateLimit(`mini-text:${identity}`, 30);
  const result = await contentRequest("msg_sec_check", {
    openid: await identityOpenid(identity),
    content: text,
    version: 2,
    scene: 1,
  });
  if (result.result?.suggest !== "pass")
    throw new HttpError(422, "该内容暂不能公开，请修改后重新提交。");
}

async function ownedAsset(activity: string, identity: string, asset: string) {
  if (!/^[a-f0-9-]{36}$/.test(asset))
    throw new HttpError(400, "照片编号无效。");
  const result = await database().query(
    `SELECT a.id FROM dl_avatar_assets a
    JOIN dl_wechat_participants p ON p.actor=a.actor AND p.activity_id=a.activity_id
    JOIN dl_wechat_identities i ON i.id=p.identity_id
    WHERE a.id=$1 AND a.activity_id=$2 AND p.identity_id=$3 AND i.appid=$4
    AND (a.attached OR a.created_at>now()-interval '24 hours')`,
    [asset, activity, identity, wechatConfig().appid],
  );
  if (!result.rowCount) throw new HttpError(404, "照片不存在或不属于你。");
}
export async function reviewMiniAvatar(
  activity: string,
  identity: string,
  asset: string,
) {
  await ownedAsset(activity, identity, asset);
  const config = moderationConfig();
  if (config.local) return { status: "pass" as Status };
  const token = randomBytes(32).toString("base64url");
  const reserved = await transaction(async (c) => {
    await c.query(
      "DELETE FROM dl_mini_review_results WHERE created_at<now()-interval '2 days'",
    );
    const result = await c.query(
      `INSERT INTO dl_mini_media_reviews(asset_id,identity_id,appid,status,token_hash,expires_at)
      VALUES($1,$2,$3,'pending',$4,now()+interval '2 hours') ON CONFLICT(asset_id) DO UPDATE
      SET status='pending',trace_id=NULL,token_hash=EXCLUDED.token_hash,expires_at=EXCLUDED.expires_at,updated_at=now()
      WHERE dl_mini_media_reviews.status='error' OR
      (dl_mini_media_reviews.status='pending' AND dl_mini_media_reviews.updated_at<now()-interval '35 minutes')
      RETURNING asset_id`,
      [asset, identity, config.appid, digest(token)],
    );
    if (result.rowCount) return null;
    return (
      await c.query(
        "SELECT status FROM dl_mini_media_reviews WHERE asset_id=$1",
        [asset],
      )
    ).rows[0].status as Status;
  });
  if (reserved) return { status: reserved };
  try {
    const media = `${liveConfig().origin}/api/wechat/content/media?asset=${asset}&token=${token}`;
    const result = await contentRequest("media_check_async", {
      openid: await identityOpenid(identity),
      media_url: media,
      media_type: 2,
      scene: 1,
      version: 2,
    });
    if (
      typeof result.trace_id !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(result.trace_id)
    )
      throw Error();
    await transaction(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [
        config.appid,
        result.trace_id,
      ]);
      await c.query(
        `UPDATE dl_mini_media_reviews SET trace_id=$2,
        status=COALESCE((SELECT status FROM dl_mini_review_results WHERE appid=$3 AND trace_id=$2),'pending'),updated_at=now()
        WHERE asset_id=$1 AND token_hash=$4`,
        [asset, result.trace_id, config.appid, digest(token)],
      );
    });
  } catch {
    await database().query(
      "UPDATE dl_mini_media_reviews SET status='error',updated_at=now() WHERE asset_id=$1 AND token_hash=$2",
      [asset, digest(token)],
    );
    throw new HttpError(503, "照片检测暂未完成，请稍后重试或重新登录微信。");
  }
  const row = await database().query(
    "SELECT status FROM dl_mini_media_reviews WHERE asset_id=$1",
    [asset],
  );
  return { status: row.rows[0].status as Status };
}
export async function requireMiniAvatarPass(
  activity: string,
  identity: string,
  asset: string,
) {
  await ownedAsset(activity, identity, asset);
  if (moderationConfig().local) return;
  const r = await database().query(
    "SELECT status FROM dl_mini_media_reviews WHERE asset_id=$1 AND identity_id=$2 AND appid=$3",
    [asset, identity, wechatConfig().appid],
  );
  if (r.rows[0]?.status !== "pass")
    throw new HttpError(409, "照片尚未通过检测，请等待结果或更换照片。");
}
export async function reviewMedia(asset: string, token: string) {
  moderationConfig();
  if (!/^[a-f0-9-]{36}$/.test(asset) || !/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new HttpError(404, "内容不存在。");
  const result = await database().query(
    `SELECT a.bytes FROM dl_mini_media_reviews r JOIN dl_avatar_assets a ON a.id=r.asset_id
    WHERE r.asset_id=$1 AND r.token_hash=$2 AND r.appid=$3 AND r.expires_at>now() AND r.status='pending'`,
    [asset, digest(token), wechatConfig().appid],
  );
  if (!result.rows[0]) throw new HttpError(404, "内容不存在。");
  // WeChat media_check_async does not support WebP; PNG preserves decoded pixels.
  return sharp(result.rows[0].bytes).png().toBuffer();
}

function verifySignature(url: URL, encrypted?: string) {
  const { token } = moderationConfig();
  const time = url.searchParams.get("timestamp") || "",
    nonce = url.searchParams.get("nonce") || "";
  const signature =
    url.searchParams.get(encrypted ? "msg_signature" : "signature") || "";
  if (
    !/^\d{10}$/.test(time) ||
    Math.abs(Date.now() / 1000 - Number(time)) > 600 ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(nonce) ||
    !/^[a-f0-9]{40}$/.test(signature)
  )
    throw new HttpError(403, "消息签名无效。");
  const hash = createHash("sha1")
    .update(
      [token, time, nonce, ...(encrypted ? [encrypted] : [])].sort().join(""),
    )
    .digest();
  if (!timingSafeEqual(hash, Buffer.from(signature, "hex")))
    throw new HttpError(403, "消息签名无效。");
}
export function callbackChallenge(url: URL) {
  verifySignature(url);
  const echo = url.searchParams.get("echostr") || "";
  if (echo.length > 1024) throw new HttpError(400, "消息过长。");
  return echo;
}
export function decryptCallback(
  url: URL,
  input: unknown,
): Record<string, unknown> {
  const config = moderationConfig();
  const encrypted =
    input && typeof input === "object"
      ? (input as { Encrypt?: unknown }).Encrypt
      : null;
  if (
    config.local ||
    url.searchParams.get("encrypt_type") !== "aes" ||
    typeof encrypted !== "string" ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encrypted) ||
    encrypted.length > 90000
  )
    throw new HttpError(403, "请使用安全模式 JSON 消息推送。");
  verifySignature(url, encrypted);
  try {
    const decipher = createDecipheriv(
      "aes-256-cbc",
      config.key,
      config.key.subarray(0, 16),
    );
    decipher.setAutoPadding(false);
    const padded = Buffer.concat([
      decipher.update(Buffer.from(encrypted, "base64")),
      decipher.final(),
    ]);
    const count = padded.at(-1)!;
    if (
      count < 1 ||
      count > 32 ||
      !padded.subarray(-count).every((x) => x === count)
    )
      throw Error();
    const plain = padded.subarray(0, -count),
      length = plain.readUInt32BE(16);
    if (
      length > plain.length - 20 ||
      plain.subarray(20 + length).toString() !== config.appid
    )
      throw Error();
    const event = JSON.parse(plain.subarray(20, 20 + length).toString());
    if (!event || Array.isArray(event) || typeof event !== "object")
      throw Error();
    return event;
  } catch {
    throw new HttpError(403, "消息解密失败。");
  }
}
export async function acceptReviewResult(event: Record<string, unknown>) {
  const { appid } = moderationConfig();
  if (event.Event !== "wxa_media_check") return;
  if (
    event.appid !== appid ||
    event.version !== 2 ||
    typeof event.trace_id !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(event.trace_id)
  )
    throw new HttpError(400, "检测结果无效。");
  const suggest = (event.result as { suggest?: unknown } | undefined)?.suggest;
  const status: Status =
    event.errcode === 0 && ["pass", "review", "risky"].includes(String(suggest))
      ? (suggest as Status)
      : "error";
  await transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [
      appid,
      event.trace_id,
    ]);
    await c.query(
      "INSERT INTO dl_mini_review_results(appid,trace_id,status) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [appid, event.trace_id, status],
    );
    const existing = await c.query(
      "SELECT status FROM dl_mini_review_results WHERE appid=$1 AND trace_id=$2",
      [appid, event.trace_id],
    );
    if (existing.rows[0].status !== status)
      throw new HttpError(409, "重复检测结果不一致。");
    await c.query(
      "UPDATE dl_mini_media_reviews SET status=$3,updated_at=now() WHERE appid=$1 AND trace_id=$2 AND status='pending'",
      [appid, event.trace_id, status],
    );
  });
}
