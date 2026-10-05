"use client";
import { useCallback, useRef } from "react";
import { ease, motionDuration, ms } from "@/lib/motion-tokens";
import { useVisualEffect } from "./lifecycle";
export function RouteDraw({
  point,
  merchant,
}: {
  point: string;
  merchant: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const animate = useCallback((el: HTMLDivElement) => {
    const animation = el
      .querySelector("path")!
      .animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
        duration: ms(motionDuration.slow),
        easing: ease(),
      });
    return () => animation.cancel();
  }, []);
  useVisualEffect(ref, animate);
  return (
    <div className="route-draw" ref={ref}>
      <span>{point}</span>
      <svg viewBox="0 0 120 28" aria-hidden="true">
        <path d="M4 14 C40 14 70 8 116 14" pathLength="1" />
        <circle cx="4" cy="14" r="3" />
        <circle cx="116" cy="14" r="3" />
      </svg>
      <span>{merchant}</span>
      <small>一起走向城市里的下一站</small>
    </div>
  );
}
