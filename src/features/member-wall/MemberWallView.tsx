"use client";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import QRCode from "qrcode";
import { wallAgeLabel, wallColumns, wallCardSlots, WALL_COLUMNS, type PublicMemberCard, type WallConfig } from "@/domain/member-wall";
import styles from "./wall.module.css";

export function MemberFlipCard({ card, column = 0, side = "front", reduced = false }: {
  card?: PublicMemberCard; column?: number; side?: "front" | "back"; reduced?: boolean;
}) {
  if (!card) return <article className={styles.placeholder} aria-label="等待相遇"><span>✦</span><p>等待相遇</p><small>下一段故事，即将到来</small></article>;
  return <article className={styles.card} data-member={card.id} data-gender={card.gender} data-side={side} data-reduced={reduced}
    style={{ "--delay": `${column * 90}ms` } as CSSProperties}>
    <div className={styles.inner}>
      <section className={`${styles.face} ${styles.front}`} aria-hidden={side !== "front"}>
        <div className={styles.portrait}><span className={styles.genderBadge}>{card.gender === "male" ? "♂ 男生" : "♀ 女生"}</span><img src={card.avatarUrl} alt="系统虚拟头像，不代表本人长相" draggable={false} /></div>
        <div className={styles.identity}><h2>{card.nickname}</h2>{card.ageRange && <span className={styles.age}>{wallAgeLabel(card.ageRange)}</span>}
          <div className={styles.tags}>{card.tags.map((tag) => <span key={tag}>{tag}</span>)}</div></div>
      </section>
      <section className={`${styles.face} ${styles.back}`} aria-hidden={side !== "back"}>
        <header><h2>{card.nickname}</h2></header>
        <dl>{card.preferences.map((p) => <div key={p.label}><dt>{p.label}</dt><dd>{p.value}</dd></div>)}</dl>
        {!card.preferences.length && <p className={styles.noPreference}>故事，留待相遇时慢慢说</p>}
      </section>
    </div>
  </article>;
}
function WallQR({ joinUrl, mini, activity }: { joinUrl?: string; mini: boolean; activity: string }) {
  const [image, setImage] = useState("");
  useEffect(() => {
    let alive = true, objectUrl = "";
    const controller = new AbortController();
    async function read() {
      setImage("");
      try {
        if (mini) {
          const r = await fetch(`/api/mini/code?activity=${encodeURIComponent(activity)}`, { cache: "no-store", signal: controller.signal });
          if (!r.ok) return;
          objectUrl = URL.createObjectURL(await r.blob());
          if (alive) setImage(objectUrl);
        } else if (joinUrl) {
          const url = new URL(joinUrl);
          if (!["http:", "https:"].includes(url.protocol)) return;
          const data = await QRCode.toDataURL(url.href, { width: 640, margin: 4, errorCorrectionLevel: "M", color: { dark: "#30151e", light: "#fff9ec" } });
          if (alive) setImage(data);
        }
      } catch { /* Hide the QR area until a usable entry image is available. */ }
    }
    void read();
    return () => { alive = false; controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [joinUrl, mini, activity]);
  if (!image) return null;
  return <div className={styles.qrArea}><img src={image} alt="扫码参与活动" />
    <div><strong>扫码，加入这场遇见</strong><p>参与互动，自愿开启卡牌展示</p></div></div>;
}
export function MemberWallView({ cards, config, side, flipping, swap, demo, total, male, female, status,
  joinUrl, activity, reduced, controls, onLayout }: {
  cards: PublicMemberCard[]; config: WallConfig; side: "front" | "back"; flipping: boolean;
  swap: "idle" | "out" | "in"; demo: boolean; total: number; male: number; female: number; status: string;
  joinUrl?: string; activity: string; reduced: boolean; controls?: ReactNode;
  onLayout: (columns: number, readable: boolean) => void;
}) {
  const grid = useRef<HTMLDivElement>(null), root = useRef<HTMLElement>(null);
  const [layout, setLayout] = useState({ columns: WALL_COLUMNS, scale: 1, readable: true });
  useEffect(() => {
    const el = grid.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const next = wallColumns(entry.contentRect.width, entry.contentRect.height);
      setLayout((old) => old.columns === next.columns && Math.abs(old.scale - next.scale) < .01 && old.readable === next.readable ? old : next);
      onLayout(next.columns, next.readable);
    });
    observer.observe(el); return () => observer.disconnect();
  }, [onLayout]);
  const slots = wallCardSlots(layout.readable ? cards : []);
  const hasCards = slots.some(Boolean);
  return <main ref={root} className={styles.wall} data-testid="member-wall" data-side={side} data-flipping={flipping}
    data-columns={layout.columns} data-mode={demo ? "demo" : "real"} data-status={status}
    style={{ "--wall-scale": layout.scale, "--columns": layout.columns } as CSSProperties}>
    <header className={styles.header}><div><div className={styles.brand}>同舟婚恋 <span /> DESTINY LAB</div>
      <h1>遇见<span> · </span>卡牌墙</h1><p>从一个共同话题，开始认识。</p></div>
      <div className={styles.headerRight}>
        <dl className={styles.metrics}><div><dd>{total}</dd><dt>总人数</dt></div><div data-gender="male"><dd>{male}</dd><dt>男生人数</dt></div><div data-gender="female"><dd>{female}</dd><dt>女生人数</dt></div></dl></div>
    </header>
    <div ref={grid} className={styles.content}>
      {layout.readable ? <div className={styles.grid} data-swap={swap}>
        {slots.map((card, index) => <MemberFlipCard key={index} card={card} column={index % layout.columns} side={side} reduced={reduced} />)}
      </div> : <div className={styles.safeSize}>请横屏或使用更大的显示区域<p>为保持头像与昵称清晰，此窗口暂不展示卡牌。</p></div>}
      {!hasCards && layout.readable && <div className={styles.empty}><span>缘分实验室</span><h2>{status === "expired" ? "连接暂时中断" : "让下一次遇见，从这里开始"}</h2><p>{status === "expired" ? "资料已暂时隐藏，恢复连接后重新确认展示许可。" : "扫码参与活动，自愿开启展示后加入卡牌墙。"}</p></div>}
    </div>
    <footer className={styles.footer}><div className={styles.footerCopy}><strong>每一个你，都有值得被看见的故事。</strong>
      <div className={styles.controls}><button type="button" onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void root.current?.requestFullscreen().catch(() => {}); }}>全屏</button>{controls}
        <span role="status">{status === "expired" ? "连接中断 · 已隐藏资料" : status === "connecting" ? "正在连接" : !config.running ? "轮播已暂停" : demo ? "演示预览" : "实时展示"}</span></div></div>
      <WallQR joinUrl={joinUrl} mini={!demo && typeof document !== "undefined" && document.documentElement.dataset.mini === "true"} activity={activity} />
    </footer>
  </main>;
}
