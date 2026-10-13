import "server-only";
import { liveConfig } from "./config";
import { HttpError } from "./service";
export const privateHeaders = {
  "Cache-Control": "no-store, private",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie",
  "Referrer-Policy": "no-referrer",
};
export const json = (data: unknown, status = 200, extra = {}) =>
  Response.json(data, { status, headers: { ...privateHeaders, ...extra } });
export function fail(e: unknown) {
  return json(
    {
      error: e instanceof HttpError ? e.message : "服务暂不可用，请稍后重试。",
    },
    e instanceof HttpError ? e.status : 503,
  );
}
export function enabled(feature: "TONGZHOU" | "AVATARS") {
  if (
    process.env.DESTINY_DATA_MODE !== "server" ||
    process.env[`DESTINY_${feature}_ENABLED`] !== "true"
  )
    throw new HttpError(404, "此服务尚未开放。");
  liveConfig();
}
export function origin(request: Request) {
  if (request.headers.get("origin") !== liveConfig().origin)
    throw new HttpError(403, "请求来源无效。");
}
export async function boundedBody(request: Request, max: number) {
  if (Number(request.headers.get("content-length")) > max)
    throw new HttpError(413, "文件或请求内容过大。");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "缺少请求内容。");
  let size = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new HttpError(413, "文件或请求内容过大。");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
export async function bodyOf(request: Request) {
  origin(request);
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new HttpError(415, "请求格式无效。");
  const raw = await boundedBody(request, 16384);
  try {
    const value = JSON.parse(raw.toString());
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "请求内容无效。");
  }
}
export function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((k) => !allowed.includes(k)))
    throw new HttpError(400, "请求包含无效字段。");
}
