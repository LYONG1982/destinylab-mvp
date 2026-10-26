import { activityId, sessionFor, snapshot, HttpError } from "@/server/service";
import { avatarCommand } from "@/server/avatar-service";
import { bodyOf, enabled, fail, json, origin } from "@/server/private-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };
export async function GET(request: Request, ctx: Context) {
  try {
    enabled("AVATARS");
    const path = (await ctx.params).path;
    if (path.length !== 1) throw new HttpError(404, "入口不存在。");
    throw new HttpError(404, "本活动统一使用系统头像。");
  } catch (e) {
    return fail(e);
  }
}
export async function POST(request: Request, ctx: Context) {
  try {
    enabled("AVATARS");
    origin(request);
    const activity = activityId(
        new URL(request.url).searchParams.get("activity"),
      ),
      session = await sessionFor(request, activity, "participant"),
      path = (await ctx.params).path.join("/");
    if (path === "upload") {
      throw new HttpError(403, "本活动仅支持系统头像，已关闭自定义头像上传。");
    }
    if (path !== "command") throw new HttpError(404, "入口不存在。");
    await avatarCommand(
      activity,
      session,
      await bodyOf(request),
      request.headers.get("idempotency-key") || "",
    );
    return json(await snapshot(activity, "participant", session));
  } catch (e) {
    return fail(e);
  }
}
