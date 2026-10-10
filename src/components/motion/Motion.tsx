"use client";
import {
  useCallback,
  useEffect,
  useRef,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import {
  ease,
  motionDuration as duration,
  motionTiming as timing,
  ms,
} from "@/lib/motion-tokens";
import { useVisualEffect, reduceQuery } from "./lifecycle";

export type MotionPreset =
  | "enter"
  | "question"
  | "avatar"
  | "soft"
  | "code"
  | "pulse"
  | "hero";
export function Motion({
  children,
  as = "div",
  preset = "enter",
  delay = 0,
  ...props
}: HTMLAttributes<HTMLElement> & {
  children: ReactNode;
  as?: "div" | "span" | "article" | "section";
  preset?: MotionPreset;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const animate = useCallback(
    (el: HTMLElement) => {
      const specs: Record<MotionPreset, [Keyframe[], number]> = {
        enter: [
          [
            { opacity: 0, transform: "translateY(16px)" },
            { opacity: 1, transform: "translateY(0)" },
          ],
          duration.normal,
        ],
        question: [
          [
            { opacity: 0.35, transform: "translateX(16px)" },
            { opacity: 1, transform: "translateX(0)" },
          ],
          timing.question,
        ],
        avatar: [
          [
            { opacity: 0.4, transform: "scale(.96)" },
            { opacity: 1, transform: "scale(1)" },
          ],
          timing.avatar,
        ],
        soft: [[{ opacity: 0.65 }, { opacity: 1 }], duration.fast],
        code: [
          [
            { opacity: 0.4, letterSpacing: ".3em" },
            { opacity: 1, letterSpacing: ".1em" },
          ],
          timing.code,
        ],
        pulse: [
          [
            { transform: "scale(1)" },
            { transform: "scale(1.06)" },
            { transform: "scale(1)" },
          ],
          duration.slow,
        ],
        hero: [
          [{ transform: "scale(1.025)" }, { transform: "scale(1)" }],
          timing.hero,
        ],
      };
      const [frames, seconds] = specs[preset];
      const animation = el.animate(frames, {
        duration: ms(seconds),
        delay: ms(delay),
        easing: ease("enter"),
        fill: "backwards",
      });
      return () => animation.cancel();
    },
    [preset, delay],
  );
  useVisualEffect(ref, animate);
  const Component = as;
  return (
    <Component {...props} ref={ref}>
      {children}
    </Component>
  );
}

/** CSS loops run only for visible elements in a visible, motion-enabled document. */
export function Ambient({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => {
      el.dataset.inview = String(entry.isIntersecting);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <span ref={ref} className={`ambient ${className}`}>
      {children}
    </span>
  );
}
export function MotionRoot({ children }: { children: ReactNode }) {
  useEffect(() => {
    const preference = matchMedia(reduceQuery);
    const update = () => {
      document.documentElement.dataset.motion = String(
        !preference.matches && document.visibilityState === "visible",
      );
    };
    update();
    preference.addEventListener("change", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      preference.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", update);
      delete document.documentElement.dataset.motion;
    };
  }, []);
  return children;
}
