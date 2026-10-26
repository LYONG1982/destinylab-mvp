import type { PairLayout } from "./types";
export const PAIR_TIMING = {
  stagger: 2000,
  enter: 700,
  collision: 1700,
  hold: 2000,
  firstReplacement: 9000,
  stableMinimum: 3000,
  exit: 450,
  replacementInterval: 6500,
  remainingRequired: 6500,
  handoff: 1200,
  priorityLimit: 32,
  seenLimit: 512,
} as const;
// Sizes use the 1920×1080 design space; the renderer scales them for the viewport.
export const PAIR_EFFECT = {
  tailLength: 0.6,
  movingTailScale: 1.5,
  headScale: 1.35,
  compactArc: 32,
  settleMs: 600,
  sparkDurationMs: 900,
  sparkHoldMs: 150,
  sparkMinSize: 5,
  sparkSizeStep: 1.5,
  sparkPeak: 0.85,
} as const;

export const PAIR_HEART = {
  width: 64,
  singleWidth: 72,
  footprint: 80,
  singleFootprint: 88,
  appearMs: 200,
  sparkStartMs: 500,
  fadeEndMs: 1100,
  durationMs: 1400,
  beatScale: 1.04,
} as const;

export function pairLayout(count: number, slot: number): PairLayout {
  const n = Math.max(1, Math.min(3, count));
  return {
    centerX:
      n === 1 ? 940 : n === 2 ? [520, 1400][slot] : [336, 960, 1584][slot],
    centerY: 420,
    spread: n === 1 ? 320 : n === 2 ? 180 : 166,
    avatarSize: n === 1 ? 176 : n === 2 ? 168 : 152,
    nameSize: n === 1 ? 34 : n === 2 ? 32 : 30,
    nameWidth: n === 1 ? 236 : 190,
    meetY: n === 1 ? 646 : 464,
  };
}
