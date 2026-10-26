export function validateCloudEnvironment(env) {
  if (
    env.DESTINY_DATA_MODE !== "server" ||
    env.DESTINY_ALLOW_LAN_HTTP === "true"
  )
    throw new Error("CLOUD_MODE_INVALID");
  const origin = new URL(env.DESTINY_PUBLIC_URL || "");
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname);
  if (env.DESTINY_MINI_ENABLED === "true" && !local) {
    if (
      (env.DESTINY_MINI_MODERATION || "wechat") !== "wechat" ||
      !/^wx[a-f0-9]{16}$/.test(env.DESTINY_WECHAT_APPID || "") ||
      /^wx0+$/.test(env.DESTINY_WECHAT_APPID || "") ||
      !/^[A-Za-z0-9]{16,32}$/.test(env.DESTINY_WECHAT_CALLBACK_TOKEN || "") ||
      !/^[A-Za-z0-9+/]{43}$/.test(env.DESTINY_WECHAT_CALLBACK_AES_KEY || "")
    )
      throw new Error("CLOUD_WECHAT_CONTENT_REQUIRED");
  }
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
  if (!local && env.DESTINY_DATABASE_SSL !== "verify-full")
    throw new Error("CLOUD_DATABASE_TLS_REQUIRED");
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
