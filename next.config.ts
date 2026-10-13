import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  // Private photos must never enter the public image optimizer cache.
  images: {localPatterns: [{pathname: "/assets/**", search: ""}]},
  distDir: process.env.DESTINY_DIST_DIR || ".next",
  ...(process.env.DESTINY_STANDALONE === "true" ? { output: "standalone" as const } : {}),
};
export default config;
