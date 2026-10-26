import { defineConfig } from "@playwright/test";
import { loadEnvFile } from "node:process";

if (!process.env.DESTINY_PROFILE_TEST_ENV)
  throw new Error(
    "Set DESTINY_PROFILE_TEST_ENV to a protected synthetic test configuration.",
  );
loadEnvFile(process.env.DESTINY_PROFILE_TEST_ENV);
const db = new URL(process.env.DATABASE_URL!);
if (
  db.hostname !== "127.0.0.1" ||
  !db.pathname.endsWith("_test") ||
  process.env.DESTINY_PUBLIC_URL !== "http://127.0.0.1:3240"
)
  throw new Error(
    "Profile tests require an isolated local _test database and port 3240.",
  );

export default defineConfig({
  testDir: "./tests/live",
  testMatch: "profile-submit.spec.ts",
  workers: 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  outputDir: "test-results/profile-submit",
  reporter: [["list"]],
  use: {
    baseURL: process.env.DESTINY_PUBLIC_URL,
    channel: "chrome",
    headless: true,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    reducedMotion: "reduce",
    screenshot: "only-on-failure",
    trace: "off",
  },
});
