import { readFileSync } from "node:fs";
import type { PoolConfig } from "pg";

export function databaseOptions(
  connectionString: string,
  env: Record<string, string | undefined> = process.env,
): PoolConfig {
  const size = Number(env.DESTINY_DATABASE_POOL_MAX || "12");
  if (!Number.isInteger(size) || size < 1 || size > 12)
    throw new Error("DATABASE_POOL_INVALID");
  const sslMode = env.DESTINY_DATABASE_SSL;
  if (sslMode && !["verify-full", "disable"].includes(sslMode))
    throw new Error("DATABASE_TLS_INVALID");
  const url = new URL(connectionString);
  // pg connection-string SSL parameters otherwise replace the explicit TLS object.
  if (
    sslMode &&
    [...url.searchParams.keys()].some((key) =>
      key.toLowerCase().startsWith("ssl"),
    )
  )
    throw new Error("DATABASE_TLS_CONFLICT");
  const ssl =
    sslMode === "verify-full"
      ? {
          rejectUnauthorized: true,
          ...(env.DESTINY_DATABASE_CA_FILE
            ? { ca: readFileSync(env.DESTINY_DATABASE_CA_FILE, "utf8") }
            : {}),
        }
      : sslMode === "disable"
        ? false
        : undefined;
  return {
    connectionString,
    max: size,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 10000,
    ...(ssl === undefined ? {} : { ssl }),
  };
}
