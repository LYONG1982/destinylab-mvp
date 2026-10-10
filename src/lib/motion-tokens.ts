import type { CSSProperties } from "react";

/** Seconds. CSS and JS consume the same source, including semantic rhythms. */
export const motionDuration = {
  instant: 0.12,
  fast: 0.18,
  normal: 0.28,
  slow: 0.45,
  brand: 1.4,
} as const;
export const motionEase = {
  standard: [0.22, 1, 0.36, 1],
  enter: [0.16, 1, 0.3, 1],
  exit: [0.7, 0, 0.84, 0],
} as const;
export const motionTiming = {
  counter: 0.7,
  hero: 0.7,
  question: 0.24,
  avatar: 0.25,
  code: 0.3,
  signal: 0.4,
  titleGap: 0.1,
  cardGap: 0.07,
  answerGap: 0.12,
  presence: 5,
  ambient: 8,
  toast: 2,
  haptic: 0.03,
} as const;
export const ease = (name: keyof typeof motionEase = "standard") =>
  `cubic-bezier(${motionEase[name].join(",")})`;
export const ms = (seconds: number) => seconds * 1000;
export const motionCssVars = Object.fromEntries([
  ...Object.entries({ ...motionDuration, ...motionTiming }).map(
    ([key, value]) => [`--motion-${key}`, `${value}s`],
  ),
  ...Object.keys(motionEase).map((key) => [
    `--ease-${key}`,
    ease(key as keyof typeof motionEase),
  ]),
]) as CSSProperties;

/** Screen-only, bounded runtime parameters; no business counters live here. */
export const screenMotion = {
  particles: 30,
  particleLimit: 40,
  nodeLimit: 24,
  dpr: 1.5,
  fps: 60,
  fallbackFps: 30,
  dissolve: 0.8,
  birth: 1.5,
  match: 1.4,
  mutual: 3,
  feedback: 1.2,
  ring: 6,
  qrHalo: 7,
  background: 24,
} as const;
