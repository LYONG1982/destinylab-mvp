import { defineConfig } from "@playwright/test";
import { loadEnvFile } from "node:process";

if (process.env.DESTINY_520_TEST_ENV)
  loadEnvFile(process.env.DESTINY_520_TEST_ENV);

const baseURL = process.env.DESTINY_520_BASE_URL || "http://127.0.0.1:3244";
const base = new URL(baseURL);
const database = new URL(process.env.DATABASE_URL || "http://invalid");
if (
  base.protocol !== "http:" ||
  base.hostname !== "127.0.0.1" ||
  base.port !== "3244" ||
  !["127.0.0.1", "localhost", "::1"].includes(database.hostname) ||
  !database.pathname.endsWith("_test") ||
  !process.env.DESTINY_LIVE_TEST_LOGIN
)
  throw new Error(
    "520 journey requires loopback port 3244, a dedicated _test DATABASE_URL, and DESTINY_LIVE_TEST_LOGIN.",
  );

export default defineConfig({
  testDir: "./tests/live",
  testMatch: "520-journey.spec.ts",
  workers: 1,
  fullyParallel: false,
  timeout: 180000,
  expect: { timeout: 15000 },
  outputDir: "/private/tmp/destinylab-520-journey/results",
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
