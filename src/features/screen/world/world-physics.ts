import { FIELD_ANCHORS, WORLD_HEIGHT, WORLD_WIDTH } from "./world-tokens";

export interface PhysicsBody {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  targetX: number;
  targetY: number;
  seed: number;
  radius: number;
}
export interface SafeRect { left: number; top: number; right: number; bottom: number }
const titleRect: SafeRect = { left: 200, top: 0, right: 1720, bottom: 211 };
const totalRect: SafeRect = { left: 590, top: 897, right: 1340, bottom: 1080 };
const choiceRects = FIELD_ANCHORS.map((p) => ({ left: p.x - 112, right: p.x + 112, top: p.y - 112, bottom: p.y + 112 }));
export function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }
export function seedUnit(seed: number, salt = 0) {
  const v = Math.sin((seed + 1) * 127.1 + salt * 311.7) * 43758.5453;
  return v - Math.floor(v);
}
/** Smooth deterministic noise: no per-frame random input or shared circular orbit. */
export function flowNoise(seed: number, seconds: number, axis = 0) {
  const phase = seedUnit(seed, axis + 7) * Math.PI * 2;
  return Math.sin(seconds * (0.17 + seedUnit(seed, axis + 1) * 0.12) + phase) * 0.64 +
    Math.sin(seconds * (0.31 + seedUnit(seed, axis + 3) * 0.08) - phase * 1.7) * 0.36;
}
export function fieldTarget(fieldIndex: number, ordinal: number, count: number, seed: number) {
  const anchor = FIELD_ANCHORS[fieldIndex % 3];
  // Two uneven annuli leave the type at the centre readable; these are resting
  // locations, not orbital motion. Forces and individual noise determine travel.
  const innerCount = Math.min(9, Math.ceil(count * 0.43));
  const outer = ordinal >= innerCount;
  const n = outer ? Math.max(1, count - innerCount) : Math.max(1, innerCount);
  const index = outer ? ordinal - innerCount : ordinal;
  const angle = (index / n) * Math.PI * 2 - Math.PI / 2 + (outer ? 0.14 : -0.1);
  const radius = (outer ? 241 : 166) + (seedUnit(seed, 2) - 0.5) * 13;
  return { x: anchor.x + Math.cos(angle) * radius, y: anchor.y + Math.sin(angle) * radius * 1.08 };
}
/** Unanswered people have a neutral arrival shelf below the three fields.
 * They acquire a field target only after an actual answer exists. */
