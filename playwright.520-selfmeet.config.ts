import { defineConfig } from "@playwright/test";
import baseConfig from "./playwright.520.config";

export default defineConfig({
  ...baseConfig,
  testMatch: ["520-selfmeet-gallery.spec.ts", "520-selfmeet-edges.spec.ts"],
  outputDir: "/private/tmp/destinylab-520-selfmeet/results",
  use: {
    ...baseConfig.use,
    baseURL: process.env.DESTINY_PUBLIC_URL,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
});
