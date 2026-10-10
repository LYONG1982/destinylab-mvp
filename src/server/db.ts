import "server-only";
import { Pool, type PoolClient } from "pg";
import { liveConfig } from "./config";
import { databaseOptions } from "./database-options";

const globalDb = globalThis as unknown as { destinyPool?: Pool };
export function database() {
  return (globalDb.destinyPool ??= new Pool(databaseOptions(liveConfig().databaseUrl)));
}
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>) {
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
