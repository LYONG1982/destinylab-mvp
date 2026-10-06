"use client";
import { useCallback, useRef } from "react";
import { useAnimatedValue } from "./useAnimatedValue";

export function AnimatedCounter({
  value,
  fromZero = false,
  suffix = "",
  ring = false,
}: {
  value: number;
  fromZero?: boolean;
  suffix?: string;
  ring?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const draw = useCallback((el: HTMLSpanElement, next: number) => {
    el.querySelector<HTMLElement>("[data-number]")!.textContent = String(
      Math.round(next),
    );
    const circle = el.querySelector<SVGCircleElement>("[data-ring]");
    if (circle) circle.style.strokeDashoffset = String(1 - next / 100);
  }, []);
  useAnimatedValue(ref, value, fromZero, draw);
  return (
    <span
      ref={ref}
      className={`animated-counter ${ring ? "counter-ring" : ""}`}
      role="img"
      aria-label={`${value}${suffix}`}
    >
      {ring && (
        <svg viewBox="0 0 140 140" aria-hidden="true">
          <circle className="ring-base" cx="70" cy="70" r="64" />
          <circle
            data-ring
            cx="70"
            cy="70"
            r="64"
            pathLength="1"
            strokeDasharray="1"
            strokeDashoffset={1 - value / 100}
          />
        </svg>
      )}
      <span aria-hidden="true">
        <span data-number>{value}</span>
        {suffix && <small>{suffix}</small>}
      </span>
    </span>
  );
}
