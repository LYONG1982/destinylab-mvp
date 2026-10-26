import { activityId, HttpError, rateLimit, sessionFor } from "@/server/service";
import { bodyOf, fail, json } from "@/server/private-http";
import { wallAdmin, wallClaim, wallConfigure, wallConsent, wallEnabled, wallMe, wallScreenCommand, wallSnapshot } from "@/server/member-wall-service";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ path: string[] }> };
export async function GET(request: Request, context: Context) {
  try {
    wallEnabled(); const path = (await context.params).path.join("/"), activity = activityId(new URL(request.url).searchParams.get("activity"));
    if (path === "snapshot") return json(await wallSnapshot(activity));
    if (path === "me") {
      const session = await sessionFor(request, activity, "participant");
      return json({ ...await wallMe(activity, session), actor: session.actor });
    }
    if (path === "admin") return json(await wallAdmin(activity, await sessionFor(request, activity, "operator")));
    throw new HttpError(404, "入口不存在。");
  } catch (e) { return fail(e); }
}
export async function POST(request: Request, context: Context) {
  try {
    wallEnabled(); const path = (await context.params).path.join("/"), activity = activityId(new URL(request.url).searchParams.get("activity"));
    const input = await bodyOf(request);
    if (path === "consent") {
      const session = await sessionFor(request, activity, "participant"); await rateLimit(`wall-consent:${activity}:${session.actor}`, 30);
      return json(await wallConsent(activity, session, input));
    }
    if (path === "config" || path === "claim") {
      const session = await sessionFor(request, activity, "operator"); await rateLimit(`wall-admin:${activity}`, 60);
      return json(path === "config" ? await wallConfigure(activity, session, input) : await wallClaim(activity, session, input));
    }
    if (path === "heartbeat" || path === "rotate") return json(await wallScreenCommand(activity, path, input));
    throw new HttpError(404, "入口不存在。");
  } catch (e) { return fail(e); }
}
