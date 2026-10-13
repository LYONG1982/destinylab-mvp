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
    `SELECT s.record,s.sources,s.latest_source,s.source_actor FROM dl_agency_members s WHERE s.activity_id=$1 AND ${agencyPredicate} AND s.actor=$3`,
    [activity, TONGZHOU_CONSENT_VERSION, actor],
  );
  if (!r.rowCount) throw new HttpError(404, "资料已撤回、删除或不可查看。");
  const sources = await client.query(
    "SELECT actor FROM dl_agency_sources WHERE activity_id=$1 AND member_actor=$2 AND active",
    [activity, actor],
  );
  const actors = sources.rows.map((r) => r.actor as string);
  const participant = state.participants.find(
    (p) => actors.includes(p.id) && p.photo?.id,
  );
  return {
    sourceActor: r.rows[0].source_actor as string,
    sources: r.rows[0].sources as string[],
    latestSource: r.rows[0].latest_source as string,
    photoActor: participant?.id || actor,
    record: r.rows[0].record as TongzhouSubmission,
    photo: participant?.photo?.id || null,
  };
}
