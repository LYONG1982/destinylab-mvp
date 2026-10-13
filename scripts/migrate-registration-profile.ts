import { readFile } from "node:fs/promises";
import { database } from "../src/server/db";
async function main() {
  const expected = process.env.DESTINY_MIGRATE_DATABASE;
  if (
    !expected ||
    new URL(process.env.DATABASE_URL || "").pathname !== `/${expected}`
  )
    throw Error("Database confirmation required");
  await database().query(
    await readFile(
      new URL(
        "../database/010-registration-profile-progress.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  console.log("Registration profile migration applied");
}
main()
  .catch(() => {
    console.error("档案迁移未完成，请检查受保护配置。");
    process.exitCode = 1;
  })
  .finally(() => database().end());
