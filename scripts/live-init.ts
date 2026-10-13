import { readFile } from "node:fs/promises";
import { database, transaction } from "../src/server/db";
import { emptyActivity } from "../src/server/state";
import { activityId } from "../src/server/service";
import { logServerError } from "./lib/error-log.mjs";

let stage = "activity_id";
let pool: ReturnType<typeof database> | undefined;
async function main() {
  const id = activityId(process.env.DESTINY_ACTIVITY_ID || null);
  stage = "database_pool_create";
  pool = database();
  stage = "migration_sql_read";
  const migrationSql = await readFile(
    new URL("../database/001-live.sql", import.meta.url),
    "utf8",
  );
  stage = "migration_sql_execute";
  await pool.query(migrationSql);
  stage = "activity_insert";
  const created = await transaction(async (client) => {
    const result = await client.query(
      "INSERT INTO dl_activities(id,state) VALUES($1,$2::jsonb) ON CONFLICT(id) DO NOTHING RETURNING id",
      [id, JSON.stringify(emptyActivity())],
    );
    return result.rowCount === 1;
  });
  stage = "activity_select";
  const result = await pool.query(
    "SELECT state FROM dl_activities WHERE id=$1",
    [id],
  );
  if (!result.rows[0]?.state) throw new Error("INITIALIZED_ACTIVITY_NOT_FOUND");
  stage = "activity_summary";
  const state = result.rows[0].state;
  console.log(
    JSON.stringify({
      event: "database.initialization.completed",
      activity: id,
      created,
      participants: state.participants.length,
      answers: Object.keys(state.responses).length,
      invitations: state.invitations.length,
      meetings: state.invitations.filter(
        (i: { realMeetAt?: number }) => i.realMeetAt,
      ).length,
      points: state.points.length,
      preservedExistingData: !created,
    }),
  );
}
main()
  .catch((error: unknown) => {
    logServerError("database.initialization.failed", error, { stage });
    process.exitCode = 1;
  })
  .finally(async () => {
    if (!pool) return;
    try {
      stage = "database_pool_close";
      await pool.end();
    } catch (error) {
      logServerError("database.initialization.failed", error, { stage });
      process.exitCode = 1;
    }
  });
