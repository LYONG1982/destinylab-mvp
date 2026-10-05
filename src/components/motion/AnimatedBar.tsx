"use client";
import { useCallback, useEffect, useRef } from "react";
import { ease, motionTiming, ms } from "@/lib/motion-tokens";
import { useVisualEffect } from "./lifecycle";
export function AnimatedBar({
  percentage,
  fromZero = false,
}: {
  percentage: number;
  fromZero?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  const previous = useRef(fromZero ? 0 : percentage);
  useEffect(() => {
    if (
      matchMedia("(prefers-reduced-motion: reduce)").matches ||
      document.visibilityState !== "visible"
    )
      previous.current = percentage;
  }, [percentage]);
  const animate = useCallback(
    (el: HTMLElement) => {
      const animation = el.animate(
        [
          { transform: `scaleX(${previous.current / 100})` },
          { transform: `scaleX(${percentage / 100})` },
        ],
        { duration: ms(motionTiming.counter), easing: ease() },
      );
      previous.current = percentage;
      return () => animation.cancel();
    },
    [percentage],
  );
  useVisualEffect(ref, animate);
  return (
    <i
      className="animated-bar"
      ref={ref}
      style={{
        width: "100%",
        transform: `scaleX(${percentage / 100})`,
        transformOrigin: "left",
      }}
    />
  );
}
