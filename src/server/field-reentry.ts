import "server-only";
import { ACTIVE_STATUSES } from "@/domain/selectors";
import { transaction } from "./db";
import { keys } from "./private-http";
import {
  digest,
  HttpError,
  load,
  rateLimit,
  save,
  participationEnded,
  type Session,
} from "./service";

/** Only an authenticated, explicit participant action may restore attendance. */
export async function reenterField(
  activity: string,
  session: Session,
  input: Record<string, unknown>,
  id: string,
) {
  if (session.role !== "participant")
    throw new HttpError(403, "只能恢复本人的现场身份。");
  keys(input, ["epoch"]);
  if (typeof input.epoch !== "string" || !/^[A-Za-z0-9_-]{8,120}$/.test(id))
    throw new HttpError(400, "入场请求无效，请刷新后重试。");
  await rateLimit(`reenter:${activity}:${session.actor}`, 60);
  return transaction(async (c) => {
    const before = await load(c, activity, true);
    if (input.epoch !== before.epoch)
      throw new HttpError(409, "轮次已变化，请重新打开现场入口。");
    const removed = await c.query(
      "SELECT 1 FROM dl_field_removed WHERE activity_id=$1 AND epoch=$2 AND actor=$3",
      [activity, before.epoch, session.actor],
    );
    const participant = before.participants.find((p) => p.id === session.actor);
    if (removed.rowCount || !participant)
      throw await participationEnded(activity, before, session.actor, c);
    if (before.fieldOpen === false)
      throw new HttpError(409, "现场暂未开放，请稍后再来。");
    const payload = { type: "field-reenter", epoch: before.epoch };
    const hash = digest(JSON.stringify(payload));
    const prior = await c.query(
      "SELECT payload_hash FROM dl_commands WHERE activity_id=$1 AND actor=$2 AND command_id=$3",
      [activity, session.actor, id],
    );
    if (prior.rows[0]) {
      if (prior.rows[0].payload_hash !== hash)
        throw new HttpError(409, "重复提交的内容不一致。");
      // A delayed retry must never undo a subsequent administrator departure.
      return;
    }
    let revision = before.revision;
    if (!participant.present) {
      const invitation = before.invitations.find(
        (i) => i.id === participant.currentId,
      );
      if (invitation && ACTIVE_STATUSES.includes(invitation.status))
        throw new HttpError(409, "当前相遇状态待确认，请联系工作人员。");
      const next = structuredClone(before);
      const me = next.participants.find((p) => p.id === session.actor)!;
      me.present = true;
      me.ready = false;
      me.currentId = null;
      // Keep paused, answers, profile, photos, invitations and physical point occupancy.
      next.events.push({
        id: `reenter-${session.actor}-${id}`,
        at: Date.now(),
        type: "REENTER",
        text: "一位参与者主动返回现场",
        participantId: session.actor,
      });
      await save(c, activity, before, next);
      revision = next.revision;
    }
    await c.query(
      "INSERT INTO dl_commands(activity_id,actor,command_id,payload_hash,revision,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb)",
      [activity, session.actor, id, hash, revision, JSON.stringify(payload)],
    );
  });
}
