import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "缘分实验室 · Destiny Lab",
  description: "从一个共同话题，开始认识。银川鼓楼现场社交体验，本地演示。",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
