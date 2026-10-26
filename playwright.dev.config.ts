import { defineConfig } from "@playwright/test";
import production from "./playwright.config";
// The parent task starts this development server explicitly; no production bypass.
export default defineConfig({
  ...production,
  testIgnore: [],
  testMatch: "**/*.dev.spec.ts",
  timeout: 90000,
  outputDir: "test-results/development",
  use: { ...production.use, baseURL: "http://localhost:3211" },
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report/development", open: "never" }],
  ],
  webServer: undefined,
});
