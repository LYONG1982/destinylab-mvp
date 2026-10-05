import Link from "next/link";
export default function NotFound() {
  return (
    <main className="loading">
      <h1>这条路，换个方向走</h1>
      <p>没有找到这个页面。</p>
      <Link href="/demo">返回演示入口 →</Link>
    </main>
  );
}
