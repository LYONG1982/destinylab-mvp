import type { Metadata } from "next";
import { PRODUCT } from "@/config/product";
import "./globals.css";
import { motionCssVars } from "@/lib/motion-tokens";
import { MotionRoot } from "@/components/motion/Motion";
export const metadata: Metadata = {
  title: `${PRODUCT.name} · ${PRODUCT.displayVersion}`,
  description: "从一个共同话题，开始认识。遇见－缘分实验室现场社交体验。",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" data-data-mode={process.env.DESTINY_DATA_MODE === "server" ? "server" : "mock"}
      data-tongzhou={process.env.DESTINY_TONGZHOU_ENABLED === "true" ? "true" : "false"}
      data-avatars={process.env.DESTINY_AVATARS_ENABLED === "true" ? "true" : "false"}
      data-mini={process.env.DESTINY_MINI_ENABLED === "true" ? "true" : "false"}
      data-member-wall={process.env.DESTINY_MEMBER_WALL_ENABLED === "true" ? "true" : "false"}
      data-activity={process.env.DESTINY_ACTIVITY_ID || "meet"}>
      <body style={motionCssVars}>
        <MotionRoot>{children}</MotionRoot>
      </body>
    </html>
  );
}
