import { readFile } from "node:fs/promises";
import { database } from "../src/server/db";
import { migrateRegistrationReceipts } from "../src/server/registration-receipt";

async function main() {
  const expected = process.env.DESTINY_MIGRATE_DATABASE;
  if (
    !expected ||
    new URL(process.env.DATABASE_URL || "").pathname !== `/${expected}`
  )
    throw new Error("Explicit database confirmation required");
  await database().query(
    await readFile(
      new URL("../database/009-registration-receipts.sql", import.meta.url),
      "utf8",
    ),
  );
  console.log(JSON.stringify(await migrateRegistrationReceipts()));
}
main()
  .catch(() => {
    console.error(
      "凭证迁移未完成，请检查目标数据库配置与旧数据格式；未提交的转换已回滚。",
    );
    process.exitCode = 1;
  })
  .finally(() => database().end());
