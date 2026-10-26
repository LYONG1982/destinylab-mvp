import "server-only";
import { MINI_ENTRY_PAGES, type MiniEntry } from "@/domain/mini-entry";
import { liveConfig } from "./config";
import { HttpError } from "./service";
export function wechatConfig() {
  if (process.env.DESTINY_MINI_ENABLED !== "true")
    throw new HttpError(404, "小程序入口尚未开放。");
  const appid = process.env.DESTINY_WECHAT_APPID || "";
  const secret = process.env.DESTINY_WECHAT_SECRET || "";
  if (!/^wx[a-f0-9]{16}$/.test(appid) || !/^[a-f0-9]{32}$/.test(secret))
    throw new HttpError(503, "小程序账号尚未配置，请联系活动工作人员。");
  const host = new URL(liveConfig().origin).hostname;
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(host) &&
    !["x-forwarded-for", "x-real-ip"].includes(
      process.env.DESTINY_TRUSTED_CLIENT_IP_HEADER || "",
    )
  )
    throw new HttpError(503, "请先配置可信代理的登录来源限流。");
  const version = process.env.DESTINY_WECHAT_ENV_VERSION || "trial";
  if (!["develop", "trial", "release"].includes(version))
    throw new HttpError(503, "小程序版本配置无效。");
  return { appid, secret, version };
}
async function request(url: string, init?: RequestInit) {
  try {
    const response = await fetch(url, {
      ...init,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error();
    return response;
  } catch {
    throw new HttpError(503, "微信服务暂不可用，请稍后重试。");
  }
}
export async function exchangeWechatCode(code: string) {
  const { appid, secret } = wechatConfig();
  const query = new URLSearchParams({
    appid,
    secret,
    js_code: code,
    grant_type: "authorization_code",
  });
  let data;
  try {
    data = await (
      await request(`https://api.weixin.qq.com/sns/jscode2session?${query}`)
    ).json();
  } catch {
    throw new HttpError(503, "微信登录暂不可用，请重试。");
  }
  if (
    data.errcode ||
    typeof data.openid !== "string" ||
    !/^[A-Za-z0-9_-]{10,128}$/.test(data.openid)
  )
    throw new HttpError(401, "微信登录凭证无效或已过期，请重新登录。");
  // Never persist, log, or return session_key; it is not an application credential.
  return { appid, openid: data.openid as string };
}
let tokenCache: { appid: string; token: string; until: number } | undefined;
export async function accessToken() {
  const { appid, secret } = wechatConfig();
  if (tokenCache?.appid === appid && tokenCache.until > Date.now())
    return tokenCache.token;
  const data = await (
    await request("https://api.weixin.qq.com/cgi-bin/stable_token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credential",
        appid,
        secret,
        force_refresh: false,
      }),
    })
  ).json();
  if (
    data.errcode ||
    typeof data.access_token !== "string" ||
    !Number.isFinite(data.expires_in)
  )
    throw new HttpError(503, "小程序码服务暂不可用。");
  tokenCache = {
    appid,
    token: data.access_token,
    until: Date.now() + Math.max(0, data.expires_in - 120) * 1000,
  };
  return tokenCache.token;
}
export async function generateWechatCode(
  scene: string,
  entry: MiniEntry = "encounter",
) {
  const { version } = wechatConfig();
  const token = await accessToken();
  const response = await request(
    `https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scene,
        page: MINI_ENTRY_PAGES[entry],
        check_path: true,
        env_version: version,
        width: 430,
      }),
    },
  );
  const bytes = Buffer.from(await response.arrayBuffer());
  if (
    bytes.length > 2 * 1024 * 1024 ||
    !(
      bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
    )
  )
    throw new HttpError(
      503,
      "小程序码未生成，请确认已上传对应版本及页面路径。",
    );
  return bytes;
}
