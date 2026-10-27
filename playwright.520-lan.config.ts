import { defineConfig } from "@playwright/test";

const baseURL = process.env.DESTINY_PUBLIC_URL || "http://invalid";
const origin = new URL(baseURL);
const database = new URL(process.env.DATABASE_URL || "http://invalid");
if (
  origin.protocol !== "http:" || origin.port !== "3246" || !/^192\.168\.\d{1,3}\.\d{1,3}$/.test(origin.hostname) ||
  !["127.0.0.1", "localhost"].includes(database.hostname) ||
  database.pathname !== "/destinylab_520_uat_test" ||
  !process.env.DESTINY_LIVE_TEST_LOGIN
)
  throw new Error("LAN UAT requires the dedicated 3246 origin, local 520 test database and protected synthetic login fixture.");

export default defineConfig({
  testDir: "./tests/live",
  testMatch: "520-journey.spec.ts",
  workers: 1,
  fullyParallel: false,
  timeout: 180000,
  expect: { timeout: 15000 },
  outputDir: "/private/tmp/destinylab-520-lan-journey/results",
  reporter: [["list"]],
  use: {
    baseURL,
    channel: "chrome",
    headless: true,
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
