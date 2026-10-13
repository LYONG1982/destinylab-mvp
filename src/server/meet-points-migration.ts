import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { completeMeetPoints } from "@/domain/meet-points";
import { transaction } from "./db";
import { activityId, load, save } from "./service";

/** Explicit maintenance operation, never called from reads or recurring startup. */
export async function migrateMeetPoints(activity: string, backupDir: string) {
  activityId(activity);
  const fromRepository = relative(process.cwd(), backupDir);
  if (!isAbsolute(backupDir) || !fromRepository.startsWith("../"))
    throw Error("Backup directory must be outside the repository");
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  return transaction(async (client) => {
    const before = await load(client, activity, true);
    const points = completeMeetPoints(before.points);
    const added = points.length - before.points.length;
    if (!added) return { activity, added, total: points.length, backup: null };
    const backup = join(backupDir, `${activity}-${randomUUID()}.json`);
    // Abort before any database change if the protected backup cannot be written.
    await writeFile(backup, JSON.stringify({ activity, state: before }), {
      flag: "wx",
      mode: 0o600,
    });
    const next = structuredClone(before);
    next.points = points;
    next.events.push({
      id: randomUUID(),
      at: Date.now(),
      type: "POINT_DEFAULTS",
      text: `补齐 ${added} 个默认相遇点`,
    });
    await save(client, activity, before, next);
    return { activity, added, total: points.length, backup };
  });
}
