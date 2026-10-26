"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { WALL_CONSENT_VERSION, wallNickname, type WallConsentView } from "@/domain/member-wall";
import { MemberFlipCard } from "./MemberWallView";
import { Brand, Button, Notice } from "@/components/ui";
import styles from "./settings.module.css";
export function MemberWallConsent() {
  const params = useSearchParams(), activity = params.get("activity") || "meet";
  const [data, setData] = useState<(WallConsentView & { actor: string }) | null>(null), [nickname, setNickname] = useState("");
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [side, setSide] = useState<"front" | "back">("front");
  useEffect(() => {
    const abort = new AbortController();
    fetch(`/api/member-wall/me?activity=${encodeURIComponent(activity)}`, { cache: "no-store", signal: abort.signal }).then(async (r) => {
      const d = await r.json(); if (!r.ok) throw Error(d.error); if (!abort.signal.aborted) { setData(d); setNickname(d.nickname || d.preview?.nickname || ""); }
    }).catch((e) => { if (!abort.signal.aborted) setError(e.message || "请先进入活动，再设置展示许可。"); });
    return () => abort.abort();
  }, [activity]);
  async function save(allow: boolean) {
    if (!data || busy || (allow && !confirmed)) return;
    setBusy(true); setError(""); setMessage("");
    try {
      if (allow) wallNickname(nickname);
      const r = await fetch(`/api/member-wall/consent?activity=${encodeURIComponent(activity)}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Destiny-Actor": data.actor },
        body: JSON.stringify({ allow, nickname, expectedVersion: data.version, consentVersion: WALL_CONSENT_VERSION }) });
      const d = await r.json(); if (!r.ok) throw Error(d.error || "保存失败。");
      setData({ ...d, actor: data.actor }); setConfirmed(false); setMessage(allow ? "已开启；符合展示条件后，在下一换人周期加入。" : "已停止在卡牌墙展示。");
    } catch (e) { setError(e instanceof Error ? e.message : "暂时无法保存。"); } finally { setBusy(false); }
  }
  let preview = data?.preview;
  try { if (preview) preview = { ...preview, nickname: wallNickname(nickname) }; } catch { preview = null; }
  return <main className={styles.consent}><Brand /><h1>我的遇见卡牌</h1><p>这是一项可选展示，不影响答题和相遇。</p>
    <label>公开昵称<input value={nickname} maxLength={16} disabled={!data || busy} onChange={(e) => { setNickname(e.target.value); setConfirmed(false); }} placeholder="1–8 字昵称，请勿使用真实姓名" /></label>
    {preview && <><div className={styles.preview}><MemberFlipCard card={preview} side={side} reduced /></div><div className={styles.actions}>
      <button onClick={() => setSide("front")} type="button" aria-pressed={side === "front"}>看正面</button><button onClick={() => setSide("back")} type="button" aria-pressed={side === "back"}>看背面</button></div></>}
    <p>仅公开：昵称、性别标识、年龄段、系统虚拟头像、聊天与周末偏好，以及见面看重、沟通方式、关系期待。未回答的项目不展示。</p>
    <p>不公开真实照片、姓名字段、电话或同舟服务资料。请使用昵称，不填写联系方式。开启后上述范围内的改答会同步更新，你可以随时停止展示。</p>
    {data?.allowed && <Notice tone="info">已开启展示{data.eligible ? "" : "，当前参与状态暂不符合上墙条件"}。</Notice>}
    <label className={styles.check}><input type="checkbox" checked={confirmed} disabled={busy || !preview} onChange={(e) => setConfirmed(e.target.checked)} />我已查看正反面内容，同意在活动卡牌墙公开上述范围。</label>
    <Button disabled={!data || busy || !confirmed || !preview} onClick={() => void save(true)}>{data?.allowed ? "保存公开设置" : "自愿开启卡牌展示"}</Button>
    {data?.allowed && <Button kind="secondary" disabled={busy} onClick={() => void save(false)}>停止在卡牌墙展示</Button>}
    {error && <Notice tone="error">{error}</Notice>}{message && <Notice tone="success">{message}</Notice>}
    <Link href={`/mobile/05-discover?activity=${encodeURIComponent(activity)}`}>返回活动</Link>
  </main>;
}
