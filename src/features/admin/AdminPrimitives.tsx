"use client";

import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { Badge } from "@/components/ui";
import { REGISTRATION_STATUS } from "@/domain/registration";

type Tone = "neutral" | "success" | "warning" | "wine";

function AdminStatus({ label, tone }: { label: string; tone: Tone }) {
  return (
    <span className="admin-status">
      <Badge tone={tone}>{label}</Badge>
    </span>
  );
}

export function RegistrationStatus({ status }: { status: string }) {
  const labels: Record<string, string> = REGISTRATION_STATUS;
  return (
    <AdminStatus
      label={Object.hasOwn(labels, status) ? labels[status] : "状态待确认"}
      tone={
        status === "checked_in"
          ? "success"
          : status === "registered"
            ? "warning"
            : "neutral"
      }
    />
  );
}

export function PresenceStatus({ present }: { present: boolean }) {
  return (
    <AdminStatus
      label={present ? "在场" : "已离场"}
      tone={present ? "success" : "neutral"}
    />
  );
}

export function PhaseStatus({ label }: { label: string }) {
  const tones: Record<string, Tone> = {
    暂停推荐: "warning",
    等待回应: "warning",
    等待相遇点: "warning",
    双方愿意见面: "wine",
    前往相遇点: "wine",
    已确认见面: "wine",
    已选择下一站: "wine",
    答题中: "wine",
    探索中: "wine",
  };
  return (
    <AdminStatus
      label={label || "状态待确认"}
      tone={Object.hasOwn(tones, label) ? tones[label] : "neutral"}
    />
  );
}

/** Native modality keeps keyboard focus inside and the underlying list inert. */
export function AdminDialog({
  title,
  variant,
  busy = false,
  returnFocus,
  onClose,
  children,
}: {
  title: string;
  variant: "drawer" | "confirm";
  busy?: boolean;
  returnFocus?: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current;
    const trigger = returnFocus?.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      queueMicrotask(() => {
        if (trigger?.isConnected && !trigger.matches(":disabled")) {
          trigger.focus({ preventScroll: true });
        }
      });
    };
  }, [returnFocus]);
  return (
    <dialog
      ref={ref}
      className={`admin-dialog admin-dialog-${variant}`}
      aria-labelledby={id}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
          ),
        ).filter((element) => element.getClientRects().length > 0);
        const first = controls[0],
          last = controls.at(-1);
        if (!first) {
          event.preventDefault();
          return;
        }
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header className="admin-dialog-heading">
        <h2 id={id}>{title}</h2>
        <button
          type="button"
          className="admin-dialog-close"
          aria-label={variant === "drawer" ? "关闭详情" : "关闭确认"}
          disabled={busy}
          onClick={onClose}
        >
          ×
        </button>
      </header>
      {children}
    </dialog>
  );
}
