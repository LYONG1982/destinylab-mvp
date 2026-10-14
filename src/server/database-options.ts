import type { PoolConfig } from "pg";

export function databaseOptions(
  connectionString: string,
  env: Record<string, string | undefined> = process.env,
): PoolConfig {
  const size = Number(env.DESTINY_DATABASE_POOL_MAX || "12");
  if (!Number.isInteger(size) || size < 1 || size > 12)
    throw new Error("DATABASE_POOL_INVALID");
  return {
    connectionString,
    max: size,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 10000,
  };
}
