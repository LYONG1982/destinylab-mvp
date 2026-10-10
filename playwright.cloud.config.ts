import { defineConfig } from "@playwright/test";
import { loadEnvFile } from "node:process";
import { cloudTestTarget } from "./scripts/lib/cloud-test-guard.mjs";
if (!process.env.DESTINY_CLOUD_TEST_ENV)
  throw new Error("Protected cloud test configuration required");
loadEnvFile(process.env.DESTINY_CLOUD_TEST_ENV);
const target = cloudTestTarget(process.env);
if (
  !process.env.DESTINY_CLOUD_TEST_OUTPUT ||
  !process.env.DESTINY_CLOUD_TEST_LOGIN
)
  throw new Error("Protected output and login paths required");
export default defineConfig({
  testDir: "./tests/cloud",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 180000,
  expect: { timeout: 15000 },
  outputDir: process.env.DESTINY_CLOUD_TEST_OUTPUT,
  reporter: [["list"]],
  use: {
    baseURL: target.origin,
    channel: "chrome",
    headless: true,
    viewport: { width: 390, height: 844 },
    trace: "off",
    screenshot: "off",
    video: "off",
  },
});
