import { database } from "../src/server/db";
import { migrateMeetPoints } from "../src/server/meet-points-migration";

async function main() {
  const expected = process.env.DESTINY_MIGRATE_DATABASE;
  const activity = process.env.DESTINY_ACTIVITY_ID;
  const backupDir = process.env.DESTINY_BACKUP_DIR;
  if (
    !expected ||
    !activity ||
    !backupDir ||
    decodeURIComponent(
      new URL(process.env.DATABASE_URL || "").pathname.slice(1),
    ) !== expected
  )
    throw Error("Explicit database, activity and backup directory required");
  console.log(JSON.stringify(await migrateMeetPoints(activity, backupDir)));
}
main()
  .catch(() => {
    console.error(
      "遇见地点补齐未完成，请检查指定数据库、活动和仓库外备份目录。",
    );
    process.exitCode = 1;
  })
  .finally(() => database().end());
