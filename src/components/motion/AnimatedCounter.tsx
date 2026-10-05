"use client";
import { useCallback, useEffect, useRef } from "react";
import { motionTiming, ms } from "@/lib/motion-tokens";
import { useVisualEffect } from "./lifecycle";

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
  const previous = useRef(fromZero ? 0 : value);
  useEffect(() => {
    if (
      matchMedia("(prefers-reduced-motion: reduce)").matches ||
      document.visibilityState !== "visible"
    )
      previous.current = value;
  }, [value]);
  const animate = useCallback(
    (el: HTMLSpanElement) => {
      const number = el.querySelector<HTMLElement>("[data-number]")!;
      const circle = el.querySelector<SVGCircleElement>("[data-ring]");
      const from = previous.current;
      let frame = 0;
      const draw = (v: number) => {
        number.textContent = String(Math.round(v));
        if (circle) circle.style.strokeDashoffset = String(1 - v / 100);
      };
      const finish = () => {
        cancelAnimationFrame(frame);
        draw(value);
        previous.current = value;
      };
      const begin = performance.now();
      draw(from);
      const tick = (now: number) => {
        const progress = Math.min(1, (now - begin) / ms(motionTiming.counter));
        draw(from + (value - from) * (1 - Math.pow(1 - progress, 3)));
        if (progress < 1) frame = requestAnimationFrame(tick);
        else finish();
      };
      frame = requestAnimationFrame(tick);
      return finish;
    },
    [value],
  );
  useVisualEffect(ref, animate);
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
