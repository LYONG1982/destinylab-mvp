import { readFile } from "node:fs/promises";
import { database, transaction } from "../src/server/db";
import { emptyActivity } from "../src/server/state";
import { activityId } from "../src/server/service";

import { migrateRegistrationReceipts } from "../src/server/registration-receipt";

async function main() {
  const id = activityId(process.env.DESTINY_ACTIVITY_ID || null);
  await database().query(
    await readFile(
      new URL("../database/001-live.sql", import.meta.url),
      "utf8",
    ),
  );
  await database().query(
    await readFile(
      new URL("../database/002-private-services.sql", import.meta.url),
      "utf8",
    ),
  );
  await database().query(
    await readFile(
      new URL("../database/003-wechat-identity.sql", import.meta.url),
      "utf8",
    ),
  );
  await database().query(
    await readFile(
      new URL("../database/004-tongzhou-agency.sql", import.meta.url),
      "utf8",
    ),
  );
  await database().query(
    await readFile(
      new URL("../database/005-agency-album.sql", import.meta.url),
      "utf8",
    ),
  );
  await database().query(
    await readFile(
      new URL("../database/006-agency-user-photos.sql", import.meta.url),
      "utf8",
    ),
  );
  await database().query(
    await readFile(
      new URL("../database/007-member-wall.sql", import.meta.url),
      "utf8",
    ),
  );
  await database().query(
    await readFile(
      new URL("../database/008-registration.sql", import.meta.url),
      "utf8",
    ),
  );
  await database().query(
    await readFile(
      new URL("../database/009-registration-receipts.sql", import.meta.url),
      "utf8",
    ),
  );
  await migrateRegistrationReceipts();
  await database().query(
    await readFile(
      new URL(
        "../database/010-registration-profile-progress.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await database().query(
    await readFile(
      new URL("../database/011-registration-birth-date.sql", import.meta.url),
      "utf8",
    ),
  );
  await database().query(
    await readFile(
      new URL("../database/012-mini-registration-entry.sql", import.meta.url),
      "utf8",
    ),
  );
  await database().query(
    await readFile(
      new URL("../database/013-mini-content-review.sql", import.meta.url),
      "utf8",
    ),
  );
  await database().query(
    await readFile(
      new URL("../database/014-agency-unified-members.sql", import.meta.url),
      "utf8",
    ),
  );
  const created = await transaction(async (client) => {
    const result = await client.query(
      "INSERT INTO dl_activities(id,state) VALUES($1,$2::jsonb) ON CONFLICT(id) DO NOTHING RETURNING id",
      [id, JSON.stringify(emptyActivity())],
    );
    return result.rowCount === 1;
  });
  const result = await database().query(
    "SELECT state FROM dl_activities WHERE id=$1",
    [id],
  );
  const state = result.rows[0].state;
  console.log(
    JSON.stringify({
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
  .catch(() => {
    console.error("初始化未完成，请检查受保护运行配置与数据库连接。");
    process.exitCode = 1;
  })
  .finally(() => database().end());
