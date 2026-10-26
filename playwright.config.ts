import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: "**/*.dev.spec.ts",
  outputDir: "test-results/production",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  expect: { timeout: 8000 },
  use: {
    baseURL: "http://localhost:3210",
    channel: "chrome",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1440, height: 1024 },
  },
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report/production", open: "never" }],
  ],
  webServer: {
    command: "npm run start",
    url: "http://localhost:3210/demo",
    reuseExistingServer: true,
    timeout: 60000,
  },
});
