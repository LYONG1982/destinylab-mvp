"use client";
import {
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type Ref,
  type ReactNode,
} from "react";
import { QUESTIONS } from "@/data/questions";
import { ease } from "@/lib/motion-tokens";
import { reduceQuery } from "./lifecycle";

export interface QuestionTransitionHandle {
  busy: () => boolean;
  change: (commit: () => void, isCurrent?: () => boolean) => Promise<void>;
}

/** One live question: finish the selection, replace while faded, then enter before paint. */
export function QuestionTransition({
  questionKey,
  children,
  ref,
}: {
  questionKey: string;
  children: ReactNode;
  ref?: Ref<QuestionTransitionHandle>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const animation = useRef<Animation | null>(null);
  const pending = useRef<(() => void) | null>(null);
  const replace = useRef<(() => void) | null>(null);
  const mounted = useRef(false);
  const finish = () => {
    animation.current?.cancel();
    animation.current = null;
    replace.current = null;
    if (host.current) {
      const entered = host.current.dataset.phase === "entering";
      host.current.inert = false;
      host.current.style.minHeight = "";
      host.current.dataset.phase = "idle";
      if (entered && mounted.current && document.visibilityState === "visible")
        host.current
          .querySelector<HTMLElement>("h1")
          ?.focus({ preventScroll: true });
    }
    pending.current?.();
    pending.current = null;
  };
  useImperativeHandle(ref, () => ({
    busy: () => pending.current !== null,
    change: (commit, isCurrent = () => true) => {
      if (pending.current || !mounted.current || !isCurrent())
        return Promise.resolve();
      if (document.visibilityState !== "visible") return Promise.resolve();
      if (matchMedia(reduceQuery).matches) {
        commit();
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        pending.current = resolve;
        const el = host.current!;
        el.inert = true;
        el.style.minHeight = `${el.getBoundingClientRect().height}px`;
        el.dataset.phase = "leaving";
        const exit = el.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: 70,
          easing: ease("exit"),
          fill: "forwards",
        });
        animation.current = exit;
        const next = () => {
          replace.current = null;
          if (
            !mounted.current ||
            !isCurrent() ||
            document.visibilityState !== "visible"
          )
            finish();
          else commit();
        };
        replace.current = next;
        exit.onfinish = next;
      });
    },
  }));
  useLayoutEffect(() => {
    const el = host.current!;
    if (!pending.current) return;
    animation.current?.cancel();
    el.dataset.phase = "entering";
    if (
      matchMedia(reduceQuery).matches ||
      document.visibilityState !== "visible"
    ) {
      finish();
      return;
    }
    const entry = el.animate(
      [
        { opacity: 0, transform: "translateY(5px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 140, easing: ease("enter"), fill: "both" },
    );
    animation.current = entry;
    entry.onfinish = finish;
  }, [questionKey]);
  useLayoutEffect(() => {
    mounted.current = true;
    const preference = matchMedia(reduceQuery);
    const stop = () => {
      if (document.visibilityState !== "visible") finish();
      else if (preference.matches) {
        if (replace.current) {
          animation.current?.cancel();
          replace.current();
        } else finish();
      }
    };
    preference.addEventListener("change", stop);
    document.addEventListener("visibilitychange", stop);
    return () => {
      mounted.current = false;
      finish();
      preference.removeEventListener("change", stop);
      document.removeEventListener("visibilitychange", stop);
    };
  }, []);
  return (
    <div ref={host} className="question-transition" data-question={questionKey}>
      <div>{children}</div>
    </div>
  );
}
export function DestinyProgressTrack({
  answers,
  current,
}: {
  answers: Record<string, string>;
  current: number;
}) {
  return (
    <ol
      className="destiny-progress"
      aria-label={`已完成 ${QUESTIONS.filter((q) => answers[q.id]).length} 道，共 ${QUESTIONS.length} 道`}
    >
      {QUESTIONS.map((q, index) => (
        <li
          key={q.id}
          data-complete={!!answers[q.id]}
          aria-current={current === index ? "step" : undefined}
          aria-label={`第 ${index + 1} 题${answers[q.id] ? "已完成" : "未完成"}`}
        >
          <span />
        </li>
      ))}
    </ol>
  );
}
