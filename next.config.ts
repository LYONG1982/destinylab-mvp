import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  // Private photos must never enter the public image optimizer cache.
  images: {localPatterns: [{pathname: "/assets/**", search: ""}]},
  async headers() {
    return [
      {
        source: "/assets/avatars-v520/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/assets/destiny-field/ambient-act12-v3.webp",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/assets/gulou-autumn-v520.webp",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
  distDir: process.env.DESTINY_DIST_DIR || ".next",
  ...(process.env.DESTINY_STANDALONE === "true" ? { output: "standalone" as const } : {}),
};
export default config;
