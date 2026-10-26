"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { DEFAULT_WALL_CONFIG, type WallConfig, type WallSnapshot } from "@/domain/member-wall";
import { Button, Notice } from "@/components/ui";
import styles from "./settings.module.css";
type AdminView = WallSnapshot & { exposure: { code: string; nickname: string; seconds: number; last: number }[] };
export function MemberWallSettings({ activity }: { activity: string }) {
  const [data, setData] = useState<AdminView | null>(null), [config, setConfig] = useState<WallConfig>(DEFAULT_WALL_CONFIG);
  const [error, setError] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    fetch(`/api/member-wall/admin?activity=${encodeURIComponent(activity)}`, { signal: abort.signal, cache: "no-store" }).then(async (r) => {
      const d = await r.json(); if (!r.ok) throw Error(d.error); if (!abort.signal.aborted) { setData(d); setConfig(d.config); }
    }).catch((e) => { if (!abort.signal.aborted) setError(e.message || "配置不可读取。"); });
    return () => abort.abort();
  }, [activity]);
  async function save() {
    if (!data || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const r = await fetch(`/api/member-wall/config?activity=${encodeURIComponent(activity)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config, expectedVersion: data.configVersion }) });
      const d = await r.json(); if (!r.ok) throw Error(d.error); setData(d); setConfig(d.config);
      setMessage("设置已保存。请在卡牌墙重新启动主屏，使新周期从正面开始。");
    } catch (e) { setError(e instanceof Error ? e.message : "保存失败。"); } finally { setBusy(false); }
  }
  return <section className={styles.settings}><div className={styles.actions}>
    <Link href={`/display/member-wall?activity=${encodeURIComponent(activity)}`} target="_blank">打开卡牌墙</Link>
    <Link href="/display/member-wall/preview?state=motion" target="_blank">视觉与动效预览</Link></div>
    <p>参与 {data?.total || 0} 人 · 符合展示条件 {data?.eligible || 0} 人 · {data?.activeScreen ? "主屏运行中" : "尚无主屏"}</p>
    <div className={styles.fields}>
      <p>固定四行六列：每行左三男、右三女，男女各 12 席。</p>
      <label>数据模式<select value={config.mode} onChange={(e) => setConfig({ ...config, mode: e.target.value as WallConfig["mode"] })}><option value="real">真实活动资料</option><option value="demo">演示数据（持续标识）</option></select></label>
      <label>翻面间隔（秒）<input type="number" min={8} max={60} value={config.flipSeconds} onChange={(e) => setConfig({ ...config, flipSeconds: Number(e.target.value) })} /></label>
      <label>换人间隔（秒）<input type="number" min={config.flipSeconds * 2} max={600} value={config.rotationSeconds} onChange={(e) => setConfig({ ...config, rotationSeconds: Number(e.target.value) })} /></label>
      <label>每轮换人比例<select value={config.ratio} onChange={(e) => setConfig({ ...config, ratio: Number(e.target.value) as WallConfig["ratio"] })}>{[25, 50, 100].map((v) => <option key={v} value={v}>{v}%</option>)}</select></label>
    </div><label className={styles.check}><input type="checkbox" checked={config.running} onChange={(e) => setConfig({ ...config, running: e.target.checked })} />启用翻面与轮播（暂停仍实时检查展示许可）</label>
    <Button disabled={busy || !data} onClick={() => void save()}>保存展示设置</Button>
    {error && <Notice tone="error">{error}</Notice>}{message && <Notice tone="success">{message}</Notice>}
    <p>同一活动只由一个已登录运营的窗口启动主屏。其他窗口只读展示；停用参与者使用原“参与用户”管理，不代替用户授权。</p>
    <details><summary>查看展示时长统计（不是观看人数）</summary><div className={styles.table}><table><thead><tr><th>公开昵称</th><th>遇见码</th><th>累计秒数</th></tr></thead><tbody>{data?.exposure.map((x) => <tr key={x.code}><td>{x.nickname}</td><td>{x.code}</td><td>{Math.round(x.seconds)}</td></tr>)}</tbody></table></div></details>
  </section>;
}
