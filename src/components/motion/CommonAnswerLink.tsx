"use client";
import { useCallback, useRef } from "react";
import type { CommonAnswer } from "@/domain/types";
import { QUESTIONS } from "@/data/questions";
import { ease, motionDuration, motionTiming, ms } from "@/lib/motion-tokens";
import { useVisualEffect } from "./lifecycle";

export function CommonAnswerLink({ common }: { common: CommonAnswer[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const signature = common.map((c) => `${c.questionId}:${c.answer}`).join("|");
  const draw = useCallback(
    (el: HTMLDivElement) => {
      if (el.dataset.answerSignature !== signature) return () => {};
      const paths = [...el.querySelectorAll("path")];
      const animations = paths.map((path, index) =>
        path.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
          duration: ms(motionDuration.slow),
          delay: ms(index * motionTiming.answerGap),
          easing: ease(),
          fill: "backwards",
        }),
      );
      const count = el.querySelector(".common-heading strong");
      if (paths.length && count)
        animations.push(
          count.animate(
            [
              { transform: "scale(1)" },
              { transform: "scale(1.06)" },
              { transform: "scale(1)" },
            ],
            {
              duration: ms(motionDuration.slow),
              delay: ms(
                (paths.length - 1) * motionTiming.answerGap +
                  motionDuration.slow,
              ),
              easing: ease(),
            },
          ),
        );
      return () => animations.forEach((a) => a.cancel());
      // A new set of actual answers starts a new visual sequence, unrelated store updates do not.
    },
    [signature],
  );
  useVisualEffect(ref, draw);
  return (
    <div ref={ref} className="common-links" data-answer-signature={signature}>
      <h2 className="common-heading">
        你们有 <strong>{common.length}</strong> 道答案相同
      </h2>
      <div className="common-list">
        {common.map((c) => (
          <div className="common-link" key={c.questionId}>
            <small>{QUESTIONS.find((q) => q.id === c.questionId)?.short}</small>
            <div>
              <strong>{c.answer}</strong>
              <svg viewBox="0 0 100 28" aria-hidden="true">
                <path d="M3 14 C30 14 34 5 50 14 S70 14 97 14" pathLength="1" />
                <circle cx="3" cy="14" r="2" />
                <circle cx="97" cy="14" r="2" />
              </svg>
              <strong>{c.answer}</strong>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
