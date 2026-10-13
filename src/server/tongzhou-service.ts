import "server-only";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { database, transaction } from "./db";
import {
  cookieValue,
  digest,
  HttpError,
  load,
  rateLimit,
  save,
  type Session,
} from "./service";
import { keys } from "./private-http";
import {
  applyTongzhouCommand,
  TONGZHOU_FIELDS,
  TONGZHOU_CONSENT_VERSION,
  type TongzhouCommand,
  type TongzhouSubmission,
} from "@/domain/tongzhou";
export async function agencyLogin(
  activity: string,
  input: Record<string, unknown>,
) {
  keys(input, ["username", "password"]);
  if (
    typeof input.username !== "string" ||
    typeof input.password !== "string" ||
    input.username.length > 80 ||
    input.password.length > 256
  )
    throw new HttpError(400, "请输入有效账号和密码。");
  await rateLimit(`agency-login:${activity}`, 15, 600000);
  const [kind, salt, hash] = (
    process.env.DESTINY_AGENCY_PASSWORD_HASH || ""
  ).split("$");
  if (
    kind !== "scrypt" ||
    !/^[a-f0-9]{32}$/.test(salt || "") ||
    !/^[a-f0-9]{128}$/.test(hash || "")
  )
    throw new HttpError(503, "同舟账号尚未配置。");
  if (
    !timingSafeEqual(
      scryptSync(input.password, salt, 64),
      Buffer.from(hash, "hex"),
    ) ||
    input.username !== process.env.DESTINY_AGENCY_USERNAME
  )
    throw new HttpError(401, "账号或密码不正确。");
  const token = randomBytes(32).toString("base64url");
  await database().query(
    "INSERT INTO dl_agency_sessions VALUES($1,$2,'tongzhou',now()+interval '8 hours')",
    [digest(token), activity],
  );
  return token;
}
export async function agencySession(request: Request, activity: string) {
  const token = cookieValue(request, activity, "agency");
  if (!/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new HttpError(401, "请登录同舟机构后台。");
  const result = await database().query(
    "SELECT organization_id FROM dl_agency_sessions WHERE token_hash=$1 AND activity_id=$2 AND organization_id='tongzhou' AND expires_at>now()",
    [digest(token), activity],
  );
  if (!result.rowCount)
    throw new HttpError(401, "机构登录已失效，请重新登录。");
  return "tongzhou";
}
export async function agencyRecords(
  activity: string,
  query: string,
  page: number,
  id: string | null,
) {
  const predicate =
    "activity_id=$1 AND organization_id='tongzhou' AND record->>'status'='active' AND record->'consent'->>'version'=$2";
  if (id) {
    const r = await database().query(
      `SELECT record FROM dl_tongzhou_submissions WHERE ${predicate} AND actor=$3`,
      [activity, TONGZHOU_CONSENT_VERSION, id],
    );
    if (!r.rowCount) throw new HttpError(404, "资料已撤回、删除或不可查看。");
    return { record: r.rows[0].record };
  }
  const filter =
    " AND (strpos(record->'fields'->>'realName',$3)>0 OR strpos(record->'fields'->>'city',$3)>0)";
  const count = await database().query(
    `SELECT count(*) FROM dl_tongzhou_submissions WHERE ${predicate}${filter}`,
    [activity, TONGZHOU_CONSENT_VERSION, query],
  );
  const r = await database().query(
    `SELECT actor,record->>'version' AS version,record->'fields'->>'realName' AS name,record->'fields'->>'city' AS city,record->'fields'->>'gender' AS gender,regexp_replace(record->'fields'->>'phone','^([0-9]{3})[0-9]{4}([0-9]{4})$','\\1****\\2') AS phone,record->>'updatedAt' AS updated FROM dl_tongzhou_submissions WHERE ${predicate}${filter} ORDER BY updated_at DESC,actor LIMIT 20 OFFSET $4`,
    [activity, TONGZHOU_CONSENT_VERSION, query, (page - 1) * 20],
  );
  return { records: r.rows, total: Number(count.rows[0].count), page };
}
export async function tongzhouCommand(
  activity: string,
  session: Session,
  input: Record<string, unknown>,
  id: string,
) {
  keys(input, ["epoch", "command"]);
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(id))
    throw new HttpError(400, "提交标识无效。");
  const c = input.command as Record<string, unknown>;
  if (!c || typeof c !== "object" || Array.isArray(c))
    throw new HttpError(400, "操作无效。");
  if (
    !["tongzhou-submit", "tongzhou-withdraw", "tongzhou-delete"].includes(
      String(c.type),
    )
  )
    throw new HttpError(400, "操作无效。");
  keys(
    c,
    c.type === "tongzhou-submit"
      ? ["type", "fields", "consent", "consentVersion", "expectedVersion"]
      : ["type", "expectedVersion"],
  );
  if (!Number.isSafeInteger(c.expectedVersion) || Number(c.expectedVersion) < 0)
    throw new HttpError(400, "记录版本无效。");
  if (c.type === "tongzhou-submit") {
    if (!c.fields || typeof c.fields !== "object" || Array.isArray(c.fields))
      throw new HttpError(400, "资料无效。");
    keys(
      c.fields as Record<string, unknown>,
      TONGZHOU_FIELDS.map((f) => f.key),
    );
  }
  await rateLimit(`tongzhou:${activity}:${session.actor}`, 30);
  await transaction(async (client) => {
    const state = await load(client, activity, true);
    if (input.epoch !== state.epoch)
      throw new HttpError(409, "活动状态已变化，请刷新。");
    const hash = digest(JSON.stringify(c));
    const done = await client.query(
      "SELECT payload_hash FROM dl_private_commands WHERE activity_id=$1 AND actor=$2 AND command_id=$3",
      [activity, session.actor, id],
    );
    if (done.rowCount) {
      if (done.rows[0].payload_hash !== hash)
        throw new HttpError(409, "重复请求内容不一致。");
      return;
    }
    const own = await client.query(
      "SELECT record FROM dl_tongzhou_submissions WHERE activity_id=$1 AND actor=$2",
      [activity, session.actor],
    );
    let next: TongzhouSubmission;
    try {
      next = applyTongzhouCommand(
        { ...state, tongzhouSubmissions: own.rows.map((r) => r.record) },
        {
          actor: session.actor,
          id,
          epoch: state.epoch,
          command: c as unknown as TongzhouCommand,
        },
        Date.now(),
      ).tongzhouSubmissions[0];
    } catch (e) {
      throw new HttpError(
        Number(c.expectedVersion) !== (own.rows[0]?.record.version || 0)
          ? 409
          : 400,
        e instanceof Error ? e.message : "提交无效。",
      );
    }
    await client.query(
      "INSERT INTO dl_tongzhou_submissions(activity_id,actor,record) VALUES($1,$2,$3) ON CONFLICT(activity_id,actor) DO UPDATE SET record=$3,updated_at=now()",
      [activity, session.actor, JSON.stringify(next)],
    );
    if (c.type !== "tongzhou-submit") {
      await client.query("UPDATE dl_agency_profiles SET published=false,snapshot=NULL,photo=NULL,version=version+1,updated_at=now() WHERE activity_id=$1 AND actor=$2", [activity,session.actor]);
      await client.query("DELETE FROM dl_agency_user_photo_snapshots WHERE activity_id=$1 AND actor=$2", [activity,session.actor]);
      await client.query("DELETE FROM dl_agency_photos WHERE activity_id=$1 AND actor=$2", [activity,session.actor]);
      await client.query("UPDATE dl_agency_albums SET version=version+1 WHERE activity_id=$1 AND actor=$2", [activity,session.actor]);
      await client.query("UPDATE dl_agency_profiles SET photo_ids='[]' WHERE activity_id=$1 AND actor=$2", [activity,session.actor]);
    }
    await client.query(
      "INSERT INTO dl_private_commands(activity_id,actor,command_id,payload_hash) VALUES($1,$2,$3,$4)",
      [activity, session.actor, id, hash],
    );
    await save(client, activity, state, structuredClone(state));
  });
}
