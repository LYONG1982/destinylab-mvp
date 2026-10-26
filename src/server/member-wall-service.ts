import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { DemoState } from "@/domain/types";
import { DEFAULT_WALL_CONFIG, WALL_CONSENT_VERSION, WALL_QUESTION_IDS, WALL_TTL_MS, WALL_COLUMNS, WALL_CAPACITY, memberCard, rotateWallSlots, pruneWallSlots, type WallSlots,
  validateWallConfig, wallDemographics, wallNickname, type PublicMemberCard, type WallCandidate, type WallConfig } from "@/domain/member-wall";
import { transaction } from "./db";
import { liveConfig } from "./config";
import { HttpError, digest, load, save, type Session } from "./service";
import { keys } from "./private-http";

interface Grant {
  participant_id: string; epoch: string; public_id: string; encounter_code: string;
  nickname: string; allowed: boolean; version: number; consent_version: string; question_ids: string[];
}
interface DisplaySession {
  epoch: string; token_hash: string; owner: string; visible_ids: WallSlots; batch: number;
  sequence: string; capacity: number; started_at: Date; heartbeat_at: Date; rotated_at: Date; expires_at: Date;
}
type Candidate = WallCandidate & { card: PublicMemberCard };
interface Context {
  activity: string; state: DemoState; config: WallConfig; configVersion: number; grants: Grant[];
  candidates: Candidate[]; screen?: DisplaySession;
}
export function wallEnabled() {
  if (process.env.DESTINY_DATA_MODE !== "server" || process.env.DESTINY_MEMBER_WALL_ENABLED !== "true")
    throw new HttpError(404, "卡牌墙尚未开放。");
  liveConfig();
}
function participant(session: Session) { if (session.role !== "participant") throw new HttpError(403, "请使用本人活动身份。"); }
function operator(session: Session) { if (session.role !== "operator") throw new HttpError(403, "需要运营权限。"); }
function validated<T>(fn: () => T): T { try { return fn(); } catch (e) { throw new HttpError(400, e instanceof Error ? e.message : "请求无效。"); } }
async function context(client: PoolClient, activity: string): Promise<Context> {
  const state = await load(client, activity, true);
  const cr = await client.query("SELECT config,version FROM dl_member_wall_config WHERE activity_id=$1", [activity]);
  const grants = (await client.query("SELECT * FROM dl_member_wall_consents WHERE activity_id=$1", [activity])).rows as Grant[];
  const exposures = (await client.query("SELECT public_id,visible_ms,last_shown_at FROM dl_member_wall_exposure WHERE activity_id=$1", [activity])).rows;
  const screen = (await client.query("SELECT * FROM dl_member_wall_sessions WHERE activity_id=$1", [activity])).rows[0] as DisplaySession | undefined;
  const candidates: Candidate[] = [];
  for (const g of grants) {
    const p = state.participants.find((p) => p.id === g.participant_id);
    if (!p || !g.allowed || g.epoch !== state.epoch || g.consent_version !== WALL_CONSENT_VERSION ||
      JSON.stringify(g.question_ids) !== JSON.stringify(WALL_QUESTION_IDS) || p.present !== true || p.paused !== false ||
      p.profileComplete !== true || !["male", "female"].includes(p.gender)) continue;
    try {
      const e = exposures.find((e) => e.public_id === g.public_id);
      candidates.push({ id: g.public_id, seconds: Number(e?.visible_ms || 0) / 1000,
        last: e?.last_shown_at ? new Date(e.last_shown_at).getTime() : 0, joined: p.joinedAt,
        card: memberCard(p, g.public_id, g.encounter_code, g.nickname) });
    } catch { /* Unknown legacy text or invalid avatars fail closed. */ }
  }
  return { activity, state, config: { ...(cr.rows[0]?.config || DEFAULT_WALL_CONFIG), minColumns: WALL_COLUMNS, maxColumns: WALL_COLUMNS }, configVersion: cr.rows[0]?.version || 0,
    grants, candidates, screen };
}
function groupedCandidates(ctx: Context) { return ctx.candidates.map((c) => ({ ...c, gender: c.card.gender })); }
function compatibleScreen(s: DisplaySession) { return s.capacity === WALL_CAPACITY && s.visible_ids.length === WALL_CAPACITY; }
function publicSnapshot(ctx: Context) {
  const now = Date.now(), active = ctx.screen && compatibleScreen(ctx.screen) && ctx.screen.epoch === ctx.state.epoch && ctx.screen.expires_at.getTime() > now && ctx.config.mode === "real";
  const map = new Map(ctx.candidates.map((c) => [c.id, c.card]));
  const slots = active ? pruneWallSlots(groupedCandidates(ctx), ctx.screen!.visible_ids) : [];
  const cards = slots.flatMap((id, slot) => id && map.has(id) ? [{ ...map.get(id)!, slot }] : []);
  return { activity: ctx.activity, epoch: ctx.state.epoch, revision: ctx.state.revision,
    configVersion: ctx.configVersion, config: ctx.config, cards,
    ...wallDemographics(ctx.state.participants), eligible: ctx.candidates.length,
    activeScreen: !!active, batch: ctx.screen?.batch || 0, serverTime: now, cycleStartedAt: ctx.screen?.started_at.getTime() || 0,
    validForMs: active ? Math.max(0, Math.min(WALL_TTL_MS, ctx.screen!.expires_at.getTime() - now)) : WALL_TTL_MS,
    joinUrl: `${liveConfig().origin}/mobile/01-start?activity=${encodeURIComponent(ctx.activity)}` };
}
async function bump(client: PoolClient, ctx: Context) {
  const next = structuredClone(ctx.state); await save(client, ctx.activity, ctx.state, next); ctx.state = next;
}
export async function wallSnapshot(activity: string) { wallEnabled(); return transaction(async (c) => publicSnapshot(await context(c, activity))); }
export async function wallMe(activity: string, session: Session) {
  wallEnabled(); participant(session);
  return transaction(async (client) => {
    const ctx = await context(client, activity), p = ctx.state.participants.find((p) => p.id === session.actor);
    if (!p) throw new HttpError(404, "活动资料不存在。");
    const g = ctx.grants.find((g) => g.participant_id === session.actor && g.epoch === ctx.state.epoch);
    let preview: PublicMemberCard | null = null;
    const nickname = g?.nickname || "";
    let previewNickname = nickname || "我的昵称";
    try { if (!nickname) previewNickname = wallNickname(p.name); } catch { /* The user can choose a new nickname without exposing the original name. */ }
    if (["male", "female"].includes(p.gender)) preview = memberCard(p, g?.public_id || "preview-only", g?.encounter_code || "MW-00000000", previewNickname);
    return { version: g?.version || 0, allowed: !!g?.allowed && g.consent_version === WALL_CONSENT_VERSION,
      nickname, preview, eligible: ctx.candidates.some((c) => c.id === g?.public_id), consentVersion: WALL_CONSENT_VERSION };
  });
}
export async function wallConsent(activity: string, session: Session, input: Record<string, unknown>) {
  wallEnabled(); participant(session); keys(input, ["allow", "nickname", "expectedVersion", "consentVersion"]);
  if (typeof input.allow !== "boolean" || !Number.isSafeInteger(input.expectedVersion) || input.consentVersion !== WALL_CONSENT_VERSION)
    throw new HttpError(400, "请重新预览并确认当前公开范围。");
  await transaction(async (client) => {
    const ctx = await context(client, activity), p = ctx.state.participants.find((p) => p.id === session.actor);
    if (!p) throw new HttpError(404, "活动资料不存在。");
    if (input.allow && (!p.profileComplete || !p.present || p.paused || !["male", "female"].includes(p.gender))) throw new HttpError(409, "请先完善活动资料，或联系工作人员确认参与状态。");
    const old = ctx.grants.find((g) => g.participant_id === session.actor);
    const currentVersion = old?.epoch === ctx.state.epoch ? old.version : 0;
    if (input.expectedVersion !== currentVersion) throw new HttpError(409, "展示许可已变化，请刷新后重新确认。");
    const nickname = input.allow ? validated(() => wallNickname(input.nickname)) : old?.nickname || "未公开";
    await client.query(`INSERT INTO dl_member_wall_consents(activity_id,participant_id,epoch,public_id,encounter_code,nickname,allowed,version,consent_version,question_ids,allowed_at,revoked_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,CASE WHEN $7 THEN now() END,CASE WHEN NOT $7 THEN now() END)
      ON CONFLICT(activity_id,participant_id) DO UPDATE SET epoch=EXCLUDED.epoch,nickname=EXCLUDED.nickname,allowed=EXCLUDED.allowed,version=EXCLUDED.version,
      consent_version=EXCLUDED.consent_version,question_ids=EXCLUDED.question_ids,allowed_at=EXCLUDED.allowed_at,revoked_at=EXCLUDED.revoked_at,updated_at=now()`,
    [activity, session.actor, ctx.state.epoch, old?.public_id || randomUUID(), old?.encounter_code || `MW-${randomBytes(4).toString("hex").toUpperCase()}`,
      nickname, input.allow, currentVersion + 1, WALL_CONSENT_VERSION, JSON.stringify(WALL_QUESTION_IDS)]);
    await bump(client, ctx);
  });
  return wallMe(activity, session);
}
export async function wallAdmin(activity: string, session: Session) {
  wallEnabled(); operator(session);
  return transaction(async (c) => {
    const ctx = await context(c, activity);
    return { ...publicSnapshot(ctx), exposure: ctx.candidates.map((x) => ({ code: x.card.encounterCode, nickname: x.card.nickname, seconds: x.seconds, last: x.last })) };
  });
}
export async function wallConfigure(activity: string, session: Session, input: Record<string, unknown>) {
  wallEnabled(); operator(session); keys(input, ["config", "expectedVersion"]);
  const config = validated(() => validateWallConfig(input.config));
  await transaction(async (client) => {
    const ctx = await context(client, activity);
    if (input.expectedVersion !== ctx.configVersion) throw new HttpError(409, "配置已变化，请刷新后重试。");
    await client.query(`INSERT INTO dl_member_wall_config(activity_id,config) VALUES($1,$2::jsonb)
      ON CONFLICT(activity_id) DO UPDATE SET config=EXCLUDED.config,version=dl_member_wall_config.version+1,updated_at=now()`, [activity, JSON.stringify(config)]);
    // A config change starts a fresh, explicit main-screen session, avoiding two conflicting clocks.
    await client.query("DELETE FROM dl_member_wall_sessions WHERE activity_id=$1", [activity]);
    await bump(client, ctx);
  });
  return wallAdmin(activity, session);
}
function capacity(value: unknown) {
  if (value !== WALL_CAPACITY) throw new HttpError(400, "布局已更新为四行六列，请刷新大屏后重新启动。");
  return Number(value);
}
export async function wallClaim(activity: string, session: Session, input: Record<string, unknown>) {
  wallEnabled(); operator(session); keys(input, ["owner", "capacity"]);
  const size = capacity(input.capacity);
  if (typeof input.owner !== "string" || !/^[a-f0-9-]{36}$/.test(input.owner)) throw new HttpError(400, "展示窗口标识无效。");
  return transaction(async (client) => {
    const ctx = await context(client, activity);
    if (ctx.config.mode !== "real") throw new HttpError(409, "当前为演示模式。");
    if (ctx.screen && compatibleScreen(ctx.screen) && ctx.screen.expires_at.getTime() > Date.now()) throw new HttpError(409, "已有主屏正在展示；关闭后等待 15 秒再启动。");
    const token = randomBytes(32).toString("base64url"), ids = rotateWallSlots(groupedCandidates(ctx), [], ctx.config.ratio, false);
    await client.query(`INSERT INTO dl_member_wall_sessions(activity_id,epoch,token_hash,owner,visible_ids,capacity,expires_at)
      VALUES($1,$2,$3,$4,$5::jsonb,$6,now()+interval '15 seconds') ON CONFLICT(activity_id) DO UPDATE SET epoch=EXCLUDED.epoch,
      token_hash=EXCLUDED.token_hash,owner=EXCLUDED.owner,visible_ids=EXCLUDED.visible_ids,capacity=EXCLUDED.capacity,batch=dl_member_wall_sessions.batch+1,
      sequence=0,started_at=now(),heartbeat_at=now(),rotated_at=now(),expires_at=EXCLUDED.expires_at`,
    [activity, ctx.state.epoch, digest(token), input.owner, JSON.stringify(ids), size]);
    await bump(client, ctx);
    return { token, snapshot: publicSnapshot(await context(client, activity)) };
  });
}
export async function wallScreenCommand(activity: string, action: "heartbeat" | "rotate", input: Record<string, unknown>) {
  wallEnabled(); keys(input, action === "heartbeat" ? ["token", "sequence", "batch", "elapsedMs"] : ["token", "batch", "capacity"]);
  if (typeof input.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(input.token)) throw new HttpError(401, "请从运营后台启动主屏。");
  return transaction(async (client) => {
    const ctx = await context(client, activity), s = ctx.screen, now = Date.now();
    if (!s || !compatibleScreen(s) || s.token_hash !== digest(input.token as string) || s.epoch !== ctx.state.epoch || s.expires_at.getTime() <= now || ctx.config.mode !== "real")
      throw new HttpError(401, "主屏会话已失效，请重新启动。");
    const slots = pruneWallSlots(groupedCandidates(ctx), s.visible_ids);
    if (action === "heartbeat") {
      if (!Number.isSafeInteger(input.sequence) || Number(input.sequence) < 1 || !Number.isFinite(input.elapsedMs) || Number(input.elapsedMs) < 0 || Number(input.elapsedMs) > 5000)
        throw new HttpError(400, "展示回执无效。");
      if (Number(input.sequence) <= Number(s.sequence)) return publicSnapshot(ctx);
      const gap = now - s.heartbeat_at.getTime();
      const ms = input.batch === s.batch && gap <= 8000 ? Math.floor(Math.min(gap, Number(input.elapsedMs))) : 0;
      const ids = slots.filter((id): id is string => id !== null);
      for (const id of ids) if (ms > 0) await client.query(`INSERT INTO dl_member_wall_exposure(activity_id,public_id,visible_ms,last_shown_at) VALUES($1,$2,$3,now())
        ON CONFLICT(activity_id,public_id) DO UPDATE SET visible_ms=dl_member_wall_exposure.visible_ms+EXCLUDED.visible_ms,last_shown_at=now()`, [activity, id, ms]);
      // Removal is immediate; replacement waits for the next stable-front rotation.
      // Crediting newly filled slots here would count cards the browser has not painted yet.
      const repaired = slots;
      const changed = JSON.stringify(repaired) !== JSON.stringify(s.visible_ids);
      await client.query(`UPDATE dl_member_wall_sessions SET sequence=$2,heartbeat_at=now(),expires_at=now()+interval '15 seconds',visible_ids=$3::jsonb,batch=batch+$4 WHERE activity_id=$1`,
        [activity, input.sequence, JSON.stringify(repaired), changed ? 1 : 0]);
      if (changed) await bump(client, ctx);
    } else {
      const size = capacity(input.capacity);
      if (input.batch !== s.batch) throw new HttpError(409, "展示批次已变化，请重新同步。");
      const elapsed = now - s.started_at.getTime(), flip = ctx.config.flipSeconds * 1000;
      if (!ctx.config.running || Math.floor(elapsed / (ctx.config.rotationSeconds * 1000)) <= Math.floor((s.rotated_at.getTime() - s.started_at.getTime()) / (ctx.config.rotationSeconds * 1000)) ||
        Math.floor(elapsed / flip) % 2 !== 0 || elapsed % flip < 720 + (size / 4 - 1) * 90)
        throw new HttpError(409, "请等待正面稳定后的换人周期。");
      const ids = rotateWallSlots(groupedCandidates(ctx), s.visible_ids, ctx.config.ratio, true);
      await client.query("UPDATE dl_member_wall_sessions SET visible_ids=$2::jsonb,capacity=$3,batch=batch+1,rotated_at=now(),heartbeat_at=now() WHERE activity_id=$1", [activity, JSON.stringify(ids), size]);
      await bump(client, ctx);
    }
    return publicSnapshot(await context(client, activity));
  });
}
