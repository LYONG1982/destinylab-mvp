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
      data-activity={process.env.DESTINY_ACTIVITY_ID || "meet"}>
      <body style={motionCssVars}>
        <MotionRoot>{children}</MotionRoot>
      </body>
    </html>
  );
}
