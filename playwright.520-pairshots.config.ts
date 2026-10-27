import { defineConfig } from "@playwright/test";
import base from "./playwright.520-lan.config";

export default defineConfig({
  ...base,
  testMatch: "520-pairshots.spec.ts",
  timeout: 360000,
  outputDir: "/private/tmp/destinylab-520-pairshots/results",
});
