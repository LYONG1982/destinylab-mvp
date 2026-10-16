import "server-only";
import { validateBirthDate, zodiacFor } from "@/domain/birth-date";
import { randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import sharp from "sharp";
import { database, transaction } from "./db";
import {
  cookieValue,
  digest,
  HttpError,
  load,
  save,
  rateLimit,
} from "./service";
import { newParticipant } from "./state";
import { keys } from "./private-http";
import { defaultPublicFields } from "@/domain/agency";
import {
  TONGZHOU_CONSENT_VERSION,
  type TongzhouProfile,
} from "@/domain/tongzhou";
import {
  DEFAULT_REGISTRATION_CONFIG,
  REGISTRATION_AGENCY_CONSENT,
  REGISTRATION_CONSENT_VERSION,
  validateRegistration,
  validateRegistrationConfig,
  type RegistrationRecord,
} from "@/domain/registration";

import {
  PROFILE_FIELDS,
  PROFILE_STEPS,
  isProfileStep,
  profileProgress,
} from "@/domain/registration-profile";
import { allocateRegistrationReceipt } from "./registration-receipt";
import {
  isRegistrationReceipt,
  isLegacyRegistrationReceipt,
  normalizeRegistrationReceipt,
} from "../domain/registration-receipt";

type Row = {
  id: string;
  activity_id: string;
  nickname: string;
  birth_date: string | null;
  fields: TongzhouProfile;
  status: RegistrationRecord["status"];
  receipt: string;
  legacy_receipt: string | null;
  profile_progress: unknown;
  profile_confirmed_at: Date | null;
  version: number;
  agency_allowed: boolean;
  agency_consent_at: Date | null;
  created_at: Date;
  checked_in_at: Date | null;
  participant_id: string | null;
  participant_epoch: string | null;
  checkin_epoch: string | null;
};
export function registrationEnabled() {
  if (
    process.env.DESTINY_DATA_MODE !== "server" ||
    process.env.DESTINY_REGISTRATION_ENABLED !== "true"
  )
    throw new HttpError(404, "报名服务尚未开放。");
}
export async function registrationSession(
  request: Request,
  activity: string,
  create = false,
) {
  const token = cookieValue(request, activity, "registration");
  if (/^[A-Za-z0-9_-]{43}$/.test(token)) {
    const r = await database().query(
      "SELECT token_hash,registration_id FROM dl_registration_sessions WHERE token_hash=$1 AND activity_id=$2 AND expires_at>now()",
      [digest(token), activity],
    );
    if (r.rows[0])
      return { ...r.rows[0], token: "" } as {
        token_hash: string;
        registration_id: string | null;
        token: string;
      };
  }
  if (!create)
    throw new HttpError(
      401,
      "报名会话已失效，请回到报名首页。更换设备请联系现场工作人员核验。",
    );
  await rateLimit(`registration-session:${activity}`, 300);
  const fresh = randomBytes(32).toString("base64url");
  await transaction(async (c) => {
    await load(c, activity);
    await c.query(
      "INSERT INTO dl_registration_sessions(token_hash,activity_id,expires_at) VALUES($1,$2,now()+interval '30 days')",
      [digest(fresh), activity],
    );
  });
  return { token_hash: digest(fresh), registration_id: null, token: fresh };
}
export async function registrationConfig(
  activity: string,
  connection?: PoolClient,
) {
  const r = await (connection || database()).query(
    "SELECT config FROM dl_registration_config WHERE activity_id=$1",
    [activity],
  );
  return r.rows[0]?.config || DEFAULT_REGISTRATION_CONFIG;
}
// Owner keys are produced only by trusted HTTP authentication adapters. Web hashes
// are SHA-256; mini keys name an authenticated identity, never an HTTP body field.
async function owner(c: PoolClient, activity: string, hash: string) {
  if (hash.startsWith("mini:")) {
    const result = await c.query(
      "SELECT registration_id FROM dl_wechat_registrations WHERE identity_id=$1 AND activity_id=$2 FOR UPDATE",
      [hash.slice(5), activity],
    );
    if (!result.rows[0]) throw new HttpError(401, "请重新登录小程序。");
    return result.rows[0].registration_id as string | null;
  }
  const s = await c.query(
    "SELECT registration_id FROM dl_registration_sessions WHERE token_hash=$1 AND activity_id=$2 AND expires_at>now() FOR UPDATE",
    [hash, activity],
  );
  if (!s.rows[0]) throw new HttpError(401, "报名会话已失效。");
  return s.rows[0].registration_id as string | null;
}
async function row(c: PoolClient, activity: string, id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new HttpError(404, "报名记录不存在。");
  const r = await c.query(
    "SELECT * FROM dl_registrations WHERE activity_id=$1 AND id=$2 FOR UPDATE",
    [activity, id],
  );
  if (!r.rows[0]) throw new HttpError(404, "报名记录不存在。");
  return r.rows[0] as Row;
}
async function record(
  c: PoolClient,
  r: Row,
  operator = false,
): Promise<RegistrationRecord> {
  const photos = await c.query(
    "SELECT id FROM dl_registration_photos WHERE registration_id=$1 ORDER BY created_at,id",
    [r.id],
  );
  const epoch = (
    await c.query(
      "SELECT state->>'epoch' AS epoch FROM dl_activities WHERE id=$1",
      [r.activity_id],
    )
  ).rows[0]?.epoch;
  const effectiveStatus = r.status;
  const base = `/api/registration/photo?activity=${r.activity_id}${operator ? "&operator=1" : ""}`;
  return {
    id: r.id,
    nickname: r.nickname,
    birthDate: r.birth_date || null,
    zodiac: zodiacFor(r.birth_date),
    fields: r.fields,
    status: r.status,
    receipt: r.receipt,
    version: r.version,
    agencyAllowed: r.agency_allowed,
    createdAt: r.created_at.toISOString(),
    checkedInAt: r.checked_in_at?.toISOString() || null,
    effectiveStatus,
    profileProgress: profileProgress(r.profile_progress),
    profileConfirmedAt: r.profile_confirmed_at?.toISOString() || null,
    entered: !!r.participant_id && r.participant_epoch === epoch,
    photos: photos.rows.map((p) => ({
      id: p.id,
      url: base + `&photo=${p.id}`,
      thumbnail: base + `&photo=${p.id}&thumb=1`,
    })),
  };
}
export async function registrationView(activity: string, hash: string) {
  return transaction(async (c) => {
    const id = await owner(c, activity, hash);
    return {
      config: await registrationConfig(activity, c),
      record: id ? await record(c, await row(c, activity, id)) : null,
    };
  });
}
function validated<T>(fn: () => T) {
  try {
    return fn();
  } catch (e) {
    throw new HttpError(400, e instanceof Error ? e.message : "资料无效。");
  }
}
async function action(
  c: PoolClient,
  activity: string,
  who: string,
  id: string,
  payload: unknown,
  name: string,
) {
  if (!/^[a-zA-Z0-9_-]{8,120}$/.test(id))
    throw new HttpError(400, "提交标识无效。");
  const hash = digest(JSON.stringify(payload));
  const old = await c.query(
    "SELECT payload_hash FROM dl_registration_actions WHERE activity_id=$1 AND owner=$2 AND command_id=$3",
    [activity, who, id],
  );
  if (old.rows[0]) {
    if (old.rows[0].payload_hash !== hash)
      throw new HttpError(409, "重复请求内容不一致。");
    return false;
  }
  await c.query(
    "INSERT INTO dl_registration_actions(activity_id,owner,command_id,payload_hash,action) VALUES($1,$2,$3,$4,$5)",
    [activity, who, id, hash, name],
  );
  return true;
}
function version(r: Row, v: unknown) {
  if (v !== r.version) throw new HttpError(409, "资料已更新，请刷新后重试。");
}
// Registration uses its own stable actor. Never merge records using an unverified phone number.
async function projectAgency(c: PoolClient, r: Row) {
  const actor = `registration:${r.id}`;
  const existing = await c.query(
    "SELECT record FROM dl_tongzhou_submissions WHERE activity_id=$1 AND actor=$2 FOR UPDATE",
    [r.activity_id, actor],
  );
  if (!r.agency_allowed && !existing.rows[0]) return;
  const old = existing.rows[0]?.record;
  const submission = {
    participantId: actor,
    organizationId: "tongzhou",
    version: (old?.version || 0) + 1,
    status: r.agency_allowed ? "active" : "withdrawn",
    fields: r.agency_allowed ? r.fields : null,
    submittedAt: old?.submittedAt || Date.now(),
    updatedAt: Date.now(),
    consent: r.agency_allowed
      ? {
          version: TONGZHOU_CONSENT_VERSION,
          at: r.agency_consent_at?.getTime() || Date.now(),
        }
      : null,
  };
  await c.query(
    "INSERT INTO dl_tongzhou_submissions(activity_id,actor,record) VALUES($1,$2,$3) ON CONFLICT(activity_id,actor) DO UPDATE SET record=$3,updated_at=now()",
    [r.activity_id, actor, JSON.stringify(submission)],
  );
  await c.query(
    "INSERT INTO dl_agency_profiles(activity_id,actor,nickname,code,slug,fields) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(activity_id,actor) DO NOTHING",
    [
      r.activity_id,
      actor,
      r.nickname,
      "TZ-" +
        digest(r.activity_id + ":" + actor)
          .slice(0, 12)
          .toUpperCase(),
      randomBytes(18).toString("base64url"),
      JSON.stringify(defaultPublicFields()),
    ],
  );
  if (r.agency_allowed) {
    const total = await c.query(
      "SELECT (SELECT count(*) FROM dl_registration_photos WHERE registration_id=$1)+(SELECT count(*) FROM dl_agency_photos WHERE activity_id=$2 AND actor IN (SELECT actor FROM dl_agency_sources WHERE activity_id=$2 AND member_actor=(SELECT member_actor FROM dl_agency_sources WHERE activity_id=$2 AND actor=$3) AND active) AND staff<>'registration') AS n",
      [r.id, r.activity_id, actor],
    );
    if (Number(total.rows[0].n) > 9)
      throw new HttpError(
        409,
        "同舟相册最多9张，请联系工作人员整理照片后重试。",
      );
  }
  // Any user edit invalidates the published snapshot, while preserving all staff-managed fields.
  await c.query(
    "UPDATE dl_agency_profiles SET published=false,updated_at=now() WHERE activity_id=$1 AND actor=$2",
    [r.activity_id, actor],
  );
  await c.query(
    "DELETE FROM dl_agency_photos WHERE activity_id=$1 AND actor=$2 AND staff='registration'",
    [r.activity_id, actor],
  );
  if (r.agency_allowed)
    await c.query(
      "INSERT INTO dl_agency_photos(id,activity_id,actor,bytes,thumbnail,width,height,position,staff) SELECT id,$2,$3,bytes,thumbnail,width,height,row_number() OVER(ORDER BY created_at,id)::int,'registration' FROM dl_registration_photos WHERE registration_id=$1",
      [r.id, r.activity_id, actor],
    );
  await c.query(
    "INSERT INTO dl_agency_albums(activity_id,actor,version) VALUES($1,$2,1) ON CONFLICT(activity_id,actor) DO UPDATE SET version=dl_agency_albums.version+1",
    [r.activity_id, actor],
  );
}
export async function registrationWrite(
  activity: string,
  hash: string,
  input: Record<string, unknown>,
  commandId: string,
) {
  keys(input, [
    "nickname",
    "birthDate",
    "fields",
    "version",
    "consent",
    "agencyAllowed",
    "agencyConsent",
  ]);
  const data = validated(() =>
    validateRegistration(input.fields, input.nickname),
  );
  if (typeof input.agencyAllowed !== "boolean")
    throw new HttpError(400, "请选择是否使用同舟服务。");
  await rateLimit(`registration-write:${activity}:${hash}`, 40);
  try {
    return await transaction(async (c) => {
      const state = await load(c, activity, true);
      let id = await owner(c, activity, hash);
      if (!(await action(c, activity, hash, commandId, input, "save")))
        return record(c, await row(c, activity, id!));
      if (!id) {
        if (!(await registrationConfig(activity, c)).open)
          throw new HttpError(409, "本次报名尚未开放或已结束。");
        if (input.consent !== REGISTRATION_CONSENT_VERSION)
          throw new HttpError(400, "请阅读并同意活动报名须知。");
        if (input.version !== 0) throw new HttpError(409, "请刷新报名页面。");
        id = randomUUID();
        await allocateRegistrationReceipt(async (receipt) => {
          const inserted = await c.query(
            "INSERT INTO dl_registrations(id,activity_id,nickname,fields,receipt,consent_version) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(receipt) DO NOTHING RETURNING id",
            [
              id,
              activity,
              data.nickname,
              JSON.stringify(data.fields),
              receipt,
              REGISTRATION_CONSENT_VERSION,
            ],
          );
          return inserted.rowCount === 1;
        });
        if (hash.startsWith("mini:"))
          await c.query(
            "UPDATE dl_wechat_registrations SET registration_id=$3 WHERE identity_id=$1 AND activity_id=$2",
            [hash.slice(5), activity, id],
          );
        else
          await c.query(
            "UPDATE dl_registration_sessions SET registration_id=$2 WHERE token_hash=$1",
            [hash, id],
          );
      } else {
        const r = await row(c, activity, id);
        version(r, input.version);
        if (r.status === "cancelled")
          throw new HttpError(409, "报名已取消，请联系工作人员。");
      }
      const current = await row(c, activity, id);
      const birthDate = validated(() =>
        validateBirthDate(
          input.birthDate === undefined
            ? ((current.fields.birthYear === data.fields.birthYear
                ? current.birth_date
                : null) ?? null)
            : input.birthDate,
          data.fields.birthYear,
        ),
      );
      if (
        input.agencyAllowed &&
        !current.agency_allowed &&
        input.agencyConsent !== REGISTRATION_AGENCY_CONSENT
      )
        throw new HttpError(400, "请确认同舟专业服务授权。");
      if (
        input.agencyAllowed &&
        process.env.DESTINY_TONGZHOU_ENABLED !== "true"
      )
        throw new HttpError(409, "同舟专业服务暂未开放。");
      await c.query(
        "UPDATE dl_registrations SET nickname=$2,fields=$3,agency_allowed=$4,birth_date=$5,agency_consent_at=CASE WHEN $4 THEN COALESCE(agency_consent_at,now()) ELSE NULL END,version=version+1,updated_at=now() WHERE id=$1",
        [
          id,
          data.nickname,
          JSON.stringify(data.fields),
          input.agencyAllowed,
          birthDate,
        ],
      );
      // The same verified WeChat identity can register after joining the field.
      // Never infer identity from a phone number or copy private fields to the screen.
      if (hash.startsWith("mini:")) {
        const linked = (
          await c.query(
            "SELECT actor FROM dl_wechat_participants WHERE identity_id=$1 AND activity_id=$2 AND epoch=$3",
            [hash.slice(5), activity, state.epoch],
          )
        ).rows[0];
        if (linked && state.participants.some((p) => p.id === linked.actor))
          await c.query(
            "UPDATE dl_registrations SET participant_id=$2,participant_epoch=$3 WHERE id=$1",
            [id, linked.actor, state.epoch],
          );
      }
      const r = await row(c, activity, id);
      await projectAgency(c, r);
      return record(c, r);
    });
  } catch (e) {
    if (
      (e as { code?: string }).code === "23505" &&
      (e as { constraint?: string }).constraint === "dl_registration_phone"
    )
      throw new HttpError(
        409,
        "该手机号已报名，请在原设备查看，或联系工作人员核验。",
      );
    throw e;
  }
}
export async function registrationProfile(
  activity: string,
  hash: string,
  input: Record<string, unknown>,
  commandId: string,
) {
  keys(input, [
    "section",
    "intent",
    "next",
    "fields",
    "version",
    "agencyAllowed",
    "agencyConsent",
  ]);
  if (
    !isProfileStep(input.section) ||
    !isProfileStep(input.next) ||
    !["save", "visit", "confirm"].includes(String(input.intent))
  )
    throw new HttpError(400, "档案步骤无效。");
  const section = input.section,
    next = input.next;
  if (
    !input.fields ||
    typeof input.fields !== "object" ||
    Array.isArray(input.fields)
  )
    throw new HttpError(400, "资料格式无效。");
  const patch = input.fields as Record<string, unknown>;
  keys(patch, [...PROFILE_FIELDS[section]]);
  if (
    (input.agencyAllowed !== undefined &&
      (typeof input.agencyAllowed !== "boolean" ||
        !["album", "preview"].includes(section))) ||
    (input.intent === "confirm" && section !== "preview") ||
    (input.intent === "visit" &&
      (Object.keys(patch).length || input.agencyAllowed !== undefined))
  )
    throw new HttpError(400, "档案操作无效。");
  await rateLimit(`registration-profile:${activity}:${hash}`, 180);
  return transaction(async (c) => {
    await load(c, activity, true);
    const id = await owner(c, activity, hash);
    if (!id) throw new HttpError(409, "请先完成报名。");
    const current = await row(c, activity, id);
    if (!(await action(c, activity, hash, commandId, input, "profile")))
      return record(c, current);
    version(current, input.version);
    if (current.status === "cancelled")
      throw new HttpError(409, "报名已取消，无法修改档案。");
    const data = validated(() =>
      validateRegistration({ ...current.fields, ...patch }, current.nickname),
    );
    const agency =
      typeof input.agencyAllowed === "boolean"
        ? input.agencyAllowed
        : current.agency_allowed;
    if (
      agency &&
      !current.agency_allowed &&
      input.agencyConsent !== REGISTRATION_AGENCY_CONSENT
    )
      throw new HttpError(400, "请确认同舟专业服务授权。");
    if (
      agency &&
      !current.agency_allowed &&
      process.env.DESTINY_TONGZHOU_ENABLED !== "true"
    )
      throw new HttpError(409, "同舟专业服务暂未开放。");
    const progress = profileProgress(current.profile_progress);
    progress.current = next;
    progress.visited = [...new Set([...progress.visited, section, next])];
    if (input.intent !== "visit")
      progress.saved = [...new Set([...progress.saved, section])];
    if (input.intent === "confirm") progress.saved = [...PROFILE_STEPS];
    const changed =
      agency !== current.agency_allowed ||
      Object.keys(data.fields).some(
        (k) =>
          data.fields[k as keyof TongzhouProfile] !==
          current.fields[k as keyof TongzhouProfile],
      );
    await c.query(
      "UPDATE dl_registrations SET fields=$2,agency_allowed=$3,agency_consent_at=CASE WHEN $3 THEN COALESCE(agency_consent_at,now()) ELSE NULL END,profile_progress=$4,profile_confirmed_at=CASE WHEN $5 THEN now() ELSE profile_confirmed_at END,version=version+1,updated_at=now() WHERE id=$1",
      [
        id,
        JSON.stringify(data.fields),
        agency,
        JSON.stringify(progress),
        input.intent === "confirm",
      ],
    );
    const updated = await row(c, activity, id);
    if (changed) await projectAgency(c, updated);
    return record(c, updated);
  });
}
export async function registrationPhoto(
  activity: string,
  hash: string | null,
  photo: string,
  thumb: boolean,
) {
  if (!/^[a-f0-9-]{36}$/.test(photo)) throw new HttpError(404, "照片不存在。");
  const mini = hash?.startsWith("mini:");
  const ownership = !hash
    ? ""
    : mini
      ? "AND r.id=(SELECT registration_id FROM dl_wechat_registrations WHERE identity_id=$3 AND activity_id=$2)"
      : "AND r.id=(SELECT registration_id FROM dl_registration_sessions WHERE token_hash=$3 AND activity_id=$2 AND expires_at>now())";
  const r = await database().query(
    `SELECT p.${thumb ? "thumbnail" : "bytes"} AS bytes FROM dl_registration_photos p JOIN dl_registrations r ON r.id=p.registration_id WHERE p.id=$1 AND r.activity_id=$2 ${ownership}`,
    [photo, activity, ...(hash ? [mini ? hash.slice(5) : hash] : [])],
  );
  if (!r.rows[0]) throw new HttpError(404, "照片不存在或无权查看。");
  return r.rows[0].bytes as Buffer;
}
export async function registrationUpload(
  activity: string,
  hash: string,
  v: number,
  id: string,
  raw: Buffer,
) {
  await rateLimit(`registration-photo:${activity}:${hash}`, 20);
  let bytes: Buffer, thumbnail: Buffer, width: number, height: number;
  try {
    const source = sharp(raw, { limitInputPixels: 24000000 });
    const meta = await source.metadata();
    if (
      !["jpeg", "png", "webp"].includes(meta.format || "") ||
      (meta.pages || 1) > 1
    )
      throw Error();
    const result = await source
      .rotate()
      .resize(1920, 1920, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 84 })
      .toBuffer({ resolveWithObject: true });
    bytes = result.data;
    width = result.info.width;
    height = result.info.height;
    thumbnail = await sharp(bytes)
      .resize(480, 480, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 76 })
      .toBuffer();
    if (bytes.length > 2097152 || thumbnail.length > 204800) throw Error();
  } catch {
    throw new HttpError(400, "请上传10MB以内的 JPG、PNG 或 WebP 静态照片。");
  }
  return transaction(async (c) => {
    await load(c, activity, true);
    const own = await owner(c, activity, hash);
    if (!own) throw new HttpError(409, "请先完成基础报名。");
    const r = await row(c, activity, own);
    if (
      !(await action(
        c,
        activity,
        hash,
        id,
        { v, photo: digest(raw.toString("base64")) },
        "photo",
      ))
    )
      return record(c, r);
    version(r, v);
    if (r.status === "cancelled") throw new HttpError(409, "报名已取消。");
    const count = await c.query(
      "SELECT count(*)::int AS n FROM dl_registration_photos WHERE registration_id=$1",
      [own],
    );
    if (count.rows[0].n >= 6)
      throw new HttpError(409, "个人相册最多保存6张照片。");
    await c.query(
      "INSERT INTO dl_registration_photos(id,registration_id,bytes,thumbnail,width,height) VALUES($1,$2,$3,$4,$5,$6)",
      [randomUUID(), own, bytes, thumbnail, width, height],
    );
    await c.query(
      "UPDATE dl_registrations SET version=version+1,updated_at=now() WHERE id=$1",
      [own],
    );
    const next = await row(c, activity, own);
    await projectAgency(c, next);
    return record(c, next);
  });
}
export async function registrationDeletePhoto(
  activity: string,
  hash: string,
  input: Record<string, unknown>,
  commandId: string,
) {
  keys(input, ["photo", "version"]);
  if (typeof input.photo !== "string" || !/^[a-f0-9-]{36}$/.test(input.photo))
    throw new HttpError(400, "照片标识无效。");
  return transaction(async (c) => {
    await load(c, activity, true);
    const id = await owner(c, activity, hash);
    if (!id) throw new HttpError(404, "请先报名。");
    const r = await row(c, activity, id);
    if (!(await action(c, activity, hash, commandId, input, "delete-photo")))
      return record(c, r);
    version(r, input.version);
    if (r.status === "cancelled") throw new HttpError(409, "报名已取消。");
    await c.query(
      "DELETE FROM dl_registration_photos WHERE id=$1 AND registration_id=$2",
      [input.photo, id],
    );
    await c.query(
      "UPDATE dl_registrations SET version=version+1,updated_at=now() WHERE id=$1",
      [id],
    );
    const next = await row(c, activity, id);
    await projectAgency(c, next);
    return record(c, next);
  });
}
export async function registrationList(
  activity: string,
  q: string,
  page: number,
  status = "",
) {
  if (
    q.length > 80 ||
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 10000 ||
    !["", "registered", "checked_in", "cancelled"].includes(status)
  )
    throw new HttpError(400, "查询无效。");
  return transaction(async (c) => {
    await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    const where =
      "activity_id=$1 AND (nickname ILIKE $2 OR fields->>'phone'=$3 OR receipt=$4 OR legacy_receipt=$4) AND ($5='' OR status=$5)";
    const params = [
      activity,
      "%" + q + "%",
      q,
      normalizeRegistrationReceipt(q),
      status,
    ];
    const list = await c.query(
      `SELECT id,nickname,fields->>'gender' AS gender,fields->>'birthYear' AS birth_year,fields->>'city' AS city,substring(fields->>'phone',1,3)||'****'||right(fields->>'phone',4) AS phone,status,created_at,agency_allowed FROM dl_registrations WHERE ${where} ORDER BY created_at DESC,id LIMIT 20 OFFSET $6`,
      [...params, (page - 1) * 20],
    );
    const total = await c.query(
      `SELECT count(*)::int AS n FROM dl_registrations WHERE ${where}`,
      params,
    );
    const stats = await c.query(
      "SELECT count(*)::int AS total,count(*) FILTER(WHERE status='checked_in')::int AS checked_in,count(*) FILTER(WHERE fields->>'gender'='男')::int AS male,count(*) FILTER(WHERE fields->>'gender'='女')::int AS female FROM dl_registrations WHERE activity_id=$1 AND status<>'cancelled'",
      [activity],
    );
    const config = await c.query(
      "SELECT config FROM dl_registration_config WHERE activity_id=$1",
      [activity],
    );
    return {
      items: list.rows,
      total: total.rows[0].n,
      stats: stats.rows[0],
      config: config.rows[0]?.config || DEFAULT_REGISTRATION_CONFIG,
    };
  });
}
export async function registrationDetail(activity: string, id: string) {
  return transaction(async (c) => record(c, await row(c, activity, id), true));
}
export async function registrationManage(
  activity: string,
  input: Record<string, unknown>,
  commandId: string,
) {
  keys(input, ["action", "id", "version", "receipt", "config"]);
  return transaction(async (c) => {
    const state = await load(c, activity, true);
    if (!(await action(c, activity, "operator", commandId, input, "manage")))
      return { ok: true };
    if (input.action === "config") {
      const config = validated(() => validateRegistrationConfig(input.config));
      await c.query(
        "INSERT INTO dl_registration_config(activity_id,config) VALUES($1,$2) ON CONFLICT(activity_id) DO UPDATE SET config=$2,version=dl_registration_config.version+1",
        [activity, JSON.stringify(config)],
      );
      return { ok: true };
    }
    const r = await row(c, activity, String(input.id || ""));
    version(r, input.version);
    if (input.action === "checkin") {
      if (r.status === "cancelled")
        throw new HttpError(409, "已取消的报名无法签到。");
      const receipt =
        typeof input.receipt === "string"
          ? normalizeRegistrationReceipt(input.receipt)
          : "";
      if (
        !isRegistrationReceipt(receipt) &&
        !isLegacyRegistrationReceipt(receipt)
      )
        throw new HttpError(
          400,
          "请输入六位数字签到凭证；旧版凭证为16位字母或数字。",
        );
      if (receipt !== r.receipt && receipt !== r.legacy_receipt)
        throw new HttpError(400, "凭证不匹配，请核对用户手机上的签到凭证。");
      await c.query(
        "UPDATE dl_registrations SET status='checked_in',checked_in_at=now(),checkin_epoch=$2,participant_id=CASE WHEN participant_epoch=$2 THEN participant_id ELSE NULL END,participant_epoch=CASE WHEN participant_epoch=$2 THEN participant_epoch ELSE NULL END,version=version+1,updated_at=now() WHERE id=$1",
        [r.id, state.epoch],
      );
    } else if (input.action === "cancel") {
      if (r.participant_id && r.participant_epoch === state.epoch)
        throw new HttpError(409, "用户已进入活动，请在参与用户中处理离场。");
      await c.query(
        "UPDATE dl_registrations SET status='cancelled',version=version+1,updated_at=now() WHERE id=$1",
        [r.id],
      );
    } else throw new HttpError(400, "操作无效。");
    return { ok: true };
  });
}
export async function registrationEnter(
  activity: string,
  hash: string,
  request: Request,
) {
  return transaction(async (c) => {
    const actor = await registrationEnterActor(c, activity, hash, request);
    const token = randomBytes(32).toString("base64url");
    await c.query(
      "INSERT INTO dl_sessions(token_hash,activity_id,role,actor,expires_at) VALUES($1,$2,'participant',$3,now()+interval '30 days')",
      [digest(token), activity, actor],
    );
    return token;
  });
}

