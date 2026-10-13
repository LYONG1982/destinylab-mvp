import { database } from "@/server/db";
import { liveConfig } from "@/server/config";
import { logServerError } from "@/server/logging";
import { activityId, execute, HttpError, join, logout, operatorLogin,
  sessionCookie, sessionFor, snapshot } from "@/server/service";
import type { Audience } from "@/lib/api/live-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ path: string[] }> };
const headers = { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff", "Vary": "Cookie" };
const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  Response.json(data, { status, headers: { ...headers, ...extra } });
function fail(error: unknown, method: string) {
  if (error instanceof HttpError) {
    if (error.status >= 500)
      logServerError("api.live.failed", error, {
        route: "/api/live/[...path]",
        method,
      });
    return json({ error: error.message }, error.status);
  }
  // Database connection strings, query errors and stack traces never cross this boundary.
  logServerError("api.live.failed", error, {
    route: "/api/live/[...path]",
    method,
  });
  return json({ error: "服务暂不可用，请稍后重试。" }, 503);
}
function enabled() {
  if (process.env.DESTINY_DATA_MODE !== "server") throw new HttpError(404, "入口不存在。");
  return liveConfig();
}
function audience(value: string | null): Audience {
  if (value === "participant" || value === "operator" || value === "screen") return value;
  throw new HttpError(400, "数据入口无效。");
}
async function bodyOf(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("origin") !== liveConfig().origin)
    throw new HttpError(403, "请求来源无效，请从活动页面重试。");
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new HttpError(415, "请求格式无效。");
  if (Number(request.headers.get("content-length")) > 16384) throw new HttpError(413, "请求内容过长。");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "缺少请求内容。");
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 16384) { await reader.cancel(); throw new HttpError(413, "请求内容过长。"); }
    chunks.push(value);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new HttpError(400, "请求内容无效。"); }
}
export async function GET(request: Request, context: Context) {
  try {
    enabled();
    const path = (await context.params).path.join("/");
    const url = new URL(request.url), activity = activityId(url.searchParams.get("activity"));
    const role = audience(url.searchParams.get("audience"));
    const session = role === "screen" ? undefined : await sessionFor(request, activity, role);
    if (path === "snapshot") {
      const raw = url.searchParams.get("after");
      const after = raw === null ? undefined : Number(raw);
      if (after !== undefined && (!Number.isSafeInteger(after) || after < 0)) throw new HttpError(400, "版本无效。");
      return json(await snapshot(activity, role, session, after));
    }
    if (path !== "events") throw new HttpError(404, "入口不存在。");
    // Versions are durable in PostgreSQL. Any instance can serve reconnections.
    await snapshot(activity, role, session);
    const encoder = new TextEncoder(); let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closeStream = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let last = -1; const started = Date.now();
        const stop = () => {
          if (stopped) return; stopped = true; clearTimeout(timer);
          request.signal.removeEventListener("abort", stop);
          try { controller.close(); } catch {}
        };
        closeStream = stop; request.signal.addEventListener("abort", stop, { once: true });
        const tick = async () => {
          if (stopped || request.signal.aborted) return stop();
          try {
            if (role !== "screen") await sessionFor(request, activity, role);
            const result = await database().query("SELECT revision FROM dl_activities WHERE id=$1", [activity]);
            if (!result.rows[0]) return stop();
            if (stopped) return;
            const revision = Number(result.rows[0].revision);
            if (revision !== last) {
              controller.enqueue(encoder.encode(`id: ${revision}\nevent: version\ndata: ${JSON.stringify({ revision })}\n\n`));
              last = revision;
            } else controller.enqueue(encoder.encode(": heartbeat\n\n"));
            if (Date.now() - started > 25000) return stop();
            timer = setTimeout(tick, 750);
          } catch (error) {
            if (!request.signal.aborted && !stopped &&
                (!(error instanceof HttpError) || error.status >= 500))
              logServerError("api.live.sse_poll_failed", error, {
                route: "/api/live/events",
                method: "GET",
                activity,
                audience: role,
              });
            stop();
          }
        };
        controller.enqueue(encoder.encode("retry: 1000\n\n")); void tick();
      },
      cancel() { closeStream(); },
    });
    return new Response(stream, { headers: { ...headers, "Content-Type": "text/event-stream",
      "X-Accel-Buffering": "no", "Connection": "keep-alive" } });
  } catch (e) { return fail(e, "GET"); }
}
export async function POST(request: Request, context: Context) {
  try {
    enabled();
    const path = (await context.params).path.join("/");
    const input = await bodyOf(request);
    const url = new URL(request.url), activity = activityId(url.searchParams.get("activity"));
    if (path === "session") {
      if (Object.keys(input).length) throw new HttpError(400, "参与身份由服务端分配。");
      const { session, token } = await join(request, activity);
      return json(await snapshot(activity, "participant", session), 200,
        token ? { "Set-Cookie": sessionCookie(activity, "participant", token, 30 * 86400) } : {});
    }
    if (path === "login") {
      if (Object.keys(input).some((k) => !["username", "password"].includes(k))) throw new HttpError(400, "请求内容无效。");
      const token = await operatorLogin(activity, input.username, input.password);
      return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(activity, "operator", token, 8 * 3600) });
    }
    const role = audience(url.searchParams.get("audience"));
    if (role === "screen") throw new HttpError(403, "大屏仅能读取数据。");
    const session = await sessionFor(request, activity, role);
    if (path === "logout") {
      await logout(request, activity, role);
      return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(activity, role, "", 0) });
    }
    if (path !== "command") throw new HttpError(404, "入口不存在。");
    if (Object.keys(input).some((k) => !["command", "epoch"].includes(k))) throw new HttpError(400, "请求包含无效字段。");
    await execute(activity, session, input.command, request.headers.get("idempotency-key") || "", input.epoch);
    return json(await snapshot(activity, role, session));
  } catch (e) { return fail(e, "POST"); }
}
