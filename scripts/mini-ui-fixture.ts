// Test-only CLI. Never exposes injected identity creation over HTTP.
import { database } from "../src/server/db";
import { emptyActivity } from "../src/server/state";
import { miniLogin } from "../src/server/wechat-service";
import { DEFAULT_REGISTRATION_CONFIG } from "../src/domain/registration";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
const out = process.env.MINI_UI_DIR;
const url = new URL(process.env.DATABASE_URL || "http://invalid");
if (
  !out?.startsWith("/tmp/destinylab-weapp-") ||
  !["127.0.0.1", "localhost"].includes(url.hostname) ||
  !url.pathname.endsWith("_test")
)
  throw Error("Dedicated local fixture environment required");
async function main() {
  const activity = "weapp-ui-" + randomBytes(4).toString("hex");
  await database().query("INSERT INTO dl_activities(id,state) VALUES($1,$2)", [
    activity,
    JSON.stringify(emptyActivity()),
  ]);
  await database().query(
    "INSERT INTO dl_registration_config(activity_id,config) VALUES($1,$2)",
    [
      activity,
      JSON.stringify({
        ...DEFAULT_REGISTRATION_CONFIG,
        open: true,
        title: "爱在凤城 · 初冬有约",
        date: "2026年11月6日—8日",
        location: "银川市兴庆区鼓楼步行街",
      }),
    ],
  );
  const auth = await miniLogin(
    activity,
    randomBytes(20).toString("hex"),
    async () => ({
      appid: process.env.DESTINY_WECHAT_APPID!,
      openid: "isolated_ui_fixture_" + activity,
    }),
  );
  writeFileSync(
    `${out}/ui-fixture.json`,
    JSON.stringify({ activity, token: auth.token }),
    { mode: 0o600 },
  );
  console.log("Isolated UI identity created; no participant created.");
}
main()
  .catch(() => {
    console.error("UI fixture creation failed.");
    process.exitCode = 1;
  })
  .finally(() => database().end());
