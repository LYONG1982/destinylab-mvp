import { entryType } from "@/domain/mini-entry";
import { reenterField } from "@/server/field-reentry";
import { rejoinField } from "@/server/field-rejoin";
import { checkMiniText } from "@/server/wechat-content";
import {
  registrationEnabled,
  registrationView,
  registrationWrite,
  registrationProfile,
  registrationUpload,
  registrationDeletePhoto,
  registrationPhoto,
} from "@/server/registration-service";
import { wallMe, wallConsent } from "@/server/member-wall-service";
import { liveConfig } from "@/server/config";
import {
  activityId,
  rateLimit,
  execute,
  HttpError,
  sessionFor,
  snapshot,
} from "@/server/service";
import {
  boundedBody,
  enabled,
  fail,
  keys,
  origin,
} from "@/server/private-http";
import { avatarCommand } from "@/server/avatar-service";
import { tongzhouCommand } from "@/server/tongzhou-service";
import {
  entryCode,
  limitMiniLoginSource,
  miniLogin,
  miniIdentity,
  miniEnter,
  miniLogout,
  miniSession,
  resolveScene,
} from "@/server/wechat-service";
import { wechatConfig } from "@/server/wechat-provider";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ path: string[] }> };
const headers = {
  "Cache-Control": "no-store, private",
  Vary: "Authorization",
  "X-Content-Type-Options": "nosniff",
};
const json = (body: unknown) => Response.json(body, { headers });
function check() {
  liveConfig();
  wechatConfig();
}
async function body(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new HttpError(415, "请求格式无效。");
  try {
    const value = JSON.parse((await boundedBody(request, 16384)).toString());
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value as Record<string, unknown>;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, "请求内容无效。");
  }
}
export async function GET(request: Request, context: Context) {
  try {
    check();
    const path = (await context.params).path.join("/");
    const url = new URL(request.url);
    if (path === "resolve")
      return json(await resolveScene(url.searchParams.get("scene") || ""));
    const activity = activityId(url.searchParams.get("activity"));
    if (path === "code") {
      const image = (
        await entryCode(
          activity,
          false,
          checkedEntry(url.searchParams.get("entry")),
        )
      ).image;
      return new Response(new Uint8Array(image), {
        headers: {
          ...headers,
          "Content-Type": image[0] === 137 ? "image/png" : "image/jpeg",
        },
      });
    }
    if (path === "enter" || path === "rejoin")
      return Response.json(
        { error: "请主动点击进入现场。" },
        { status: 405, headers: { ...headers, Allow: "POST" } },
      );
    if (path.startsWith("registration/")) {
      registrationEnabled();
      const who = `mini:${await miniIdentity(request, activity)}`;
      if (path === "registration/me")
        return json(await registrationView(activity, who));
      if (path === "registration/photo")
        return new Response(
          new Uint8Array(
            await registrationPhoto(
              activity,
              who,
              url.searchParams.get("photo") || "",
              url.searchParams.get("thumb") === "1",
            ),
          ),
          { headers: { ...headers, "Content-Type": "image/webp" } },
        );
      throw new HttpError(404, "入口不存在。");
    }
    const session = await miniSession(request, activity);
    if (path === "wall/me") return json(await wallMe(activity, session));
    if (path === "snapshot")
      return json({
        ...(await snapshot(activity, "participant", session)),
        features: {
          avatars: process.env.DESTINY_AVATARS_ENABLED === "true",
          tongzhou: process.env.DESTINY_TONGZHOU_ENABLED === "true",
          memberWall: process.env.DESTINY_MEMBER_WALL_ENABLED === "true",
        },
      });
    if (path.startsWith("avatar/")) {
      enabled("AVATARS");
      throw new HttpError(404, "本活动统一使用系统头像。");
    }
    throw new HttpError(404, "入口不存在。");
  } catch (e) {
    return fail(e);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    check();
    const path = (await context.params).path.join("/");
    const activity = activityId(
      new URL(request.url).searchParams.get("activity"),
    );
    if (path === "code") {
      origin(request);
      await sessionFor(request, activity, "operator");
      await entryCode(
        activity,
        true,
        checkedEntry(new URL(request.url).searchParams.get("entry")),
      );
      return json({ ok: true });
    }
    if (path === "login") {
      const input = await body(request);
      keys(input, ["code"]);
      await limitMiniLoginSource(request);
      const result = await miniLogin(activity, input.code);
      return json({ token: result.token, expiresIn: result.expiresIn });
    }
    if (path === "logout") {
      await miniIdentity(request, activity);
      await miniLogout(request, activity);
      return json({ ok: true });
    }
    if (path === "rejoin") {
      const identity = await miniIdentity(request, activity);
      const result = await rejoinField(
        activity,
        { identity },
        await body(request),
      );
      return json(await snapshot(activity, "participant", result.session));
    }
    if (path === "enter") {
      const identity = await miniIdentity(request, activity);
      await body(request);
      return json(
        await snapshot(
          activity,
          "participant",
          await miniEnter(identity, activity),
        ),
      );
    }
    if (path.startsWith("registration/")) {
      registrationEnabled();
      const identity = await miniIdentity(request, activity),
        who = `mini:${identity}`;
      const id = request.headers.get("idempotency-key") || "";
      if (path === "registration/upload") {
        const url = new URL(request.url),
          version = Number(url.searchParams.get("version"));
        if (!Number.isSafeInteger(version) || version < 1)
          throw new HttpError(400, "相册版本无效。");
        return json(
          await registrationUpload(
            activity,
            who,
            version,
            id,
            await boundedBody(request, 10 * 1024 * 1024),
          ),
        );
      }
      const input = await body(request);
      if (path === "registration/save")
        return json(await registrationWrite(activity, who, input, id));
      if (path === "registration/profile")
        return json(await registrationProfile(activity, who, input, id));
      if (path === "registration/delete-photo")
        return json(await registrationDeletePhoto(activity, who, input, id));
      if (path === "registration/enter") {
        keys(input, []);
        const session = await miniEnter(identity, activity);
        return json(await snapshot(activity, "participant", session));
      }
      throw new HttpError(404, "入口不存在。");
    }
    const session = await miniSession(request, activity);
    if (path === "avatar/upload") {
      throw new HttpError(403, "本活动仅支持系统头像，已关闭自定义头像上传。");
    }
    const input = await body(request);
    if (path === "reenter") {
      await reenterField(
        activity,
        session,
        input,
        request.headers.get("idempotency-key") || "",
      );
      return json(await snapshot(activity, "participant", session));
    }
    if (path === "avatar/review")
      throw new HttpError(403, "本活动仅支持系统头像，已关闭自定义头像上传。");
    if (path === "wall/consent") {
      await rateLimit(`wall-consent:${activity}:${session.actor}`, 30);
      if (input.allow === true)
        await checkMiniText(
          await miniIdentity(request, activity),
          input.nickname,
        );
      return json(await wallConsent(activity, session, input));
    }
    keys(input, ["epoch", "command"]);
    const id = request.headers.get("idempotency-key") || "";
    if (path === "command") {
      const command = input.command as Record<string, unknown> | undefined;
      if (command?.type === "profile")
        await checkMiniText(
          await miniIdentity(request, activity),
          command.name,
        );
      await execute(activity, session, input.command, id, input.epoch);
    } else if (path === "tongzhou/command") {
      enabled("TONGZHOU");
      await tongzhouCommand(activity, session, input, id);
    } else if (path === "avatar/command") {
      enabled("AVATARS");
      await avatarCommand(activity, session, input, id);
    } else throw new HttpError(404, "入口不存在。");
    return json(await snapshot(activity, "participant", session));
  } catch (e) {
    return fail(e);
  }
}

function checkedEntry(value: unknown) {
  try {
    return entryType(value);
  } catch {
    throw new HttpError(400, "入口类型无效。");
  }
}
