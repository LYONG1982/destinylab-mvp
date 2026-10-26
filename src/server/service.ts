import "server-only";
import {
  createHash,
  randomBytes,
  scrypt as cryptoScrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import type { PoolClient } from "pg";
import type { DemoState } from "@/domain/types";
import type { Audience, LiveCommand } from "@/lib/api/live-types";
import type { WorldEvent } from "@/features/screen/world/types";
import { applyCommand } from "@/domain/commands";
import { ACTIVE_STATUSES } from "@/domain/selectors";
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
  return result.rows[0] as Session;
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
    const removed = await database().query(
      "SELECT 1 FROM dl_field_removed WHERE activity_id=$1 AND epoch=$2 AND actor=$3",
      [activity, state.epoch, session.actor],
    );
    if (removed.rowCount)
      throw new HttpError(410, "你已从本场移除，请联系工作人员。");
    if (!explicit)
      throw new HttpError(410, "本轮参与已结束，请点击重新进入现场。");
  } catch (e) {
    if (!(e instanceof HttpError) || e.status !== 401) throw e;
  }
  await rateLimit(`join:${activity}`, 600);
  const token = randomBytes(32).toString("base64url");
  const participant = newParticipant();
  await transaction(async (client) => {
    const before = await load(client, activity, true);
    if (before.fieldOpen === false)
      throw new HttpError(409, "现场尚未开放，请稍后再来。");
    const next = structuredClone(before);
    next.participants.push(participant);
    next.scans.push(participant.id);
    next.events.push({
      id: `join-${participant.id}`,
      at: participant.joinedAt,
      type: "JOIN",
      text: "一位参与者进入活动",
      participantId: participant.id,
    });
    await client.query(
      "INSERT INTO dl_sessions(token_hash,activity_id,role,actor,expires_at) VALUES($1,$2,'participant',$3,now()+interval '30 days')",
      [digest(token), activity, participant.id],
    );
    await save(client, activity, before, next);
  });
  return {
    session: { actor: participant.id, role: "participant" as const },
    token,
  };
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
      state.invitations.some(
        (i) => i.status === "SENT" && Date.now() - i.createdAt >= 900000,
      )
    ) {
      state = await load(client, activity, true);
      if (
        state.invitations.some(
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
    throw new HttpError(410, "本轮参与已结束，请点击重新进入现场。");
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
      next.points.push({
        id: `point-${command.name}`,
        name: command.name,
        location: "",
        distance: 0,
        occupant: null,
        closed: false,
      });
      next.events.push({
        id,
        at: Date.now(),
        type: "POINT_ADD",
        text: `运营添加相遇点 ${command.name}`,
      });
      next = applyCommand(
        next,
        {
          actor: "operator",
          id: `allocate-${id}`,
          epoch: next.epoch,
          command: { type: "sweep" },
        },
        Date.now(),
      );
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
      const inv = before.invitations.find((i) => i.id === command.invitationId);
      if (
        !inv ||
        ![inv.from, inv.to].includes(session.actor) ||
        !inv.acceptedAt ||
        (!inv.realMeetAt && !ACTIVE_STATUSES.includes(inv.status))
      )
        throw new HttpError(403, "不能修改这次相遇的公开展示许可。");
      next = structuredClone(before);
      next.displayGrants ??= {};
      next.displayGrants[inv.id] ??= {};
      next.displayGrants[inv.id][session.actor] = command.allow;
      next.events.push({
        id,
        at: Date.now(),
        type: "DISPLAY_CONSENT",
        text: command.allow
          ? "参与者允许本次相遇公开展示"
          : "参与者撤回本次相遇公开展示",
        participantId: session.actor,
        invitationId: inv.id,
      });
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
