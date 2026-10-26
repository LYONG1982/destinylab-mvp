"use client";
import { PRODUCT } from "@/config/product";
import {
  ParticipantAvatar,
  type AvatarSize,
} from "@/components/shared/ParticipantAvatar";
import { validAvatar } from "@/config/avatars";
import Link from "next/link";
import {
  useEffect,
  useRef,
  useId,
  type ReactNode,
  type ButtonHTMLAttributes,
} from "react";
import { ease, motionDuration, ms } from "@/lib/motion-tokens";
import { useVisualEffect } from "@/components/motion/lifecycle";
import type { Participant } from "@/domain/types";
export function Icon({
  name = "spark",
  size = 22,
}: {
  name?: string;
  size?: number;
}) {
  const paths: Record<string, ReactNode> = {
    arrow: (
      <>
        <path d="M5 12h14M13 6l6 6-6 6" />
      </>
    ),
    back: <path d="m14 5-7 7 7 7" />,
    check: <path d="m5 12 4 4L19 6" />,
    heart: (
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />
    ),
    pin: (
      <>
        <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z" />
        <circle cx="12" cy="10" r="2.5" />
      </>
    ),
    chat: (
      <>
        <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5a9.5 9.5 0 0 1 19 0Z" />
        <path d="M7 11h.01M12 11h.01M17 11h.01" />
      </>
    ),
    people: (
      <>
        <circle cx="9" cy="7" r="4" />
        <path d="M1 22v-3a8 8 0 0 1 16 0v3M16 3a4 4 0 0 1 0 8M19 14a7 7 0 0 1 4 6v2" />
      </>
    ),
    coffee: (
      <>
        <path d="M3 8h13v8a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5ZM16 9h3a3 3 0 0 1 0 6h-3M6 2v3M10 2v3M14 2v3" />
      </>
    ),
    walk: (
      <>
        <circle cx="14" cy="3" r="2" />
        <path d="m10 22 2-7-4-3 3-6 4 5h5M8 8l-4 5M13 15l5 6" />
      </>
    ),
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 6v6l4 2" />
      </>
    ),
    screen: (
      <>
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 22h8M12 17v5" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    leaf: (
      <>
        <path d="M20 3C4 2 1 12 8 18c7 6 14-2 12-15ZM4 22 16 8" />
      </>
    ),
    bag: (
      <>
        <rect x="4" y="7" width="16" height="15" rx="2" />
        <path d="M8 7V5a4 4 0 0 1 8 0v2M9 11v7M15 11v7" />
      </>
    ),
    help: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.5 8a2.5 2.5 0 1 1 3.5 2.3c-1 .4-1 1.7-1 2.7M12 17h.01" />
      </>
    ),
    search: (
      <>
        <circle cx="10" cy="10" r="7" />
        <path d="m15 15 6 6" />
      </>
    ),
    spark: (
      <>
        <path d="m12 2 2.6 7.4L22 12l-7.4 2.6L12 22l-2.6-7.4L2 12l7.4-2.6Z" />
      </>
    ),
    send: (
      <>
        <path d="m22 2-7 20-4-9-9-4ZM22 2 11 13" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.spark}
    </svg>
  );
}
export function Brand({
  compact = false,
  light = false,
}: {
  compact?: boolean;
  light?: boolean;
}) {
  return (
    <div className={`brand ${light ? "brand-light" : ""}`}>
      <svg
        width="36"
        height="42"
        viewBox="0 0 42 48"
        aria-hidden="true"
        fill="currentColor"
      >
        <path d="M35 6c-5 0-8 4-7 9C18 16 8 9 2 2c2 12 9 22 23 23-9 2-17-1-23-6 3 10 11 16 21 14-7 6-13 8-20 8 12 4 28-1 32-12 4-7 1-13 2-17l5-4-7-2Z" />
      </svg>
      {!compact && (
        <span>
          <strong>{PRODUCT.name}</strong>
          <small>{PRODUCT.englishName}</small>
        </span>
      )}
    </div>
  );
}
export function Avatar({
  person,
  size = "md",
}: {
  person: Pick<Participant, "gender" | "name" | "id" | "avatarId" | "photo">;
  size?: AvatarSize;
}) {
  return (
    <ParticipantAvatar
      avatarId={
        validAvatar(person.avatarId, person.gender) ? person.avatarId : null
      }
      size={size}
      alt={`${person.name}的系统虚拟头像，不代表本人长相`}
    />
  );
}
export function Button({
  children,
  kind = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  kind?: "primary" | "secondary" | "text" | "danger";
}) {
  return (
    <button
      {...props}
      className={`button button-${kind} ${props.className || ""}`}
    >
      {children}
    </button>
  );
}
export function Notice({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: "info" | "error" | "success";
}) {
  return (
    <div
      className={`notice notice-${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      <Icon
        name={tone === "success" ? "check" : tone === "error" ? "help" : "chat"}
        size={21}
      />
      <span>{children}</span>
    </div>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
function animateModal(dialog: HTMLDialogElement) {
  const animation = dialog.animate(
    [
      { opacity: 0.65, transform: "translateY(8px)" },
      { opacity: 1, transform: "translateY(0)" },
    ],
    { duration: ms(motionDuration.fast), easing: ease("enter") },
  );
  return () => animation.cancel();
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useVisualEffect(ref, animateModal);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={id}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-head">
        <h2 id={id}>{title}</h2>
        <button type="button" className="icon-button" aria-label="关闭弹窗" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-symbol">
        <Icon name="leaf" size={42} />
      </div>
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}
export function Footer() {
  return (
    <footer className="mobile-footer">
      <span>
        MORE PEOPLE
        <br />A KINDER YINCHUAN
      </span>
      <span className="seal">缘</span>
      <span>
        一座城
        <br />
        遇见更多可能
      </span>
    </footer>
  );
}
export function Loading() {
  return (
    <div className="loading">
      <Brand />
      <p>正在准备今天的遇见…</p>
    </div>
  );
}
export function DemoLink() {
  if (typeof document !== "undefined" && document.documentElement.dataset.dataMode === "server") return null;
  return (
    <Link className="demo-link" href="/demo">
      本地演示 · 切换场景
    </Link>
  );
}
export const timeText = (at: number) =>
  new Date(at).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Shanghai",
  });
