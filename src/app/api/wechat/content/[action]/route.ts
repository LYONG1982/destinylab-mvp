import {
  acceptReviewResult,
  callbackChallenge,
  decryptCallback,
  reviewMedia,
} from "@/server/wechat-content";
import { boundedBody, fail } from "@/server/private-http";
import { HttpError } from "@/server/service";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ action: string }> };
const headers = {
  "Cache-Control": "no-store, private",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
export async function GET(request: Request, context: Context) {
  try {
    const { action } = await context.params,
      url = new URL(request.url);
    if (action === "callback")
      return new Response(callbackChallenge(url), {
        headers: { ...headers, "Content-Type": "text/plain" },
      });
    if (action === "media")
      return new Response(
        new Uint8Array(
          await reviewMedia(
            url.searchParams.get("asset") || "",
            url.searchParams.get("token") || "",
          ),
        ),
        { headers: { ...headers, "Content-Type": "image/png" } },
      );
    throw new HttpError(404, "入口不存在。");
  } catch (e) {
    return fail(e);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    if ((await context.params).action !== "callback")
      throw new HttpError(404, "入口不存在。");
    let input: unknown;
    try {
      input = JSON.parse((await boundedBody(request, 96 * 1024)).toString());
    } catch {
      throw new HttpError(400, "消息格式无效。");
    }
    await acceptReviewResult(decryptCallback(new URL(request.url), input));
    return new Response("success", {
      headers: { ...headers, "Content-Type": "text/plain" },
    });
  } catch (e) {
    return fail(e);
  }
}
