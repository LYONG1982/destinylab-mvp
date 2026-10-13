export function validateCloudEnvironment(env) {
  if (
    env.DESTINY_DATA_MODE !== "server" ||
    env.DESTINY_ALLOW_LAN_HTTP === "true"
  )
    throw new Error("CLOUD_MODE_INVALID");
  const origin = new URL(env.DESTINY_PUBLIC_URL || "");
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname);
  if (
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== "/" ||
    (origin.protocol !== "https:" && !(local && origin.protocol === "http:"))
  )
    throw new Error("CLOUD_ORIGIN_INVALID");
  const db = new URL(env.DATABASE_URL || "");
  if (
    !["postgres:", "postgresql:"].includes(db.protocol) ||
    !db.hostname ||
    db.pathname.length < 2
  )
    throw new Error("CLOUD_DATABASE_INVALID");
  if (
    !env.DESTINY_SESSION_SECRET ||
    env.DESTINY_SESSION_SECRET.length < 32 ||
    !/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(
      env.DESTINY_OPERATOR_PASSWORD_HASH || "",
    )
  )
    throw new Error("CLOUD_CREDENTIALS_INVALID");
  if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(env.DESTINY_ACTIVITY_ID || ""))
    throw new Error("CLOUD_ACTIVITY_INVALID");
  if (
    env.DESTINY_CLOUD_TEST_TOKEN &&
    (env.DESTINY_CLOUD_TEST_TOKEN.length < 32 ||
      !decodeURIComponent(db.pathname).endsWith("_test") ||
      !env.DESTINY_ACTIVITY_ID.startsWith("cloudtest-"))
  )
    throw new Error("CLOUD_TEST_ISOLATION_REQUIRED");
}