// Optional explicit H5 registration-to-field binding; check-in is not a field prerequisite.
export async function registrationEnterActor(
  c: PoolClient,
  activity: string,
  hash: string,
  request?: Request,
  knownActor?: string,
  expectedNickname?: string,
) {
  const before = await load(c, activity, true);
  const id = await owner(c, activity, hash);
  if (!id) throw new HttpError(403, "请先完成报名。");
  const r = await row(c, activity, id);
  if (expectedNickname !== undefined && r.nickname !== expectedNickname)
    throw new HttpError(409, "昵称已更新，请重新进入互动以完成检测。");
  if (r.status === "cancelled")
    throw new HttpError(409, "报名已取消，请使用独立现场入口或联系工作人员。");
  if (before.fieldOpen === false) throw new HttpError(409, "现场尚未开放。");
  let actor = r.participant_epoch === before.epoch ? r.participant_id : null;
  if (actor && !before.participants.some((p) => p.id === actor))
    throw new HttpError(409, "参与状态已变化，请联系工作人员。");
  if (!actor) {
    const token = request ? cookieValue(request, activity, "participant") : "";
    const existing = await c.query(
      "SELECT actor FROM dl_sessions WHERE token_hash=$1 AND activity_id=$2 AND role='participant' AND expires_at>now()",
      [digest(token), activity],
    );
    const candidate = knownActor || existing.rows[0]?.actor;
    if (candidate && before.participants.some((p) => p.id === candidate)) {
      const bound = await c.query(
        "SELECT id FROM dl_registrations WHERE activity_id=$1 AND participant_epoch=$2 AND participant_id=$3",
        [activity, before.epoch, candidate],
      );
      if (bound.rowCount)
        throw new HttpError(409, "此浏览器已关联其他报名，请使用本人设备。");
      actor = candidate;
    } else {
      const next = structuredClone(before);
      const p = newParticipant();
      p.name = r.nickname;
      p.gender = r.fields.gender === "男" ? "male" : "female";
      next.participants.push(p);
      next.scans.push(p.id);
      next.events.push({
        id: `join-${p.id}`,
        at: p.joinedAt,
        type: "JOIN",
        text: "一位参与者进入活动",
        participantId: p.id,
      });
      actor = p.id;
      await save(c, activity, before, next);
    }
    await c.query(
      "UPDATE dl_registrations SET participant_id=$2,participant_epoch=$3,version=version+1 WHERE id=$1",
      [id, actor, before.epoch],
    );
  }
  return actor as string;
}