export function neutralTarget(seed: number, ordinal = 0, count = 1) {
  const columns = Math.min(14, Math.max(1, count));
  const row = Math.floor(ordinal / columns);
  const column = ordinal % columns;
  if (row === 0) return { x: 105 + ((column + .5) / columns) * 1380, y: 825 + (seedUnit(seed, 73) - .5) * 9 };
  // Extra unanswered arrivals use the outside edge, not a choice's centre.
  const side = row % 2 === 1 ? 74 : 1840;
  return { x: side, y: 278 + (column / Math.max(1, columns - 1)) * (side > 1600 ? 305 : 495) };
}
export function freeTarget(seed: number) {
  const rects = safeRects(0);
  for (let attempt = 0; attempt < 48; attempt++) {
    const x = 100 + seedUnit(seed, 33 + attempt * 2) * 1710;
    const y = 255 + seedUnit(seed, 42 + attempt * 2) * 625;
    if (rects.every((rect) => x < rect.left - 60 || x > rect.right + 60 || y < rect.top - 75 || y > rect.bottom + 60)) return { x, y };
  }
  return { x: 160 + seedUnit(seed, 79) * 250, y: 730 };
}
export function safeRects(choiceWeight: number): readonly SafeRect[] {
  const weight = clamp(choiceWeight, 0, 1);
  const rects: SafeRect[] = [titleRect, totalRect];
  if (weight > .02) for (const rect of choiceRects) {
    const cx = (rect.left + rect.right) / 2, cy = (rect.top + rect.bottom) / 2;
    rects.push({ left: cx - 112 * weight, right: cx + 112 * weight, top: cy - 112 * weight, bottom: cy + 112 * weight });
  }
  if (weight < .98) {
    const amount = 1 - weight;
    rects.push({ left: 960 - 206 * amount, right: 960 + 206 * amount, top: 515 - 194 * amount, bottom: 515 + 194 * amount });
  }
  return rects;
}
/** A hard final projection keeps players clear of the title, statistics and type. */
export function constrainBody(body: PhysicsBody, rects: readonly SafeRect[]) {
  const padX = Math.max(36, body.radius + 13);
  const padTop = body.radius + 8;
  const padBottom = body.radius + 32;
  body.x = clamp(body.x, padX + 18, WORLD_WIDTH - padX - 18);
  body.y = clamp(body.y, padTop + 22, WORLD_HEIGHT - padBottom - 28);
  for (const rect of rects) {
    const left = rect.left - padX;
    const right = rect.right + padX;
    const top = rect.top - padBottom;
    const bottom = rect.bottom + padTop;
    if (body.x <= left || body.x >= right || body.y <= top || body.y >= bottom) continue;
    const distances = [left >= padX + 18 ? body.x - left : Infinity, right <= WORLD_WIDTH - padX - 18 ? right - body.x : Infinity, top >= padTop + 22 ? body.y - top : Infinity, bottom <= WORLD_HEIGHT - padBottom - 28 ? bottom - body.y : Infinity];
    const smallest = Math.min(...distances);
    if (smallest === distances[0]) { body.x = left; body.vx = Math.min(0, body.vx); }
    else if (smallest === distances[1]) { body.x = right; body.vx = Math.max(0, body.vx); }
    else if (smallest === distances[2]) { body.y = top; body.vy = Math.min(0, body.vy); }
    else { body.y = bottom; body.vy = Math.max(0, body.vy); }
  }
}
export function stepBodies(bodies: PhysicsBody[], elapsedSeconds: number, deltaSeconds: number, choiceWeight: number, quiet = false) {
  const dt = clamp(deltaSeconds, 0, 0.04);
  const rects = safeRects(choiceWeight);
  for (const body of bodies) {
    if (!quiet) {
      const speed = 0.85 + seedUnit(body.seed, 5) * 0.5;
      const ax = (body.targetX - body.x) * 0.16 + flowNoise(body.seed, elapsedSeconds) * 10;
      const ay = (body.targetY - body.y) * 0.16 + flowNoise(body.seed, elapsedSeconds, 1) * 9;
      body.vx = (body.vx + ax * dt * speed) * Math.exp(-1.2 * dt);
      body.vy = (body.vy + ay * dt * speed) * Math.exp(-1.2 * dt);
      const length = Math.hypot(body.vx, body.vy);
      if (length > 46) { body.vx *= 46 / length; body.vy *= 46 / length; }
      body.x += body.vx * dt;
      body.y += body.vy * dt;
    }
    constrainBody(body, rects);
  }
  // Elliptical collision footprint reserves vertical nickname space. Two short
  // relaxation passes are bounded to 60 bodies and allocate no pair objects.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j];
        let dx = b.x - a.x;
        let dy = (b.y - a.y) * 0.8;
        let distance = Math.hypot(dx, dy);
        const minimum = a.radius + b.radius + 18;
        if (distance >= minimum) continue;
        if (distance < 0.01) {
          const angle = seedUnit(a.seed + b.seed, j) * Math.PI * 2;
          dx = Math.cos(angle); dy = Math.sin(angle); distance = 1;
        }
        const force = Math.min(8, (minimum - distance) * 0.26);
        const x = dx / distance * force;
        const y = dy / distance * force / 0.8;
        a.x -= x; a.y -= y; b.x += x; b.y += y;
        if (!quiet) { a.vx -= x * dt; a.vy -= y * dt; b.vx += x * dt; b.vy += y * dt; }
      }
    }
    for (const body of bodies) constrainBody(body, rects);
  }
}

/** One bounded static solve for reduced motion and fallback. Membership changes
 * must still reposition a person even when continuous attraction is disabled. */
export function settleBodies(bodies: PhysicsBody[], choiceWeight: number) {
  for (const body of bodies) {
    body.x = body.targetX; body.y = body.targetY;
    body.vx = 0; body.vy = 0;
  }
  for (let pass = 0; pass < 24; pass++) stepBodies(bodies, 0, 0, choiceWeight, true);
}
