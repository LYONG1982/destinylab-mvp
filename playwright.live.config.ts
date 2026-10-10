import { defineConfig } from "@playwright/test";
import { loadEnvFile } from "node:process";

if (!process.env.DESTINY_LIVE_TEST_ENV)
  throw new Error(
    "Set DESTINY_LIVE_TEST_ENV to the isolated test configuration.",
  );
loadEnvFile(process.env.DESTINY_LIVE_TEST_ENV);
const db = new URL(process.env.DATABASE_URL!);
if (
  !db.pathname.endsWith("_test") ||
  process.env.DESTINY_PUBLIC_URL !== "http://127.0.0.1:3212"
)
  throw new Error(
    "Live tests require the separate _test database and loopback port 3212.",
  );
export default defineConfig({
  testDir: "./tests/live",
  workers: 1,
  fullyParallel: false,
  timeout: 120000,
  expect: { timeout: 10000 },
  outputDir: "/private/tmp/destinylab-public-linkage-20261010/live-results",
  reporter: [["list"]],
  use: {
    baseURL: process.env.DESTINY_PUBLIC_URL,
    channel: "chrome",
    headless: true,
    viewport: { width: 390, height: 844 },
    trace: "off",
    screenshot: "only-on-failure",
  },
});
