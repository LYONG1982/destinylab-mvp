import "server-only";
import { randomBytes } from "node:crypto";
import { transaction } from "./db";
import { newParticipant } from "./state";
import { keys } from "./private-http";
import {
  digest,
  HttpError,
  load,
  rateLimit,
  save,
  type Session,
} from "./service";

/** One successor per removed participation; never restore an archived record. */
export async function rejoinField(
  activity: string,
  owner: { session: Session } | { identity: string },
  input: Record<string, unknown>,
) {
  keys(input, ["actor", "epoch"]);
  if (
    typeof input.actor !== "string" ||
    !/^[A-Za-z0-9_-]{1,120}$/.test(input.actor) ||
    typeof input.epoch !== "string"
  )
    throw new HttpError(400, "重新参与请求无效，请刷新后重试。");
  if ("session" in owner && owner.session.role !== "participant")
    throw new HttpError(403, "只能重新开始本人的参与记录。");
  await rateLimit(
    `rejoin:${activity}:${"identity" in owner ? owner.identity : owner.session.actor}`,
    60,
  );
  return transaction(async (c) => {
    const before = await load(c, activity, true);
    if (input.epoch !== before.epoch)
      throw new HttpError(409, "轮次已变化，请重新打开现场入口。");
    const binding =
      "identity" in owner
        ? (
            await c.query(
              "SELECT actor,epoch FROM dl_wechat_participants WHERE identity_id=$1 AND activity_id=$2",
              [owner.identity, activity],
            )
          ).rows[0]
        : { actor: owner.session.actor, epoch: before.epoch };
    if (!binding || binding.epoch !== before.epoch)
      throw new HttpError(403, "参与身份不匹配，请重新打开现场入口。");
    const commandId = `field-rejoin:${digest(before.epoch).slice(0, 32)}`;
    const prior = (
      await c.query(
        "SELECT payload FROM dl_commands WHERE activity_id=$1 AND actor=$2 AND command_id=$3",
        [activity, input.actor, commandId],
      )
    ).rows[0]?.payload;
    if (binding.actor !== input.actor && binding.actor !== prior?.nextActor)
      throw new HttpError(403, "只能重新开始本人的参与记录。");
    if (
      !(
        await c.query(
          "SELECT 1 FROM dl_field_removed WHERE activity_id=$1 AND epoch=$2 AND actor=$3",
          [activity, before.epoch, input.actor],
        )
      ).rowCount
    )
      throw new HttpError(409, "原参与记录尚未移除，请继续当前参与。");
    if (before.fieldOpen === false)
      throw new HttpError(409, "现场暂未开放，请稍后再来。");
    let actor: string;
    if (prior) {
      const successor = before.participants.find(
        (p) => p.id === prior.nextActor,
      );
      if (!successor)
        throw new HttpError(409, "这次重新参与已结束，请刷新页面后再操作。");
      // Even if later marked absent, an earlier retry cannot restore attendance.
      actor = successor.id;
    } else {
      const next = structuredClone(before),
        participant = newParticipant();
      actor = participant.id;
      next.participants.push(participant);
      next.scans.push(actor);
      next.events.push({
        id: `join-${actor}`,
        at: participant.joinedAt,
        type: "JOIN",
        text: "一位参与者重新进入活动",
        participantId: actor,
      });
      await save(c, activity, before, next);
      const payload = {
        type: "field-rejoin",
        epoch: before.epoch,
        nextActor: actor,
      };
      await c.query(
        "INSERT INTO dl_commands(activity_id,actor,command_id,payload_hash,revision,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb)",
        [
          activity,
          input.actor,
          commandId,
          digest(JSON.stringify(payload)),
          next.revision,
          JSON.stringify(payload),
        ],
      );
    }
    let token = "";
    if ("identity" in owner) {
      await c.query(
        "UPDATE dl_wechat_participants SET actor=$3,epoch=$4 WHERE identity_id=$1 AND activity_id=$2",
        [owner.identity, activity, actor, before.epoch],
      );
      await c.query(
        "UPDATE dl_registrations r SET participant_id=$3,participant_epoch=$4 FROM dl_wechat_registrations w WHERE w.identity_id=$1 AND w.activity_id=$2 AND r.id=w.registration_id AND r.activity_id=$2",
        [owner.identity, activity, actor, before.epoch],
      );
    } else if (binding.actor !== actor) {
      // Rotate the browser session; old in-flight requests remain tied to the removed actor.
      token = randomBytes(32).toString("base64url");
      await c.query(
        "INSERT INTO dl_sessions(token_hash,activity_id,role,actor,expires_at) VALUES($1,$2,'participant',$3,now()+interval '30 days')",
        [digest(token), activity, actor],
      );
    }
    return { session: { actor, role: "participant" as const }, token };
  });
}
