import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { DemoState } from "@/domain/types";
import { pointOccupants, setPointOccupants } from "@/domain/encounters";
import { applyCommand } from "@/domain/commands";
import { emptyActivity } from "./state";
import { database, transaction } from "./db";
import { HttpError, load, save, digest, rateLimit } from "./service";
import { keys } from "./private-http";

export async function fieldActivities() {
  return (
    await database()
      .query(`SELECT a.id,COALESCE(c.config->>'title',a.id) AS title,
    COALESCE((a.state->>'fieldOpen')::boolean,true) AS open,
    COALESCE((c.config->>'open')::boolean,false) AS registration_open,
    a.state->>'epoch' AS epoch FROM dl_activities a LEFT JOIN dl_registration_config c ON c.activity_id=a.id ORDER BY a.id`)
  ).rows;
}
export async function fieldOverview(activity: string) {
  const state = await transaction((c) => load(c, activity));
  const actions = (
    await database().query(
      "SELECT action,staff,result,created_at FROM dl_field_actions WHERE activity_id=$1 ORDER BY created_at DESC LIMIT 30",
      [activity],
    )
  ).rows;
  const archives = (
    await database().query(
      "SELECT id,epoch,action,created_at,jsonb_array_length(snapshot->'participants') AS participants FROM dl_field_archives WHERE activity_id=$1 ORDER BY created_at DESC LIMIT 30",
      [activity],
    )
  ).rows;
  return {
    activities: await fieldActivities(),
    epoch: state.epoch,
    open: state.fieldOpen !== false,
    actions,
    archives,
  };
}
type RequestInput = Record<string, unknown>;
function validate(input: RequestInput) {
  keys(input, [
    "action",
    "ids",
    "epoch",
    "preview",
    "confirmation",
    "cleared",
    "target",
    "copySettings",
  ]);
  if (
    !["leave", "return", "remove", "reset", "open", "close", "create"].includes(
      String(input.action),
    )
  )
    throw new HttpError(400, "操作无效。");
  const ids = input.ids ?? [];
  if (
    !Array.isArray(ids) ||
    ids.length > 100 ||
    new Set(ids).size !== ids.length ||
    ids.some((x) => typeof x !== "string" || x.length > 120)
  )
    throw new HttpError(400, "请选择最多100位参与者。");
  if (
    ["leave", "return", "remove"].includes(String(input.action)) &&
    !ids.length
  )
    throw new HttpError(400, "请先选择参与者。");
  return ids as string[];
}
function fingerprint(s: DemoState, input: RequestInput, ids: string[]) {
  return digest(
    JSON.stringify({
      epoch: s.epoch,
      action: input.action,
      open: s.fieldOpen,
      ids,
      people: s.participants.filter(
        (p) => ids.includes(p.id) || input.action === "reset",
      ),
      invitations: s.invitations,
      points: s.points,
      helps: s.helps,
      grants: s.displayGrants,
    }),
  );
}
async function preservePhotos(
  c: PoolClient,
  activity: string,
  s: DemoState,
  ids: string[],
) {
  for (const p of s.participants.filter(
    (p) => ids.includes(p.id) && p.photo?.id,
  )) {
    const authorized = await c.query(
      "SELECT 1 FROM dl_agency_sources WHERE activity_id=$1 AND actor=$2 AND active",
      [activity, p.id],
    );
    if (!authorized.rowCount) continue;
    await c.query(
      `INSERT INTO dl_agency_retained_photos(activity_id,actor,id,bytes,created_at)
      SELECT a.activity_id,a.actor,a.id,a.bytes,a.created_at FROM dl_avatar_assets a
      JOIN dl_agency_sources x ON x.activity_id=a.activity_id AND x.actor=a.actor AND x.active
      WHERE a.activity_id=$1 AND a.actor=$2 AND a.id=$3 AND a.attached ON CONFLICT DO NOTHING`,
      [activity, p.id, p.photo!.id],
    );
    if (
      !(
        await c.query(
          "SELECT 1 FROM dl_agency_retained_photos WHERE activity_id=$1 AND actor=$2 AND id=$3",
          [activity, p.id, p.photo!.id],
        )
      ).rowCount
    )
      throw new HttpError(
        409,
        "已授权照片暂不可保留，本次未清理，请检查照片后重试。",
      );
  }
}
export async function fieldPreview(activity: string, input: RequestInput) {
  const ids = validate(input);
  return transaction(async (c) => {
    const s = await load(c, activity, true);
    if (input.epoch !== s.epoch)
      throw new HttpError(409, "轮次已变化，请刷新。");
    if (ids.some((id) => !s.participants.some((p) => p.id === id)))
      throw new HttpError(409, "所选参与者已变化。");
    const authorized = (
      await c.query(
        "SELECT actor FROM dl_agency_sources WHERE activity_id=$1 AND active",
        [activity],
      )
    ).rows.map((x) => x.actor as string);
    return {
      token: fingerprint(s, input, ids),
      participants:
        input.action === "reset" ? s.participants.length : ids.length,
      invitations: s.invitations.filter(
        (i) =>
          input.action === "reset" ||
          ids.includes(i.from) ||
          ids.includes(i.to),
      ).length,
      retainedPhotos: s.participants.filter(
        (p) =>
          p.photo &&
          authorized.includes(p.id) &&
          (input.action === "reset" || ids.includes(p.id)),
      ).length,
      preserves: "报名、同舟档案、已授权照片与公开主页保持不变",
    };
  });
}
export async function fieldAction(
  activity: string,
  input: RequestInput,
  id: string,
) {
  const ids = validate(input),
    action = String(input.action);
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(id))
    throw new HttpError(400, "操作标识无效。");
  await rateLimit(`field-maintenance:${activity}`, 60);
  return transaction(async (c) => {
    const s = await load(c, activity, true),
      hash = digest(JSON.stringify(input));
    const prior = (
      await c.query(
        "SELECT payload_hash,result FROM dl_field_actions WHERE activity_id=$1 AND command_id=$2",
        [activity, id],
      )
    ).rows[0];
    if (prior) {
      if (prior.payload_hash !== hash)
        throw new HttpError(409, "重复操作内容不同。");
      return prior.result;
    }
    if (input.epoch !== s.epoch)
      throw new HttpError(409, "轮次已变化，请重新预览。");
    if (ids.some((key) => !s.participants.some((p) => p.id === key)))
      throw new HttpError(409, "名单已变化，请重新选择。");
    if (
      ["leave", "return", "remove", "reset"].includes(action) &&
      input.preview !== fingerprint(s, input, ids)
    )
      throw new HttpError(409, "现场状态已变化，请重新预览确认。");
    let next = structuredClone(s),
      archive: string | null = null;
    if (action === "create") {
      if (
        typeof input.target !== "string" ||
        !/^[a-z0-9][a-z0-9-]{0,47}$/.test(input.target)
      )
        throw new HttpError(400, "活动标识为小写字母、数字或横线，最多48位。");
      const fresh = emptyActivity();
      fresh.fieldOpen = false;
      if (input.copySettings === true) {
        fresh.points = s.points.map((p) => ({ ...p, occupant: null, occupants: [], retainedCodes: [] }));
        fresh.merchants = structuredClone(s.merchants);
        fresh.displayQuestionId = s.displayQuestionId;
      }
      const added = await c.query(
        "INSERT INTO dl_activities(id,state) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id",
        [input.target, JSON.stringify(fresh)],
      );
      if (!added.rowCount) throw new HttpError(409, "该活动标识已存在。");
      if (input.copySettings === true)
        await c.query(
          "INSERT INTO dl_member_wall_config(activity_id,config) SELECT $2,config FROM dl_member_wall_config WHERE activity_id=$1",
          [activity, input.target],
        );
    } else if (action === "open" || action === "close") {
      next.fieldOpen = action === "open";
    } else if (action === "reset") {
      if (s.fieldOpen !== false)
        throw new HttpError(409, "请先关闭现场，再预览清零。");
      if (input.confirmation !== activity || input.cleared !== true)
        throw new HttpError(400, "请输入活动标识并确认场地已清场。");
      await preservePhotos(
        c,
        activity,
        s,
        s.participants.map((p) => p.id),
      );
      archive = randomUUID();
      await c.query(
        "INSERT INTO dl_field_archives(id,activity_id,epoch,action,snapshot) VALUES($1,$2,$3,$4,$5)",
        [archive, activity, s.epoch, action, JSON.stringify(s)],
      );
      next = emptyActivity();
      next.fieldOpen = false;
      next.points = s.points.map((p) => ({ ...p, occupant: null, occupants: [], retainedCodes: [] }));
      next.merchants = s.merchants;
      next.displayQuestionId = s.displayQuestionId;
      for (const table of [
        "dl_member_wall_sessions",
        "dl_member_wall_consents",
        "dl_member_wall_exposure",
      ])
        await c.query(`DELETE FROM ${table} WHERE activity_id=$1`, [activity]);
    } else {
      for (const key of ids)
        next = applyCommand(next, {
          actor: "operator",
          id: `${id}-${key}`,
          epoch: s.epoch,
          command: {
            type: "participant",
            participantId: key,
            action: action === "return" ? "return" : "leave",
          },
        });
      if (action === "remove") {
        await preservePhotos(c, activity, s, ids);
        archive = randomUUID();
        await c.query(
          "INSERT INTO dl_field_archives(id,activity_id,epoch,action,snapshot) VALUES($1,$2,$3,$4,$5)",
          [archive, activity, s.epoch, action, JSON.stringify(s)],
        );
        const removedInv = next.invitations
          .filter((i) => ids.includes(i.from) || ids.includes(i.to))
          .map((i) => i.id);
        for (const p of next.participants)
          if (p.currentId && removedInv.includes(p.currentId))
            p.currentId = null;
        next.participants = next.participants.filter(
          (p) => !ids.includes(p.id),
        );
        next.invitations = next.invitations.filter(
          (i) => !removedInv.includes(i.id),
        );
        next.helps = next.helps.filter(
          (h) =>
            !ids.includes(h.participantId) &&
            !removedInv.includes(h.invitationId),
        );
        next.scans = next.scans.filter((x) => !ids.includes(x));
        for (const key of ids) delete next.responses[key];
        next.merchantViews = next.merchantViews.filter(
          (x) => !removedInv.some((i) => x.startsWith(i + ":")),
        );
        next.events = next.events.filter(
          (e) =>
            !ids.includes(e.participantId || "") &&
            !removedInv.includes(e.invitationId || ""),
        );
        next.broadcastConsumed = next.broadcastConsumed.filter(
          (x) => !removedInv.includes(x),
        );
        for (const key of removedInv) delete next.displayGrants?.[key];
        for (const p of next.points)
          if (pointOccupants(p).some(id => removedInv.includes(id))) {
            p.retainedCodes = [...new Set([...(p.retainedCodes || []), ...s.invitations.filter(i => removedInv.includes(i.id) && pointOccupants(p).includes(i.id)).flatMap(i => Object.values(i.encounterCodes || {}))])];
            setPointOccupants(p, pointOccupants(p).filter(id => !removedInv.includes(id)));
            p.closed = true;
          }
        for (const key of ids)
          await c.query(
            "INSERT INTO dl_field_removed VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
            [activity, s.epoch, key],
          );
        await c.query(
          "DELETE FROM dl_member_wall_exposure WHERE activity_id=$1 AND public_id IN (SELECT public_id FROM dl_member_wall_consents WHERE activity_id=$1 AND participant_id=ANY($2::text[]))",
          [activity, ids],
        );
        await c.query(
          "UPDATE dl_member_wall_sessions SET visible_ids=COALESCE((SELECT jsonb_agg(CASE WHEN x #>> '{}' IN (SELECT public_id::text FROM dl_member_wall_consents WHERE activity_id=$1 AND participant_id=ANY($2::text[])) THEN to_jsonb(''::text) ELSE x END) FROM jsonb_array_elements(visible_ids) x),'[]'::jsonb) WHERE activity_id=$1",
          [activity, ids],
        );
        await c.query(
          "DELETE FROM dl_member_wall_consents WHERE activity_id=$1 AND participant_id=ANY($2::text[])",
          [activity, ids],
        );
      }
    }
    if (action !== "create") await save(c, activity, s, next);
    const result = {
      ok: true,
      action,
      count: action === "reset" ? s.participants.length : ids.length,
      epoch: next.epoch,
      previousEpoch: s.epoch,
      archive,
      target: input.target || null,
    };
    await c.query(
      "INSERT INTO dl_field_actions(activity_id,command_id,payload_hash,action,staff,result) VALUES($1,$2,$3,$4,$5,$6)",
      [
        activity,
        id,
        hash,
        action,
        process.env.DESTINY_OPERATOR_USERNAME || "operator",
        JSON.stringify(result),
      ],
    );
    return result;
  });
}
