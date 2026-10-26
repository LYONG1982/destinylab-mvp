import "server-only";
import type { PoolClient } from "pg";
import {
  TONGZHOU_CONSENT_VERSION,
  type TongzhouSubmission,
} from "@/domain/tongzhou";
import { HttpError, load } from "./service";

export const agencyPredicate =
  "s.organization_id='tongzhou' AND s.record->>'status'='active' AND s.record->'consent'->>'version'=$2";

// All agency writes lock in the same activity -> submission -> profile order.
export async function agencyCurrent(
  client: PoolClient,
  activity: string,
  actor: string,
) {
  const state = await load(client, activity, true);
  const r = await client.query(
    `SELECT s.record FROM dl_tongzhou_submissions s WHERE s.activity_id=$1 AND ${agencyPredicate} AND s.actor=$3 FOR UPDATE`,
    [activity, TONGZHOU_CONSENT_VERSION, actor],
  );
  if (!r.rowCount) throw new HttpError(404, "资料已撤回、删除或不可查看。");
  return {
    record: r.rows[0].record as TongzhouSubmission,
    photo: state.participants.find((p) => p.id === actor)?.photo?.id || null,
  };
}
