"use client";
import { useLayoutEffect, useRef, type RefObject } from "react";
import { motionTiming, ms } from "@/lib/motion-tokens";
import { reduceQuery } from "./lifecycle";

/** Continue from the painted value; a prop update cancels without snapping to the old target. */
export function useAnimatedValue<T extends HTMLElement>(
  ref: RefObject<T | null>,
  value: number,
  fromZero: boolean,
  draw: (element: T, value: number) => void,
) {
  const displayed = useRef(fromZero ? 0 : value);
  useLayoutEffect(() => {
    const el = ref.current!;
    const preference = matchMedia(reduceQuery);
    let frame = 0;
    const paint = (next: number) => {
      displayed.current = next;
      draw(el, next);
    };
    const finish = () => {
      cancelAnimationFrame(frame);
      paint(value);
    };
    const environment = () => {
      if (preference.matches || document.visibilityState !== "visible")
        finish();
    };
    const bounds = el.getBoundingClientRect();
    if (
      preference.matches ||
      document.visibilityState !== "visible" ||
      bounds.bottom <= 0 ||
      bounds.top >= innerHeight ||
      displayed.current === value
    ) {
      finish();
    } else {
      const from = displayed.current;
      const start = performance.now();
      // React may have committed the target text. Restore the starting value before paint.
      paint(from);
      const tick = (now: number) => {
        const progress = Math.min(1, (now - start) / ms(motionTiming.counter));
        paint(from + (value - from) * (1 - Math.pow(1 - progress, 3)));
        if (progress < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }
    preference.addEventListener("change", environment);
    document.addEventListener("visibilitychange", environment);
    return () => {
      cancelAnimationFrame(frame);
      preference.removeEventListener("change", environment);
      document.removeEventListener("visibilitychange", environment);
    };
  }, [ref, value, draw]);
}
