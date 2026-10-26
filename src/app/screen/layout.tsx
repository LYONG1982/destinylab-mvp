import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Destiny Field · 缘分场",
  description: "一个持续运行的数字关系世界。",
  robots: { index: false, follow: false },
};
export default function ScreenLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
