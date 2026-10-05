"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { QUESTIONS } from "@/data/questions";
import { ease, motionTiming, ms } from "@/lib/motion-tokens";
import { reduceQuery } from "./lifecycle";
import { Motion } from "./Motion";

/** Outgoing content is a noninteractive visual copy; the current question is never gated. */
export function QuestionTransition({
  questionKey,
  children,
}: {
  questionKey: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = ref.current!;
    const outgoing = previous.current;
    previous.current = el.firstElementChild!.cloneNode(true) as HTMLElement;
    if (
      !outgoing ||
      matchMedia(reduceQuery).matches ||
      document.visibilityState !== "visible"
    )
      return;
    outgoing.className = "question-outgoing";
    outgoing.setAttribute("aria-hidden", "true");
    outgoing.inert = true;
    outgoing
      .querySelectorAll("[id]")
      .forEach((node) => node.removeAttribute("id"));
    el.append(outgoing);
    const animation = outgoing.animate(
      [
        { opacity: 0.6, transform: "translateX(0)" },
        { opacity: 0, transform: "translateX(-16px)" },
      ],
      { duration: ms(motionTiming.question), easing: ease("exit") },
    );
    const finish = () => {
      animation.cancel();
      outgoing.remove();
    };
    animation.onfinish = finish;
    const preference = matchMedia(reduceQuery);
    const check = () => {
      if (preference.matches || document.visibilityState !== "visible")
        finish();
    };
    preference.addEventListener("change", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      finish();
      preference.removeEventListener("change", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [questionKey]);
  return (
    <div className="question-transition" ref={ref}>
      <Motion key={questionKey} preset="question">
        {children}
      </Motion>
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
