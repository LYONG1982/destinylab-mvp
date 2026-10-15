import { randomBytes } from "node:crypto";
import { fieldActivities } from "@/server/field-service";
import {
  galleryPhoto,
  galleryAction,
  uploadAgencyPhoto,
} from "@/server/agency-gallery";
import {
  agencyDetail,
  agencyList,
  agencyAction,
  agencyPhoto,
} from "@/server/agency-service";
import {
  activityId,
  sessionCookie,
  sessionFor,
  snapshot,
  cookieValue,
  digest,
  HttpError,
} from "@/server/service";
import {
  agencyLogin,
  agencySession,
  tongzhouCommand,
} from "@/server/tongzhou-service";
import {
  bodyOf,
  enabled,
  fail,
  json,
  keys,
  origin,
  boundedBody,
} from "@/server/private-http";
import { database } from "@/server/db";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };
export async function GET(request: Request, context: Context) {
  try {
    enabled("TONGZHOU");
    const url = new URL(request.url),
      activity = activityId(url.searchParams.get("activity"));
    const path = (await context.params).path.join("/");
    await agencySession(request, activity);
    if (path === "gallery-photo")
      return new Response(
        new Uint8Array(
          await galleryPhoto(
            activity,
            url.searchParams.get("id") || "",
            url.searchParams.get("photo") || "",
            url.searchParams.get("thumb") === "1",
          ),
        ),
        {
          headers: {
            "Content-Type": "image/webp",
            "Cache-Control": "no-store, private",
            "X-Content-Type-Options": "nosniff",
            Vary: "Cookie",
          },
        },
      );
    if (path === "photo")
      return new Response(
        new Uint8Array(
          await agencyPhoto(activity, url.searchParams.get("id") || ""),
        ),
        {
          headers: {
            "Content-Type": "image/webp",
            "Cache-Control": "no-store, private",
            "X-Content-Type-Options": "nosniff",
            Vary: "Cookie",
          },
        },
      );
    if (path === "activities") return json(await fieldActivities());
    if (path !== "records") throw new HttpError(404, "入口不存在。");
    const query = url.searchParams.get("q") || "",
      page = Number(url.searchParams.get("page") || 1);
    if (
      query.length > 80 ||
      !Number.isSafeInteger(page) ||
      page < 1 ||
      page > 10000
    )
      throw new HttpError(400, "查询无效。");
    return json(
      url.searchParams.get("id")
        ? await agencyDetail(activity, url.searchParams.get("id")!)
        : await agencyList(
            activity,
            query,
            page,
            url.searchParams.get("gender") || "",
            url.searchParams.get("signed") || "",
            url.searchParams.get("service") || "",
          ),
    );
  } catch (e) {
    return fail(e);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    enabled("TONGZHOU");
    const activity = activityId(
        new URL(request.url).searchParams.get("activity"),
      ),
      path = (await context.params).path.join("/");
    if (path === "gallery-upload") {
      origin(request);
      await agencySession(request, activity);
      const url = new URL(request.url);
      const version = url.searchParams.get("version");
      if (version === null || !/^\d+$/.test(version))
        throw new HttpError(400, "相册版本无效。");
      return json(
        await uploadAgencyPhoto(
          activity,
          url.searchParams.get("id") || "",
          Number(version),
          request.headers.get("idempotency-key") || "",
          await boundedBody(request, 10 * 1024 * 1024),
        ),
      );
    }
    const input = await bodyOf(request);
    if (path === "gallery") {
      await agencySession(request, activity);
      return json(
        await galleryAction(
          activity,
          input,
          request.headers.get("idempotency-key") || "",
        ),
      );
    }
    if (path === "login") {
      const token = await agencyLogin(activity, input);
      return json({ ok: true }, 200, {
        "Set-Cookie": sessionCookie(activity, "agency", token, 28800),
      });
    }
    if (path === "switch") {
      await agencySession(request, activity);
      const target = activityId(
        typeof input.target === "string" ? input.target : "",
      );
      if (
        !(
          await database().query("SELECT id FROM dl_activities WHERE id=$1", [
            target,
          ])
        ).rowCount
      )
        throw new HttpError(404, "活动不存在。");
      const token = randomBytes(32).toString("base64url");
      await database().query(
        "INSERT INTO dl_agency_sessions(token_hash,activity_id,organization_id,expires_at) VALUES($1,$2,'tongzhou',now()+interval '8 hours')",
        [digest(token), target],
      );
      return json({ ok: true }, 200, {
        "Set-Cookie": sessionCookie(target, "agency", token, 8 * 3600),
      });
    }
    if (path === "logout") {
      keys(input, []);
      await agencySession(request, activity);
      await database().query(
        "DELETE FROM dl_agency_sessions WHERE token_hash=$1 AND activity_id=$2",
        [digest(cookieValue(request, activity, "agency")), activity],
      );
      return json({ ok: true }, 200, {
        "Set-Cookie": sessionCookie(activity, "agency", "", 0),
      });
    }
    if (path === "manage") {
      await agencySession(request, activity);
      return json(
        await agencyAction(
          activity,
          input,
          request.headers.get("idempotency-key") || "",
        ),
      );
    }
    if (path !== "command") throw new HttpError(404, "入口不存在。");
    const session = await sessionFor(request, activity, "participant");
    await tongzhouCommand(
      activity,
      session,
      input,
      request.headers.get("idempotency-key") || "",
    );
    return json(await snapshot(activity, "participant", session));
  } catch (e) {
    return fail(e);
  }
}
