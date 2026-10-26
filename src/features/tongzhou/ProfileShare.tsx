"use client";
import { useState } from "react";
import styles from "./public-profile.module.css";
export function ProfileShare({
  url,
  compact = false,
  agency = false,
}: {
  url?: string;
  compact?: boolean;
  agency?: boolean;
}) {
  const [link, setLink] = useState("");
  const [message, setMessage] = useState("");
  const [qr, setQr] = useState("");
  const [panel, setPanel] = useState(false);
  const [busy, setBusy] = useState(false);
  const absolute = () =>
    new URL(url || location.pathname, location.origin).href;
  async function copy() {
    const address = absolute();
    setLink(address);
    try {
      await navigator.clipboard.writeText(address);
      setMessage("链接已复制，可粘贴发送给微信好友");
    } catch {
      setPanel(true);
      setMessage("请长按或选中下方链接复制");
    }
  }
  async function showQr() {
    setPanel(true);
    setBusy(true);
    setLink(absolute());
    try {
      const { default: QRCode } = await import("qrcode");
      setQr(
        await QRCode.toDataURL(absolute(), {
          width: 320,
          margin: 2,
          errorCorrectionLevel: "M",
          color: { dark: "#56333d", light: "#ffffff" },
        }),
      );
      setMessage("");
    } catch {
      setMessage("二维码生成失败，请复制链接");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={`${styles.share} ${compact ? styles.compactShare : ""}`}>
      <div className={styles.shareButtons}>
        <button type="button" onClick={() => void copy()}>
          复制链接
        </button>
        {!compact && (
          <>
            <button type="button" disabled={busy} onClick={() => void showQr()}>
              {busy ? "生成中…" : "查看二维码"}
            </button>
            {!agency && (
              <button
                type="button"
                onClick={() => {
                  setPanel(true);
                  setLink(absolute());
                  setMessage(
                    "在微信内打开页面后，点击右上角“···”转发给朋友；也可以复制链接发送。",
                  );
                }}
              >
                微信转发
              </button>
            )}
          </>
        )}
      </div>
      {message && (
        <p className={styles.shareStatus} role="status">
          {message}
        </p>
      )}
      {panel && (
        <div className={styles.sharePanel}>
          {qr && (
            <>
              <img
                className={styles.qr}
                src={qr}
                alt="个人宣传页二维码"
                width="240"
                height="240"
              />
              <a href={qr} download="同舟-个人宣传页二维码.png">
                保存二维码
              </a>
            </>
          )}
          <label>
            专属链接
            <input
              aria-label="宣传页链接"
              readOnly
              value={link}
              onFocus={(e) => e.currentTarget.select()}
            />
          </label>
          {agency && <p>局域网 UAT 验证时，手机需连接同一 Wi-Fi。</p>}
          <button
            type="button"
            onClick={() => {
              setPanel(false);
              setQr("");
              setMessage("");
            }}
          >
            收起
          </button>
        </div>
      )}
    </div>
  );
}
