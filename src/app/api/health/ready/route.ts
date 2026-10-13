import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { database } from "@/server/db";
import { liveConfig } from "@/server/config";
import { logServerError } from "@/server/logging";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store, private" };
  try {
    const config = liveConfig();
    const activity = process.env.DESTINY_ACTIVITY_ID || "meet";
    const result = await database().query(
      "SELECT current_database() AS name FROM dl_activities WHERE id=$1",
      [activity],
    );
    if (!result.rows[0]) throw new Error("ACTIVITY_MISSING");
    const name: string = result.rows[0].name;
    const expected = process.env.DESTINY_CLOUD_TEST_TOKEN;
    const supplied = request.headers.get("x-destiny-test-token");
    const hash = (text: string) => createHash("sha256").update(text).digest();
    const verifiedTest =
      expected &&
      expected.length >= 32 &&
      supplied &&
      name.endsWith("_test") &&
      activity.startsWith("cloudtest-") &&
      timingSafeEqual(hash(expected), hash(supplied));
    return Response.json(
      {
        ok: true,
        ...(verifiedTest
          ? {
              testBinding: createHmac("sha256", expected)
                .update(`${config.origin}\n${name}\n${activity}`)
                .digest("hex"),
            }
          : {}),
      },
      { headers },
    );
  } catch (error) {
    logServerError(
      "health.ready.failed",
      error,
      { route: "/api/health/ready", method: "GET" },
      { throttleMs: 30000 },
    );
    return Response.json({ ok: false }, { status: 503, headers });
  }
}
