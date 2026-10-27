import "server-only";
import {
  createHash,
  createHmac,
  randomUUID,
  randomBytes,
  scrypt as cryptoScrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import type { PoolClient } from "pg";
import type { DemoState } from "@/domain/types";
import type { Audience, LiveCommand, RemovedEntry } from "@/lib/api/live-types";
import type { WorldEvent } from "@/features/screen/world/types";
import { applyCommand } from "@/domain/commands";
import { hasEncounterWork, isPointDeleted, pointOccupants, reconcileEncounters } from "@/domain/encounters";
import { database, transaction } from "./db";
import { liveConfig } from "./config";
import {
  liveEvents,
  mobileProjection,
  newParticipant,
  operatorProjection,
  worldProjection,
} from "./state";
import { validateLiveCommand } from "./validate-command";

const scrypt = promisify(cryptoScrypt);
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public removedEntry?: RemovedEntry,
  ) {
    super(message);
  }
}
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function activityId(value: string | null) {
  const id = value || process.env.DESTINY_ACTIVITY_ID || "meet";
  if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(id))
    throw new HttpError(400, "活动入口无效。");
  return id;
}
export const cookieName = (activity: string, role: string) =>
  `dl-${role}-${activity}`;
export function cookieValue(request: Request, activity: string, role: string) {
  const prefix = `${cookieName(activity, role)}=`;
  return (
    request.headers
      .get("cookie")
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(prefix))
      ?.slice(prefix.length) || ""
  );
}
export function sessionCookie(
  activity: string,
  role: string,
  token: string,
  maxAge: number,
) {
  return `${cookieName(activity, role)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${liveConfig().secure ? "; Secure" : ""}`;
}
export interface Session {
  actor: string;
  role: "participant" | "operator";
}
export async function sessionFor(
  request: Request,
  activity: string,
  role: Session["role"],
): Promise<Session> {
  const token = cookieValue(request, activity, role);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new HttpError(401, "请重新进入活动或登录运营后台。");
  const result = await database().query(
    "SELECT actor, role FROM dl_sessions WHERE token_hash=$1 AND activity_id=$2 AND role=$3 AND expires_at > now()",
    [digest(token), activity, role],
  );
  if (!result.rows[0])
    throw new HttpError(401, "会话已失效，请重新进入活动或登录。");
  if (role === "participant")
    await verifyParticipantActor(request, activity, result.rows[0].actor);
  return result.rows[0] as Session;
}
/** Reject stale pages, including older clients without the actor guard, after rejoin. */
export async function verifyParticipantActor(
  request: Request,
  activity: string,
  actor: string,
) {
  const expected = request.headers.get("x-destiny-actor");
  if (expected && expected !== actor)
    throw new HttpError(409, "参与身份已变化，请刷新页面后再操作。");
  if (
    request.method !== "POST" ||
    expected ||
    /\/(session|enter|rejoin|login|logout)$/.test(new URL(request.url).pathname)
  )
    return;
  const successor = await database().query(
    "SELECT 1 FROM dl_commands WHERE activity_id=$1 AND payload->>'type'='field-rejoin' AND payload->>'nextActor'=$2 LIMIT 1",
    [activity, actor],
  );
  if (successor.rowCount)
    throw new HttpError(
      409,
      "参与身份已变化，请刷新页面或更新小程序后再操作。",
    );
}
export async function participationEnded(
  activity: string,
  state: DemoState,
  actor: string,
  client?: PoolClient,
) {
  const removed = await (client || database()).query(
    "SELECT 1 FROM dl_field_removed WHERE activity_id=$1 AND epoch=$2 AND actor=$3",
    [activity, state.epoch, actor],
  );
  return removed.rowCount
    ? new HttpError(410, "上次参与已结束，原记录已归档，可点击重新参与。", {
        actor,
        epoch: state.epoch,
      })
    : new HttpError(410, "本轮参与已结束，请点击重新进入现场。");
}
export async function load(
  client: PoolClient,
  activity: string,
  lock = false,
): Promise<DemoState> {
  const result = await client.query(
    `SELECT state FROM dl_activities WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
    [activity],
  );
  if (!result.rows[0]) throw new HttpError(404, "活动不存在或尚未开放。");
  return result.rows[0].state as DemoState;
}
export async function save(
  client: PoolClient,
  activity: string,
  before: DemoState,
  next: DemoState,
) {
  next.revision = before.revision + 1;
  next.now = Date.now();
  next.wallAt = next.now;
  // The durable idempotency ledger is authoritative; bound the in-document cache.
  next.commands = next.commands.slice(-500);
  await client.query(
    "UPDATE dl_activities SET state=$2::jsonb, revision=$3, updated_at=now() WHERE id=$1",
    [activity, JSON.stringify(next), next.revision],
  );
  await client.query(
    "INSERT INTO dl_events(activity_id, revision, public_events) VALUES($1,$2,$3::jsonb)",
    [
      activity,
      next.revision,
      JSON.stringify(liveEvents(next, before, activity)),
    ],
  );
}
export async function rateLimit(
  bucket: string,
  limit: number,
  windowMs = 60000,
) {
  const windowId = Math.floor(Date.now() / windowMs);
  const result = await database().query(
    "INSERT INTO dl_rate_limits(bucket,window_id) VALUES($1,$2) ON CONFLICT(bucket,window_id) DO UPDATE SET attempts=dl_rate_limits.attempts+1 RETURNING attempts",
    [bucket, windowId],
  );
  if (result.rows[0].attempts > limit)
    throw new HttpError(429, "操作过于频繁，请稍后重试。");
}
export async function join(
  request: Request,
  activity: string,
  explicit = false,
) {
  try {
    const session = await sessionFor(request, activity, "participant");
    const state = await readState(activity);
    if (state.participants.some((p) => p.id === session.actor))
      return { session, token: "" };
    const ended = await participationEnded(activity, state, session.actor);
    if (ended.removedEntry) throw ended;
    if (!explicit)
      throw new HttpError(410, "本轮参与已结束，请点击重新进入现场。");
  } catch (e) {
    if (!(e instanceof HttpError) || e.status !== 401) throw e;
  }
  await rateLimit(`join:${activity}`, 600);
  const entryKey = request.headers.get("x-destiny-entry-key");
  if (entryKey && !/^[A-Za-z0-9_-]{16,120}$/.test(entryKey)) throw new HttpError(400, "入场标识无效。");
  return transaction(async client => {
    const before = await load(client, activity, true);
    if (before.fieldOpen === false) throw new HttpError(409, "现场尚未开放，请稍后再来。");
    const commandId = entryKey ? digest(`entry:${entryKey}`) : null;
    const prior = commandId ? (await client.query(
      "SELECT payload,created_at FROM dl_commands WHERE activity_id=$1 AND actor='@entry' AND command_id=$2",
      [activity, commandId],
    )).rows[0] : null;
    if (prior && prior.payload.epoch !== before.epoch) throw new HttpError(410, "活动轮次已变化，请主动重新进入。");
    if (prior && Date.now() - new Date(prior.created_at).getTime() > 600000) throw new HttpError(410, "入场请求已过期，请主动重新进入。");
    if (prior && !before.participants.some(p => p.id === prior.payload.actor)) throw await participationEnded(activity, before, prior.payload.actor, client);
    const participant = prior ? before.participants.find(p => p.id === prior.payload.actor)! : newParticipant();
    const token = entryKey ? createHmac("sha256", liveConfig().secret).update(`entry:${activity}:${before.epoch}:${entryKey}`).digest("base64url") : randomBytes(32).toString("base64url");
    await client.query(
      "INSERT INTO dl_sessions(token_hash,activity_id,role,actor,expires_at) VALUES($1,$2,'participant',$3,now()+interval '30 days') ON CONFLICT(token_hash) DO NOTHING",
      [digest(token), activity, participant.id],
    );
    if (!prior) {
      const next = structuredClone(before);
      next.participants.push(participant); next.scans.push(participant.id);
      next.events.push({ id: `join-${participant.id}`, at: participant.joinedAt, type: "JOIN", text: "一位参与者进入活动", participantId: participant.id });
      await save(client, activity, before, next);
      if (commandId) await client.query(
        "INSERT INTO dl_commands(activity_id,actor,command_id,payload_hash,revision,payload) VALUES($1,'@entry',$2,$2,$3,$4::jsonb)",
        [activity, commandId, next.revision, JSON.stringify({ type: "entry", epoch: before.epoch, actor: participant.id })],
      );
    }
    return { session: { actor: participant.id, role: "participant" as const }, token };
  });
}

export async function operatorLogin(
  activity: string,
  username: unknown,
  password: unknown,
) {
  if (
    typeof username !== "string" ||
    typeof password !== "string" ||
    username.length > 80 ||
    password.length > 256
  )
    throw new HttpError(400, "请输入有效账号和密码。");
  await rateLimit(`login:${activity}`, 15, 600000);
  const encoded = process.env.DESTINY_OPERATOR_PASSWORD_HASH || "";
  const [algorithm, salt, expectedHex] = encoded.split("$");
  if (
    algorithm !== "scrypt" ||
    !/^[a-f0-9]{32}$/.test(salt || "") ||
    !/^[a-f0-9]{128}$/.test(expectedHex || "")
  )
    throw new HttpError(503, "运营账号尚未配置。");
  const actual = (await scrypt(password, salt, 64)) as Buffer;
  const passwordOk = timingSafeEqual(actual, Buffer.from(expectedHex, "hex"));
  if (
    !passwordOk ||
    username !== (process.env.DESTINY_OPERATOR_USERNAME || "operator")
  )
    throw new HttpError(401, "账号或密码不正确。");
  const token = randomBytes(32).toString("base64url");
  await transaction(async (client) => {
    await load(client, activity);
    await client.query(
      "INSERT INTO dl_sessions(token_hash,activity_id,role,actor,expires_at) VALUES($1,$2,'operator','operator',now()+interval '8 hours')",
      [digest(token), activity],
    );
  });
  return token;
}
export async function logout(
  request: Request,
  activity: string,
  role: Session["role"],
) {
  await database().query(
    "DELETE FROM dl_sessions WHERE token_hash=$1 AND activity_id=$2 AND role=$3",
    [digest(cookieValue(request, activity, role)), activity, role],
  );
}
export async function readState(activity: string) {
  return transaction(async (client) => {
    let state = await load(client, activity);
    if (
      hasEncounterWork(state) || state.invitations.some(
        (i) => i.status === "SENT" && Date.now() - i.createdAt >= 900000,
      )
    ) {
      state = await load(client, activity, true);
      if (
        hasEncounterWork(state) || state.invitations.some(
          (i) => i.status === "SENT" && Date.now() - i.createdAt >= 900000,
        )
      ) {
        const next = applyCommand(
          state,
          {
            actor: "operator",
            id: `expiry-${Date.now()}`,
            epoch: state.epoch,
            command: { type: "sweep" },
          },
          Date.now(),
        );
        await save(client, activity, state, next);
        state = next;
      }
    }
    return state;
  });
}
export async function snapshot(
  activity: string,
  audience: Audience,
  session?: Session,
  after?: number,
) {
  const state = await readState(activity);
  if (audience === "screen") {
    const world = worldProjection(state, activity);
    if (after !== undefined && after >= 0 && after < state.revision) {
      const result = await database().query(
        "SELECT public_events FROM dl_events WHERE activity_id=$1 AND revision>$2 AND revision<=$3 AND created_at>now()-interval '10 seconds' ORDER BY revision DESC LIMIT 64",
        [activity, after, state.revision],
      );
      world.events = result.rows
        .reverse()
        .flatMap((r) => r.public_events as WorldEvent[])
        .slice(-64);
    }
    return { activity, revision: state.revision, world };
  }
  if (!session || session.role !== audience)
    throw new HttpError(401, "请先登录。");
  if (
    audience === "participant" &&
    !state.participants.some((p) => p.id === session.actor)
  )
    throw await participationEnded(activity, state, session.actor);
  const own =
    audience === "participant" &&
    process.env.DESTINY_TONGZHOU_ENABLED === "true"
      ? await database().query(
          "SELECT record FROM dl_tongzhou_submissions WHERE activity_id=$1 AND actor=$2",
          [activity, session.actor],
        )
      : null;
  const projected =
    audience === "operator"
      ? operatorProjection(state, activity)
      : mobileProjection(state, session.actor, activity);
  projected.tongzhouSubmissions = own?.rows.map((r) => r.record) || [];
  return {
    activity,
    revision: state.revision,
    actor: session.actor,
    state: projected,
  };
}
export async function execute(
  activity: string,
  session: Session,
  input: unknown,
  id: string,
  epoch: unknown,
  protocol = "520-v1",
) {
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(id))
    throw new HttpError(400, "提交标识无效。");
  let command: LiveCommand;
  try {
    command = validateLiveCommand(input, session.role);
  } catch (e) {
    throw new HttpError(400, e instanceof Error ? e.message : "操作无效。");
  }
  await rateLimit(`command:${activity}:${session.actor}`, 120);
  return transaction(async (client) => {
    const before = await load(client, activity, true);
    if (session.role === "participant") {
      if (before.fieldOpen === false) throw new HttpError(409, "现场已关闭。");
      if (!before.participants.find((p) => p.id === session.actor)?.present)
        throw new HttpError(409, "你已离场，请点击“继续参与”重新入场。");
    }
    if (epoch !== before.epoch)
      throw new HttpError(409, "活动状态已变化，请刷新后重试。");
    if (session.role === "participant" && protocol !== "520-v1" &&
      (command.type === "invite" || (command.type === "accept" && before.invitations.find(i => i.id === command.invitationId)?.codeVersion === "520")))
      throw new HttpError(409, "本场相遇规则已更新，请刷新页面或更新小程序后再确认认识。");
    const payloadHash = digest(JSON.stringify(command));
    const existing = await client.query(
      "SELECT payload_hash FROM dl_commands WHERE activity_id=$1 AND actor=$2 AND command_id=$3",
      [activity, session.actor, id],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].payload_hash !== payloadHash)
        throw new HttpError(409, "重复提交的内容不一致。");
      return;
    }
    let next: DemoState;
    if (command.type === "point-add") {
      if (before.points.some((p) => p.name === command.name))
        throw new HttpError(409, "这个相遇点已经存在。");
      next = structuredClone(before);
      let pointId = randomUUID();
      while (before.points.some((point) => point.id === pointId)) pointId = randomUUID();
      next.points.push({
        id: pointId,
        name: command.name,
        location: command.location || "",
        distance: 0,
        occupant: null,
        capacity: command.capacity ?? 30,
        closed: false,
      });
      next.events.push({
        id,
        at: Date.now(),
        type: "POINT_ADD",
        text: `运营添加相遇点 ${command.name}`,
      });
      reconcileEncounters(next, Date.now());
    } else if (command.type === "point-remove") {
      const target = before.points.find((point) => point.id === command.pointId);
      if (!target) throw new HttpError(404, "相遇点不存在。");
      next = structuredClone(before);
      const point = next.points.find((item) => item.id === command.pointId)!;
      if (!isPointDeleted(point)) {
        const held = pointOccupants(point).length > 0;
        const retained = (point.retainedCodes || []).length > 0;
        const activeReference = before.invitations.some((invitation) =>
          invitation.pointId === point.id && ["SENT", "ACCEPTED", "MEET_ASSIGNED", "ARRIVING"].includes(invitation.status),
        );
        if (held || retained || activeReference)
          throw new HttpError(409, "该点仍被相遇、待确认空闲记录或归档配对占用，暂不能删除。");
        point.deletedAt = Date.now();
        point.closed = true;
        next.events.push({ id, at: point.deletedAt, type: "POINT_REMOVE", text: `运营删除相遇点 ${point.name}` });
      }
    } else if (command.type === "point-capacity-defaults") {
      next = structuredClone(before);
      const missing = next.points.filter((point) => !isPointDeleted(point) && point.capacity === undefined);
      if (missing.some(point => pointOccupants(point).length + Math.ceil((point.retainedCodes?.length || 0) / 2) > 30))
        throw new HttpError(409, "未配置点位的实际占用超过30对，请逐点配置容量。");
      if (missing.length)
        await client.query(
          "INSERT INTO dl_field_archives(id,activity_id,epoch,action,snapshot) VALUES($1,$2,$3,$4,$5::jsonb)",
          [randomUUID(), activity, before.epoch, "point-capacity-defaults", JSON.stringify(before)],
        );
      for (const point of missing) point.capacity = 30;
      if (missing.length) {
        next.events.push({
          id,
          at: Date.now(),
          type: "POINT_CAPACITY_DEFAULTS",
          text: `运营将 ${missing.length} 个未配置容量的相遇点设为30对`,
        });
        reconcileEncounters(next, Date.now());
      }
    } else if (command.type === "display-question") {
      next = structuredClone(before);
      next.displayQuestionId = command.questionId;
      next.events.push({
        id,
        at: Date.now(),
        type: "DISPLAY_QUESTION",
        text: `运营切换展示题 ${command.questionId}`,
      });
    } else if (command.type === "display-consent") {
      throw new HttpError(409, "本场已采用默认展示，请刷新页面或更新小程序。");
    } else {
      try {
        next = applyCommand(
          before,
          { actor: session.actor, id, epoch: before.epoch, command },
          Date.now(),
        );
      } catch (e) {
        throw new HttpError(
          409,
          e instanceof Error ? e.message : "当前无法完成操作。",
        );
      }
    }
    await save(client, activity, before, next);
    await client.query(
      "INSERT INTO dl_commands(activity_id,actor,command_id,payload_hash,revision,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb)",
      [
        activity,
        session.actor,
        id,
        payloadHash,
        next.revision,
        JSON.stringify(command),
      ],
    );
  });
}
