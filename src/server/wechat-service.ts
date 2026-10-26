import "server-only";
import { checkMiniText } from "./wechat-content";
import { isIP } from "node:net";
import { randomBytes, randomUUID } from "node:crypto";
import { database, transaction } from "./db";
import { digest, HttpError, load, rateLimit, type Session } from "./service";
import { registrationEnterActor } from "./registration-service";
import { entryType, type MiniEntry } from "@/domain/mini-entry";
import {
  exchangeWechatCode,
  generateWechatCode,
  wechatConfig,
} from "./wechat-provider";

export async function limitMiniLoginSource(request: Request) {
  // Only enable a header that the deployment proxy overwrites; never trust arbitrary forwarded input.
  const header = process.env.DESTINY_TRUSTED_CLIENT_IP_HEADER;
  if (header) {
    if (!["x-forwarded-for", "x-real-ip"].includes(header))
      throw new HttpError(503, "登录来源配置无效。");
    const address = (request.headers.get(header) || "").trim();
    if (!isIP(address)) throw new HttpError(503, "登录来源暂不可验证。");
    await rateLimit(`mini-source:${digest(address)}`, 20);
  }
}
// Dependency injection is for isolated tests only; the HTTP route always uses the real provider.
export async function miniLogin(
  activity: string,
  code: unknown,
  exchange = exchangeWechatCode,
) {
  if (typeof code !== "string" || !/^[A-Za-z0-9_-]{8,256}$/.test(code))
    throw new HttpError(400, "微信登录凭证格式无效。");
  await rateLimit(`mini-login:${activity}`, 600);
  await rateLimit("mini-login-global", 5000, 3600000);
  await database().query(
    "DELETE FROM dl_wechat_codes_used WHERE created_at<now()-interval '24 hours'",
  );
  const codeHash = digest(code);
  // Claim a one-time code before calling WeChat, including concurrent replays.
  const claim = await database().query(
    "INSERT INTO dl_wechat_codes_used(code_hash) VALUES($1) ON CONFLICT DO NOTHING RETURNING code_hash",
    [codeHash],
  );
  if (!claim.rowCount) throw new HttpError(401, "请重新获取微信登录凭证。");
  const identity = await exchange(code);
  const token = randomBytes(32).toString("base64url");
  const session = await transaction(async (client) => {
    await load(client, activity, true);
    const inserted = await client.query(
      "INSERT INTO dl_wechat_identities(id,appid,openid) VALUES($1,$2,$3) ON CONFLICT(appid,openid) DO UPDATE SET appid=EXCLUDED.appid RETURNING id",
      [randomUUID(), identity.appid, identity.openid],
    );
    const identityId = inserted.rows[0].id;
    await client.query(
      "INSERT INTO dl_wechat_registrations(identity_id,activity_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [identityId, activity],
    );
    await client.query(
      "DELETE FROM dl_mini_identity_sessions WHERE identity_id=$1 AND activity_id=$2 AND expires_at<=now()",
      [identityId, activity],
    );
    await client.query(
      "INSERT INTO dl_mini_identity_sessions(token_hash,identity_id,activity_id,expires_at) VALUES($1,$2,$3,now()+interval '7 days')",
      [digest(token), identityId, activity],
    );
    return identityId as string;
  });
  return { token, expiresIn: 7 * 86400, identity: session };
}
export function miniToken(request: Request) {
  const value = request.headers.get("authorization") || "";
  if (!/^Bearer [A-Za-z0-9_-]{43}$/.test(value))
    throw new HttpError(401, "请重新登录小程序。");
  return value.slice(7);
}
export async function miniIdentity(request: Request, activity: string) {
  const { appid } = wechatConfig();
  const found = await database().query(
    "SELECT s.identity_id FROM dl_mini_identity_sessions s JOIN dl_wechat_identities i ON i.id=s.identity_id WHERE s.token_hash=$1 AND s.activity_id=$2 AND s.expires_at>now() AND i.appid=$3",
    [digest(miniToken(request)), activity, appid],
  );
  if (!found.rows[0]) throw new HttpError(401, "登录已失效，请重新登录。");
  return found.rows[0].identity_id as string;
}
export async function miniSession(
  request: Request,
  activity: string,
): Promise<Session> {
  const identity = await miniIdentity(request, activity);
  const found = await database().query(
    "SELECT r.participant_id AS actor FROM dl_wechat_registrations w JOIN dl_registrations r ON r.id=w.registration_id AND r.activity_id=w.activity_id JOIN dl_activities a ON a.id=w.activity_id WHERE w.identity_id=$1 AND w.activity_id=$2 AND r.status='checked_in' AND r.checkin_epoch=a.state->>'epoch' AND r.participant_epoch=a.state->>'epoch' AND r.participant_id IS NOT NULL",
    [identity, activity],
  );
  if (!found.rows[0])
    throw new HttpError(
      409,
      "请先完成报名并由工作人员核验签到，再进入现场互动。",
    );
  return { actor: found.rows[0].actor, role: "participant" };
}
export async function miniEnter(identity: string, activity: string) {
  const record = await database().query(
    "SELECT r.nickname FROM dl_registrations r JOIN dl_wechat_registrations w ON w.registration_id=r.id AND w.activity_id=r.activity_id WHERE w.identity_id=$1 AND w.activity_id=$2",
    [identity, activity],
  );
  if (!record.rows[0]) throw new HttpError(403, "请先完成报名。");
  const nickname = record.rows[0].nickname as string;
  await checkMiniText(identity, nickname);
  return transaction(async (c) => {
    await load(c, activity, true);
    const existing = await c.query(
      "SELECT actor FROM dl_wechat_participants WHERE identity_id=$1 AND activity_id=$2",
      [identity, activity],
    );
    const actor = await registrationEnterActor(
      c,
      activity,
      `mini:${identity}`,
      undefined,
      existing.rows[0]?.actor,
      nickname,
    );
    await c.query(
      "INSERT INTO dl_wechat_participants(identity_id,activity_id,actor) VALUES($1,$2,$3) ON CONFLICT(identity_id,activity_id) DO UPDATE SET actor=EXCLUDED.actor",
      [identity, activity, actor],
    );
    return { actor, role: "participant" as const };
  });
}
export async function miniLogout(request: Request, activity: string) {
  await database().query(
    "DELETE FROM dl_mini_identity_sessions WHERE token_hash=$1 AND activity_id=$2",
    [digest(miniToken(request)), activity],
  );
}
export async function entryCode(
  activity: string,
  create = false,
  entry: MiniEntry = "encounter",
) {
  const { appid, version } = wechatConfig();
  await transaction((client) => load(client, activity));
  const found = await database().query(
    "SELECT image,scene FROM dl_wechat_entry_codes WHERE activity_id=$1 AND appid=$2 AND env_version=$3 AND entry_type=$4",
    [activity, appid, version, entry],
  );
  if (found.rowCount) return found.rows[0] as { image: Buffer; scene: string };
  if (!create) throw new HttpError(404, "活动小程序码尚未生成。");
  await rateLimit(`mini-code:${activity}`, 3, 3600000);
  const scene = randomBytes(12).toString("hex");
  const image = await generateWechatCode(scene, entry);
  const saved = await database().query(
    "INSERT INTO dl_wechat_entry_codes(activity_id,appid,env_version,scene,image,entry_type) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(activity_id,appid,env_version,entry_type) DO UPDATE SET appid=EXCLUDED.appid RETURNING image,scene",
    [activity, appid, version, scene, image, entry],
  );
  return saved.rows[0] as { image: Buffer; scene: string };
}
export async function resolveScene(scene: string) {
  if (!/^[a-f0-9]{24}$/.test(scene)) throw new HttpError(400, "活动码无效。");
  const { appid, version } = wechatConfig();
  const found = await database().query(
    "SELECT activity_id,entry_type FROM dl_wechat_entry_codes WHERE scene=$1 AND appid=$2 AND env_version=$3",
    [scene, appid, version],
  );
  if (!found.rowCount) throw new HttpError(404, "活动码不存在或版本不匹配。");
  return {
    activity: found.rows[0].activity_id as string,
    entry: entryType(found.rows[0].entry_type),
  };
}
