import { activityId, sessionFor, snapshot, HttpError } from "@/server/service";
import {
  uploadAvatar,
  avatarCommand,
  readAvatar,
} from "@/server/avatar-service";
import {
  bodyOf,
  boundedBody,
  enabled,
  fail,
  json,
  origin,
  privateHeaders,
} from "@/server/private-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };
export async function GET(request: Request, ctx: Context) {
  try {
    enabled("AVATARS");
    const path = (await ctx.params).path;
    if (path.length !== 1) throw new HttpError(404, "入口不存在。");
    return new Response(new Uint8Array(await readAvatar(request, path[0])), {
      headers: { ...privateHeaders, "Content-Type": "image/webp" },
    });
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
      if (
        !["image/jpeg", "image/png", "image/webp"].includes(
          request.headers.get("content-type") || "",
        )
      )
        throw new HttpError(415, "请选择 JPG、PNG 或 WebP 照片。");
      return json(
        await uploadAvatar(
          activity,
          session,
          await boundedBody(request, 10 * 1024 * 1024),
        ),
      );
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
