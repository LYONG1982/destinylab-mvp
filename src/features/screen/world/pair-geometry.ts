import { PAIR_EFFECT } from "./pair-config";
import type { PairLayout } from "./types";
export type PairPoint = { x: number; y: number };
export const MEET_POINT = { x: 940, y: 646 };
// Five fixed curve families. Seeds choose a family, never an uncontrolled path.
const curves = [
  [
    [824, 400, 842, 725],
    [1085, 470, 1032, 710],
  ],
  [
    [780, 345, 892, 402],
    [1100, 346, 994, 460],
  ],
  [
    [775, 500, 837, 604],
    [1125, 490, 1025, 600],
  ],
  [
    [790, 640, 848, 700],
    [1085, 610, 1020, 705],
  ],
  [
    [885, 396, 770, 675],
    [1008, 400, 1140, 642],
  ],
] as const;
export function pairPoint(
  pattern: number,
  side: number,
  t: number,
  out: PairPoint,
  layout?: PairLayout,
): PairPoint {
  const [ax, ay, bx, by] = curves[Math.abs(pattern) % 5][side ? 1 : 0];
  const u = 1 - t,
    x0 = side ? 1170 : 710,
    y0 = 442;
  out.x =
    u * u * u * x0 +
    3 * u * u * t * ax +
    3 * u * t * t * bx +
    t * t * t * MEET_POINT.x;
  out.y =
    u * u * u * y0 +
    3 * u * u * t * ay +
    3 * u * t * t * by +
    t * t * t * MEET_POINT.y;
  if (layout) {
    const bridge = layout.spread - layout.avatarSize / 2 - 8;
    out.x = layout.centerX + ((out.x - MEET_POINT.x) * bridge) / 230;
    out.y =
      layout.centerY +
      22 +
      ((out.y - 442) * (layout.meetY - layout.centerY - 22)) / 204;
    // Compact groups retain distinct curved approaches instead of flattening into a dotted straight line.
    if (layout.spread < 300)
      out.y += Math.sin(Math.PI * t) * PAIR_EFFECT.compactArc * (side ? -1 : 1);
  }
  return out;
}

export function pairPath(pattern: number, side: number, layout: PairLayout) {
  const p = { x: 0, y: 0 };
  return Array.from({ length: 25 }, (_, i) => {
    pairPoint(pattern, side, i / 24, p, layout);
    return `${i ? "L" : "M"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
  }).join(" ");
}
