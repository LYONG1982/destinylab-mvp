import { readFile } from "node:fs/promises";
import { database, transaction } from "../src/server/db";
import { emptyActivity } from "../src/server/state";
import { activityId } from "../src/server/service";
import { migrateRegistrationReceipts } from "../src/server/registration-receipt";
import { logServerError } from "./lib/error-log.mjs";

let stage = "activity_id";
let pool: ReturnType<typeof database> | undefined;

async function main() {
  const id = activityId(process.env.DESTINY_ACTIVITY_ID || null);
  stage = "database_pool_create";
  const dbPool = database();
  pool = dbPool;
  const migrations = [
    "001-live.sql",
    "002-private-services.sql",
    "003-wechat-identity.sql",
    "004-tongzhou-agency.sql",
    "005-agency-album.sql",
    "006-agency-user-photos.sql",
    "007-member-wall.sql",
    "008-registration.sql",
    "009-registration-receipts.sql",
    "010-registration-profile-progress.sql",
    "011-registration-birth-date.sql",
    "012-mini-registration-entry.sql",
    "013-mini-content-review.sql",
    "014-agency-unified-members.sql",
  ];

  for (const migration of migrations.slice(0, 9)) {
    stage = `migration_${migration.slice(0, 3)}_sql_read`;
    const sql = await readFile(
      new URL(`../database/${migration}`, import.meta.url),
      "utf8",
    );
    stage = `migration_${migration.slice(0, 3)}_sql_execute`;
    await dbPool.query(sql);
  }

  stage = "registration_receipts_migrate";
  await migrateRegistrationReceipts();

  for (const migration of migrations.slice(9)) {
    stage = `migration_${migration.slice(0, 3)}_sql_read`;
    const sql = await readFile(
      new URL(`../database/${migration}`, import.meta.url),
      "utf8",
    );
    stage = `migration_${migration.slice(0, 3)}_sql_execute`;
    await dbPool.query(sql);
  }

  stage = "activity_insert";
  const created = await transaction(async (client) => {
    const result = await client.query(
      "INSERT INTO dl_activities(id,state) VALUES($1,$2::jsonb) ON CONFLICT(id) DO NOTHING RETURNING id",
      [id, JSON.stringify(emptyActivity())],
    );
    return result.rowCount === 1;
  });
  stage = "activity_select";
  const result = await dbPool.query(
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
    logServerError("database.initialization.failed", error, {
      stage,
      activity: process.env.DESTINY_ACTIVITY_ID || undefined,
    });
    console.error("初始化未完成，请检查受保护运行配置与数据库连接。");
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
