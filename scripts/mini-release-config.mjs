import { isIP } from "node:net";
export function validateMiniRelease(env) {
  const appid = env.TARO_APP_ID || "";
  if (!/^wx[a-f0-9]{16}$/.test(appid) || /^wx0+$/.test(appid))
    throw Error(
      "请配置真实的小程序 AppID（TARO_APP_ID），游客或测试 AppID 不可发布。",
    );
  let origin;
  try {
    const u = new URL(env.TARO_APP_API_ORIGIN || "");
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      u.pathname !== "/" ||
      (u.port && u.port !== "443") ||
      isIP(u.hostname) ||
      !u.hostname.includes(".") ||
      /(^|\.)(localhost|test|invalid|example)$/.test(u.hostname) ||
      /(^|\.)example\.(com|net|org)$/.test(u.hostname)
    )
      throw Error();
    origin = u.origin;
  } catch {
    throw Error(
      "请配置正式 HTTPS API 域名，不能使用示例域名、本机或局域网地址。",
    );
  }
  if (
    !env.TARO_APP_PRIVACY_CONTACT?.trim() ||
    !env.TARO_APP_PRIVACY_OWNER?.trim()
  )
    throw Error("请配置真实的信息处理主体和联系渠道。");
  return { appid, origin };
}
