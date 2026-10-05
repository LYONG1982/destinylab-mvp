"use client";
import { useCallback, useEffect, useRef } from "react";
import type { Participant } from "@/domain/types";
import { Avatar } from "@/components/ui";
import { ease, motionDuration, ms } from "@/lib/motion-tokens";
import {
  hasPlayed,
  markPlayed,
  reduceQuery,
  useVisualEffect,
} from "./lifecycle";

export function MutualEncounterMotion({
  me,
  other,
  identity,
  pointName,
}: {
  me: Participant;
  other: Participant;
  identity: string;
  pointName?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const key = `hasPlayedMutualMotion:${identity}`;
  useEffect(() => {
    if (matchMedia(reduceQuery).matches) markPlayed(key);
  }, [key]);
  const animate = useCallback(
    (el: HTMLDivElement) => {
      if (hasPlayed(key)) return () => {};
      markPlayed(key);
      el.dataset.playing = "true";
      const total = ms(motionDuration.brand);
      const animations: Animation[] = [];
      const run = (
        selector: string,
        frames: Keyframe[],
        duration: number,
        delay = 0,
      ) => {
        el.querySelectorAll(selector).forEach((node) =>
          animations.push(
            node.animate(frames, {
              duration: total * duration,
              delay: total * delay,
              easing: ease("enter"),
              fill: "backwards",
            }),
          ),
        );
      };
      run(
        ".mutual-person",
        [
          { opacity: 0.4, transform: "scale(.96)" },
          { opacity: 1, transform: "scale(1)" },
        ],
        0.2,
      );
      run(
        ".mutual-path",
        [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }],
        0.4,
        0.15,
      );
      run(
        ".mutual-intersection",
        [
          { opacity: 0, transform: "scale(0)" },
          { opacity: 1, transform: "scale(1.12)" },
          { opacity: 1, transform: "scale(1)" },
        ],
        0.2,
        0.5,
      );
      run(".mutual-copy", [{ opacity: 0.4 }, { opacity: 1 }], 0.2, 0.65);
      run(".mutual-place-copy", [{ opacity: 0.4 }, { opacity: 1 }], 0.15, 0.85);
      const finish = () => {
        animations.forEach((a) => a.cancel());
        el.dataset.playing = "false";
      };
      // Pure presentation; no domain command or navigation is tied to completion.
      Promise.all(animations.map((a) => a.finished.catch(() => {}))).then(
        () => {
          el.dataset.playing = "false";
        },
      );
      return finish;
    },
    [key],
  );
  useVisualEffect(ref, animate);
  return (
    <div
      ref={ref}
      className="mutual-motion"
      data-testid="mutual-motion"
      data-playing="false"
    >
      <div className="mutual-portraits">
        <div className="mutual-person">
          <Avatar person={me} size="xl" />
          <h3>{me.name}</h3>
          <p>{me.age} 岁</p>
        </div>
        <svg
          className="mutual-tracks destiny-track"
          viewBox="0 0 240 100"
          aria-hidden="true"
          fill="none"
        >
          <path
            className="mutual-path"
            d="M2 18 C60 18 75 72 122 48 S185 17 238 22"
            pathLength="1"
          />
          <path
            className="mutual-path"
            d="M2 76 C61 76 77 21 122 48 S185 80 238 72"
            pathLength="1"
          />
          <circle className="mutual-intersection" cx="122" cy="48" r="4" />
        </svg>
        <div className="mutual-person">
          <Avatar person={other} size="xl" />
          <h3>{other.name}</h3>
          <p>{other.age} 岁</p>
        </div>
      </div>
      <p className="mutual-copy">你们都愿意认识彼此。</p>
      <p className="mutual-place-copy">
        {pointName
          ? `${pointName} 已为你们准备好。`
          : "你们的意愿已保留，正在等候相遇点。"}
      </p>
    </div>
  );
}
