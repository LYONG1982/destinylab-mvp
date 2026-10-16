import "server-only";
import { Pool, type PoolClient } from "pg";
import { liveConfig } from "./config";
import { databaseOptions } from "./database-options";
import { logServerError } from "./logging";

const globalDb = globalThis as unknown as { destinyPool?: Pool };
export function database() {
  if (!globalDb.destinyPool) {
    const pool = new Pool(databaseOptions(liveConfig().databaseUrl));
    pool.on("error", (error) =>
      logServerError("database.pool.idle_client_failed", error, {
        stage: "idle_client",
      }),
    );
    globalDb.destinyPool = pool;
  }
  return globalDb.destinyPool;
}
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>) {
  const client = await database().connect();
  let releaseError: Error | undefined;
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      logServerError("database.transaction.rollback_failed", rollbackError, {
        stage: "rollback",
      });
      releaseError =
        rollbackError instanceof Error
          ? rollbackError
          : new Error(String(rollbackError));
    }
    throw error;
  } finally {
    client.release(releaseError);
  }
}
