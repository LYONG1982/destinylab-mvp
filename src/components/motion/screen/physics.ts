import type { DisplayNode, MotionState } from "./model";
import { screenMotion } from "@/lib/motion-tokens";
export type Rect = { x: number; y: number; width: number; height: number };
export type Body = {
  node: DisplayNode;
  x: number;
  y: number;
  vx: number;
  vy: number;
  tx: number;
  ty: number;
  radius: number;
  mass: number;
  activity: number;
  visibility: number;
  state: MotionState;
  phase: number;
  born: number;
  leaving?: number;
};
export const contains = (r: Rect, x: number, y: number, margin = 0) =>
  x >= r.x - margin &&
  x <= r.x + r.width + margin &&
  y >= r.y - margin &&
  y <= r.y + r.height + margin;
export function density(total: number, area: Rect, scale: number) {
  const diameter =
    (total <= 20 ? 50 : total <= 50 ? 42 : total <= 100 ? 34 : 27) * scale;
  const cell = Math.max(34 * scale, diameter + 48 * scale);
  const cols = Math.max(0, Math.floor(area.width / cell));
  const rows = Math.max(0, Math.floor(area.height / cell));
  return {
    diameter,
    cols,
    rows,
    capacity: Math.min(screenMotion.nodeLimit, Math.floor(cols * rows * 0.6)),
  };
}
/** Deterministic anchors plus weak springs, repulsion and damping; no random position jumps. */
export function reconcile(
  bodies: Body[],
  nodes: DisplayNode[],
  area: Rect,
  scale: number,
  now: number,
  priority: string[] = [],
) {
  const d = density(nodes.length, area, scale);
  const ordered = [...nodes].sort(
    (a, b) =>
      Number(priority.includes(b.key)) - Number(priority.includes(a.key)),
  );
  const selected = ordered
    .slice(0, d.capacity)
    .sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  const result: Body[] = [];
  selected.forEach((node, i) => {
    const angle = i * 2.39996323 - Math.PI / 2;
    const orbit =
      0.35 + 0.6 * Math.sqrt((i + 0.5) / Math.max(1, selected.length));
    const tx =
      area.x +
      area.width / 2 +
      Math.cos(angle) *
        Math.max(0, area.width / 2 - d.diameter / 2 - 12 * scale) *
        orbit;
    const ty =
      area.y +
      area.height / 2 +
      Math.sin(angle) *
        Math.max(0, area.height * 0.43 - d.diameter / 2) *
        orbit;
    const existing = bodies.find((b) => b.node.key === node.key);
    const body = existing || {
      node,
      x: tx,
      y: ty,
      vx: 0,
      vy: 0,
      tx,
      ty,
      radius: d.diameter / 2,
      mass: 1,
      activity: 0,
      visibility: 1,
      state: "idle" as MotionState,
      phase: (i * 2.39996) % (Math.PI * 2),
      born: now,
    };
    Object.assign(body, {
      node,
      tx,
      ty,
      radius: d.diameter / 2,
      leaving: undefined,
    });
    result.push(body);
  });
  const keys = new Set(selected.map((n) => n.key));
  // Reserve only spare capacity for departing nodes, never grow the physics pool.
  for (const body of bodies)
    if (
      !keys.has(body.node.key) &&
      result.length < screenMotion.nodeLimit &&
      now - (body.leaving ?? now) < 600
    ) {
      body.leaving ??= now;
      body.state = "leaving";
      result.push(body);
    }
  return {
    bodies: result,
    clustered: Math.max(0, nodes.length - selected.length),
  };
}
export function step(
  bodies: Body[],
  area: Rect,
  dt: number,
  time: number,
  scale: number,
) {
  const delta = Math.min(dt, 0.05);
  for (const b of bodies) {
    const sway = Math.sin(time / 8000 + b.phase) * 2 * scale;
    b.vx += (((b.tx + sway - b.x) * 0.8) / b.mass) * delta;
    b.vy +=
      (((b.ty + Math.cos(time / 11000 + b.phase) * 2 * scale - b.y) * 0.8) /
        b.mass) *
      delta;
    for (const other of bodies) {
      if (other === b) continue;
      const dx = b.x - other.x,
        dy = b.y - other.y;
      const distance = Math.max(0.1, Math.hypot(dx, dy));
      const gap = b.radius + other.radius + 8 * scale;
      if (distance < gap) {
        b.vx += (dx / distance) * (gap - distance) * delta;
        b.vy += (dy / distance) * (gap - distance) * delta;
      }
    }
    b.vx *= Math.exp(-3 * delta);
    b.vy *= Math.exp(-3 * delta);
    b.x = Math.max(
      area.x + b.radius,
      Math.min(area.x + area.width - b.radius, b.x + b.vx * delta),
    );
    b.y = Math.max(
      area.y + b.radius,
      Math.min(area.y + area.height - b.radius, b.y + b.vy * delta),
    );
  }
}
