import "server-only";
export function liveConfig() {
  if (process.env.DESTINY_DATA_MODE !== "server")
    throw new Error("LIVE_DISABLED");
  const databaseUrl = process.env.DATABASE_URL;
  const secret = process.env.DESTINY_SESSION_SECRET;
  const baseUrl = process.env.DESTINY_PUBLIC_URL;
  if (!databaseUrl || !secret || secret.length < 32 || !baseUrl)
    throw new Error("LIVE_CONFIG_MISSING");
  const url = new URL(baseUrl);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const octets = url.hostname.split(".").map(Number);
  const privateIp =
    octets.length === 4 &&
    octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) &&
    (octets[0] === 10 ||
      (octets[0] === 192 && octets[1] === 168) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31));
  const lan = process.env.DESTINY_ALLOW_LAN_HTTP === "true" && privateIp;
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (url.protocol !== "https:" && !((local || lan) && url.protocol === "http:"))
  )
    throw new Error("LIVE_URL_INVALID");
  return {
    databaseUrl,
    secret,
    origin: url.origin,
    secure: url.protocol === "https:",
  };
}
