import {
  activityId,
  sessionFor,
  HttpError,
  sessionCookie,
} from "@/server/service";
import { bodyOf, fail, json } from "@/server/private-http";
import {
  fieldOverview,
  fieldPreview,
  fieldAction,
} from "@/server/field-service";
import { database } from "@/server/db";
import { randomBytes } from "node:crypto";
import { digest } from "@/server/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };
export async function GET(request: Request) {
  try {
    const activity = activityId(
      new URL(request.url).searchParams.get("activity"),
    );
    await sessionFor(request, activity, "operator");
    return json(await fieldOverview(activity));
  } catch (e) {
    return fail(e);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    const activity = activityId(
      new URL(request.url).searchParams.get("activity"),
    );
    await sessionFor(request, activity, "operator");
    const input = await bodyOf(request),
      path = (await context.params).path.join("/");
    if (path === "switch") {
      const target = activityId(String(input.target || ""));
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
        "INSERT INTO dl_sessions(token_hash,activity_id,role,actor,expires_at) VALUES($1,$2,'operator','operator',now()+interval '8 hours')",
        [digest(token), target],
      );
      return json({ ok: true }, 200, {
        "Set-Cookie": sessionCookie(target, "operator", token, 8 * 3600),
      });
    }
    if (path === "preview") return json(await fieldPreview(activity, input));
    if (path !== "action") throw new HttpError(404, "入口不存在。");
    return json(
      await fieldAction(
        activity,
        input,
        request.headers.get("idempotency-key") || "",
      ),
    );
  } catch (e) {
    return fail(e);
  }
}
