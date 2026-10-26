import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  { rules: { "@next/next/no-img-element": "off" } },
  globalIgnores([
    ".next*/**",
    "docs/verification/**",
    ".next-live/**",
    ".next-private/**",
    "references/**",
    "miniapp/**",
    ".next-mini*/**",
    ".next-album*/**",
    ".next-profile*/**",
    ".next-memberwall*/**",
    "test-results/**",
    "playwright-report/**",
    "next-env.d.ts",
  ]),
]);
