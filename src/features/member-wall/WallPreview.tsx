"use client";
import { useEffect, useRef, useState } from "react";
import type { WallConfig } from "@/domain/member-wall";
import styles from "./settings.module.css";
export function wallPreviewUrl(
  activity: string,
  config: WallConfig,
  scene = "motion",
) {
  const params = new URLSearchParams({
    activity,
    state: scene,
    flip: String(config.flipSeconds),
    rotation: String(config.rotationSeconds),
    ratio: String(config.ratio),
    running: String(config.running),
  });
  return `/display/member-wall/preview?${params}`;
}
export function WallPreview({
  activity,
  config,
}: {
  activity: string;
  config: WallConfig;
}) {
  const [scene, setScene] = useState("front"),
    [ratio, setRatio] = useState("wide"),
    [width, setWidth] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const w = ratio === "wide" ? 1920 : 1440,
    h = ratio === "wide" ? 1080 : 1000;
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const url = wallPreviewUrl(activity, config, scene);
  return (
    <aside className={styles.previewPanel} data-wall-preview>
      <div className={styles.sectionHead}>
        <h2>效果预览</h2>
        <span className={styles.pill}>模拟资料</span>
      </div>
      <p className={styles.hint}>仅预览当前参数，不影响现场。</p>
      <div className={styles.previewTools}>
        <label>
          预览场景
          <select
            aria-label="预览场景"
            value={scene}
            onChange={(e) => setScene(e.target.value)}
          >
            <option value="front">卡片正面</option>
            <option value="back">卡片背面</option>
            <option value="motion">翻面与轮播</option>
            <option value="low">8 人与空位</option>
            <option value="empty">空场</option>
          </select>
        </label>
        <label>
          屏幕比例
          <select
            aria-label="屏幕比例"
            value={ratio}
            onChange={(e) => setRatio(e.target.value)}
          >
            <option value="wide">16:9 大屏</option>
            <option value="desktop">桌面窗口</option>
          </select>
        </label>
      </div>
      <div
        ref={root}
        className={styles.previewFrame}
        style={{ aspectRatio: `${w} / ${h}` }}
      >
        {width > 0 && (
          <iframe
            key={url}
            title="模拟卡牌墙缩略预览"
            src={url}
            tabIndex={-1}
            aria-hidden="true"
            style={{ width: w, height: h, transform: `scale(${width / w})` }}
          />
        )}
      </div>
      <a
        className={styles.previewLink}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
      >
        在新窗口查看完整预览 ↗
      </a>
      <div className={styles.previewNotes}>
        <strong>现场保持四行六列</strong>
        <p>
          男女各12席，不足留空。已在场并完成展示许可的用户，才会进入真实展示池。
        </p>
      </div>
    </aside>
  );
}
