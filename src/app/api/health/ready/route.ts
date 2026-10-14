import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { database } from "@/server/db";
import { wechatConfig } from "@/server/wechat-provider";
import { moderationConfig } from "@/server/wechat-content";
import { liveConfig } from "@/server/config";
import { logServerError } from "@/server/logging";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store, private" };
  let stage = "configuration_validation";
  try {
    const config = liveConfig();
    const activity = process.env.DESTINY_ACTIVITY_ID || "meet";
    stage = "database_activity_check";
    const result = await database().query(
      "SELECT current_database() AS name FROM dl_activities WHERE id=$1",
      [activity],
    );
    if (!result.rows[0]) throw new Error("ACTIVITY_MISSING");
    if (process.env.DESTINY_TONGZHOU_ENABLED === "true") {
      stage = "agency_configuration_validation";
      if (
        !process.env.DESTINY_AGENCY_USERNAME ||
        !/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(
          process.env.DESTINY_AGENCY_PASSWORD_HASH || "",
        )
      )
        throw new Error("AGENCY_CONFIG_MISSING");
      stage = "agency_schema_check";
      await database().query(
        "SELECT 1 FROM dl_agency_members, dl_agency_sources, dl_tongzhou_submissions, dl_agency_sessions, dl_private_commands, dl_agency_profiles, dl_agency_actions, dl_agency_photos, dl_agency_albums, dl_agency_user_photo_snapshots LIMIT 0",
      );
    }
    if (process.env.DESTINY_AVATARS_ENABLED === "true") {
      stage = "avatar_schema_check";
      await database().query(
        "SELECT 1 FROM dl_avatar_assets, dl_private_commands LIMIT 0",
      );
    }
    if (process.env.DESTINY_MINI_ENABLED === "true") {
      stage = "mini_program_configuration_validation";
      wechatConfig();
      moderationConfig();
      stage = "mini_content_schema_check";
      await database().query(
        "SELECT 1 FROM dl_mini_media_reviews, dl_mini_review_results LIMIT 0",
      );
      stage = "mini_identity_schema_check";
      await database().query(
        "SELECT dl_wechat_entry_codes.entry_type FROM dl_wechat_identities, dl_wechat_participants, dl_mini_sessions, dl_wechat_codes_used, dl_wechat_entry_codes, dl_mini_identity_sessions, dl_wechat_registrations LIMIT 0",
      );
    }
    if (process.env.DESTINY_REGISTRATION_ENABLED === "true") {
      stage = "registration_schema_check";
      await database().query(
        "SELECT dl_registrations.birth_date,dl_registrations.legacy_receipt,dl_registrations.profile_progress,dl_registrations.profile_confirmed_at FROM dl_registration_config, dl_registrations, dl_registration_sessions, dl_registration_photos, dl_registration_actions LIMIT 0",
      );
    }
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
      { route: "/api/health/ready", method: "GET", stage },
      { throttleMs: 30000 },
    );
    return Response.json({ ok: false }, { status: 503, headers });
  }
}
