import {
  activityId,
  HttpError,
  sessionCookie,
  sessionFor,
} from "@/server/service";
import {
  bodyOf,
  boundedBody,
  fail,
  json,
  keys,
  origin,
  privateHeaders,
} from "@/server/private-http";
import {
  registrationConfig,
  registrationProfile,
  registrationDeletePhoto,
  registrationDetail,
  registrationEnabled,
  registrationEnter,
  registrationList,
  registrationManage,
  registrationPhoto,
  registrationSession,
  registrationUpload,
  registrationView,
  registrationWrite,
} from "@/server/registration-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };
export async function GET(request: Request, context: Context) {
  try {
    registrationEnabled();
    const url = new URL(request.url),
      activity = activityId(url.searchParams.get("activity")),
      path = (await context.params).path.join("/");
    if (path === "config") return json(await registrationConfig(activity));
    if (path === "records") {
      await sessionFor(request, activity, "operator");
      return json(
        url.searchParams.has("id")
          ? await registrationDetail(activity, url.searchParams.get("id")!)
          : await registrationList(
              activity,
              url.searchParams.get("q") || "",
              Number(url.searchParams.get("page") || 1),
            ),
      );
    }
    if (path === "photo") {
      let hash: string | null = null;
      if (url.searchParams.get("operator") === "1")
        await sessionFor(request, activity, "operator");
      else hash = (await registrationSession(request, activity)).token_hash;
      return new Response(
        new Uint8Array(
          await registrationPhoto(
            activity,
            hash,
            url.searchParams.get("photo") || "",
            url.searchParams.get("thumb") === "1",
          ),
        ),
        { headers: { ...privateHeaders, "Content-Type": "image/webp" } },
      );
    }
    if (path === "me")
      return json(
        await registrationView(
          activity,
          (await registrationSession(request, activity)).token_hash,
        ),
      );
    throw new HttpError(404, "入口不存在。");
  } catch (e) {
    return fail(e);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    registrationEnabled();
    const url = new URL(request.url),
      activity = activityId(url.searchParams.get("activity")),
      path = (await context.params).path.join("/"),
      id = request.headers.get("idempotency-key") || "";
    if (path === "upload") {
      origin(request);
      const session = await registrationSession(request, activity);
      if (!session.registration_id) throw new HttpError(409, "请先完成报名。");
      const version = Number(url.searchParams.get("version"));
      if (
        !url.searchParams.has("version") ||
        !Number.isSafeInteger(version) ||
        version < 1
      )
        throw new HttpError(400, "相册版本无效。");
      return json(
        await registrationUpload(
          activity,
          session.token_hash,
          version,
          id,
          await boundedBody(request, 10 * 1024 * 1024),
        ),
      );
    }
    const input = await bodyOf(request);
    if (path === "session") {
      keys(input, []);
      const s = await registrationSession(request, activity, true);
      return json(
        await registrationView(activity, s.token_hash),
        200,
        s.token
          ? {
              "Set-Cookie": sessionCookie(
                activity,
                "registration",
                s.token,
                2592000,
              ),
            }
          : {},
      );
    }
    if (path === "manage") {
      await sessionFor(request, activity, "operator");
      return json(await registrationManage(activity, input, id));
    }
    const s = await registrationSession(request, activity);
    if (path === "profile")
      return json(await registrationProfile(activity, s.token_hash, input, id));
    if (path === "save")
      return json(await registrationWrite(activity, s.token_hash, input, id));
    if (path === "delete-photo")
      return json(
        await registrationDeletePhoto(activity, s.token_hash, input, id),
      );
    if (path === "enter") {
      keys(input, []);
      return json({ url: `/mobile/01-start?activity=${activity}` }, 200, {
        "Set-Cookie": sessionCookie(
          activity,
          "participant",
          await registrationEnter(activity, s.token_hash, request),
          2592000,
        ),
      });
    }
    throw new HttpError(404, "入口不存在。");
  } catch (e) {
    return fail(e);
  }
}
