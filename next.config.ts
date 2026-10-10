import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  distDir: process.env.DESTINY_DIST_DIR || ".next",
  ...(process.env.DESTINY_STANDALONE === "true" ? { output: "standalone" as const } : {}),
};
export default config;
