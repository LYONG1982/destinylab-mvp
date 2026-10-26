"use client";
import { useLayoutEffect, useRef, type CSSProperties } from "react";
import type { CommonAnswer } from "@/domain/types";
import { QUESTIONS } from "@/data/questions";
import { Icon } from "@/components/ui";
import { commonPointCategory } from "@/features/mobile/match-detail";
import { ease, motionDuration, ms } from "@/lib/motion-tokens";
import { hasPlayed, markPlayed, reduceQuery } from "./lifecycle";

function CommonPointPath({ identity }: { identity: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const key = `common-path:${identity}`;
    const preference = matchMedia(reduceQuery);
    if (hasPlayed(key)) return;
    markPlayed(key);
    if (preference.matches || document.visibilityState !== "visible") return;
    // Establish the starting frame before paint. Final CSS stays visible on cancellation.
    const duration = ms(motionDuration.brand);
    const animations = [...el.querySelectorAll("path")].map((path) =>
      path.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
        duration: duration * 0.75,
        easing: ease(),
        fill: "backwards",
      }),
    );
    const glow = el.querySelector(".match-path-glow");
    if (glow)
      animations.push(
        glow.animate(
          [{ opacity: 0 }, { opacity: 0.45, offset: 0.45 }, { opacity: 0 }],
          {
            duration: duration * 0.45,
            delay: duration * 0.55,
            fill: "backwards",
          },
        ),
      );
    el.dataset.playing = "true";
    void Promise.all(animations.map((animation) => animation.finished)).then(
      () => {
        el.dataset.playing = "false";
      },
      () => {
        /* Cancellation is handled by finish. */
      },
    );
    const finish = () => {
      animations.forEach((animation) => animation.cancel());
      el.dataset.playing = "false";
    };
    const environmentalChange = () => {
      if (preference.matches || document.visibilityState !== "visible")
        finish();
    };
    preference.addEventListener("change", environmentalChange);
    document.addEventListener("visibilitychange", environmentalChange);
    return () => {
      finish();
      preference.removeEventListener("change", environmentalChange);
      document.removeEventListener("visibilitychange", environmentalChange);
    };
  }, [identity]);
  return (
    <svg
      ref={ref}
      className="match-path"
      viewBox="0 0 320 42"
      fill="none"
      aria-hidden="true"
      data-playing="false"
    >
      <path d="M1 8 C65 8 94 40 160 21 S257 3 319 32" pathLength="1" />
      <path d="M1 32 C65 32 100 1 160 21 S257 40 319 8" pathLength="1" />
      <circle className="match-path-glow" cx="160" cy="21" r="7" />
      <circle className="match-path-center" cx="160" cy="21" r="2" />
    </svg>
  );
}

export function CommonAnswerLink({
  common,
  identity,
}: {
  common: CommonAnswer[];
  identity: string;
}) {
  if (!common.length)
    return (
      <section className="match-common-empty">
        <Icon name="leaf" size={22} />
        <h2>
          答案不完全相同，
          <br />
          也许反而值得认识一下。
        </h2>
        <p>不同的想法，也可以成为一个新话题。</p>
      </section>
    );
  return (
    <section className="match-common" aria-labelledby="common-heading">
      <div className="match-common-summary">
        <h2 id="common-heading" className="common-heading">
          你们有 <strong>{common.length}</strong> 个共同点
        </h2>
        <p>{QUESTIONS.length} 个问题里，有些答案刚好一样。</p>
        <CommonPointPath identity={identity} />
      </div>
      <div className="match-common-list">
        {common.map((point, index) => {
          const category = commonPointCategory(point.questionId);
          return (
            <article
              key={point.questionId}
              className="match-common-card match-detail-reveal"
              data-question-id={point.questionId}
              style={
                {
                  "--match-delay": `${Math.min((index + 1) * 0.08, 0.24)}s`,
                } as CSSProperties
              }
            >
              <span className="match-common-icon">
                <Icon name={category.icon} size={23} />
              </span>
              <div className="match-common-copy">
                <h3>{category.label}</h3>
                <p>你们都选择</p>
                <strong>{point.answer}</strong>
              </div>
              <span className="match-same-label">
                <Icon name="check" size={12} />
                同频
              </span>
            </article>
          );
        })}
      </div>
    </section>
  );
}
