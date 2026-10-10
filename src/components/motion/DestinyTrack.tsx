"use client";
import { useCallback, useRef } from "react";
import { ease, motionDuration, ms } from "@/lib/motion-tokens";
import { useVisualEffect } from "./lifecycle";

export function DestinyTrack({
  animated = true,
  className = "",
}: {
  animated?: boolean;
  className?: string;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const draw = useCallback(
    (el: SVGSVGElement) => {
      const animations = animated
        ? [...el.querySelectorAll("path")].map((path) =>
            path.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
              duration: ms(motionDuration.slow),
              easing: ease(),
            }),
          )
        : [];
      return () => animations.forEach((a) => a.cancel());
    },
    [animated],
  );
  useVisualEffect(ref, draw);
  return (
    <svg
      ref={ref}
      className={`destiny-track ${className}`}
      viewBox="0 0 240 90"
      fill="none"
      aria-hidden="true"
    >
      <path d="M2 20 C65 20 76 70 125 47 S190 16 238 22" pathLength="1" />
      <path d="M2 70 C62 70 74 20 125 47 S190 77 238 68" pathLength="1" />
    </svg>
  );
}
