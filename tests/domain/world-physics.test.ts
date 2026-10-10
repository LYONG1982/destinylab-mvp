import test from "node:test";
import assert from "node:assert/strict";
import { constrainBody, fieldTarget, flowNoise, freeTarget, neutralTarget, QR_SAFE_RECT, safeRects, settleBodies, stepBodies, type PhysicsBody } from "@/features/screen/world/world-physics";

function body(seed: number, x = 800, y = 750): PhysicsBody {
  return { id: `visual-${seed}`, seed, x, y, vx: 0, vy: 0, targetX: x + 100, targetY: y - 35, radius: 28 };
}
function outsideQr(value: PhysicsBody) {
  return value.x + value.radius + 13 <= QR_SAFE_RECT.left || value.y + value.radius + 32 <= QR_SAFE_RECT.top;
}

test("forces remain deterministic while individuals have different inertial motion", () => {
  const a = [body(10), body(31, 350, 750)], b = structuredClone(a);
  for (let frame = 0; frame < 600; frame++) {
    stepBodies(a, frame / 60, 1 / 60, 0);
    stepBodies(b, frame / 60, 1 / 60, 0);
  }
  assert.deepEqual(a, b);
  assert.notEqual(a[0].vx, a[1].vx);
  assert.equal(flowNoise(7, 12), flowNoise(7, 12));
  assert.notEqual(flowNoise(7, 12), flowNoise(8, 12));
  assert.ok(a.every((p) => Math.hypot(p.vx, p.vy) <= 46));
});

test("every player avoids QR and type even after an oversized frame delta", () => {
  const people = Array.from({ length: 60 }, (_, i) => body(i, 1800 - i, 970));
  for (let frame = 0; frame < 160; frame++) stepBodies(people, frame, frame === 10 ? 60 : 1 / 30, 0);
  assert.ok(people.every(outsideQr));
  assert.ok(people.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
  const centre = body(82, 960, 500);
  constrainBody(centre, safeRects(0));
  assert.ok(centre.x <= 713 || centre.x >= 1207 || centre.y <= 261 || centre.y >= 745);
});

test("repulsion separates identical positions and respects the nickname footprint", () => {
  const people = [body(1, 290, 750), body(2, 290, 750), body(3, 290, 750)];
  people.forEach((p) => { p.targetX = 290; p.targetY = 750; });
  for (let frame = 0; frame < 600; frame++) stepBodies(people, frame / 60, 1 / 60, 0);
  for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) {
    const distance = Math.hypot(people[i].x - people[j].x, (people[i].y - people[j].y) * .8);
    assert.ok(distance > 65, `readable separation ${distance}`);
  }
});

test("mode force changes preserve existing bodies and finite velocities", () => {
  const people = Array.from({ length: 45 }, (_, i) => {
    const start = fieldTarget(i % 3, Math.floor(i / 3), 15, i);
    return body(i, start.x, start.y);
  });
  const objects = [...people];
  let biggestStep = 0;
  for (let frame = 0; frame < 600; frame++) {
    const choice = Math.exp(-frame / 90);
    const before = people.map((p) => [p.x, p.y]);
    for (const p of people) { const target = freeTarget(p.seed); p.targetX = target.x; p.targetY = target.y; }
    stepBodies(people, frame / 60, 1 / 60, choice);
    if (frame > 2) people.forEach((p, i) => { biggestStep = Math.max(biggestStep, Math.hypot(p.x - before[i][0], p.y - before[i][1])); });
  }
  people.forEach((p, i) => assert.equal(p, objects[i]));
  assert.ok(biggestStep < 30, `mode continuity max ${biggestStep}px`);
  assert.ok(people.every(outsideQr));
});

test("reduced motion has no drift after the one-time safe layout settles", () => {
  const p = body(12, 280, 760);
  p.targetX = 330;
  const start = { x: p.x, y: p.y };
  for (let frame = 0; frame < 300; frame++) stepBodies([p], frame / 60, 1 / 60, 0, true);
  assert.deepEqual({ x: p.x, y: p.y }, start);
});

test("free-space resting locations avoid the permanent HUD and central type", () => {
  for (let seed = 0; seed < 1000; seed++) {
    const point = freeTarget(seed);
    const p = body(seed, point.x, point.y);
    const before = { x: p.x, y: p.y };
    constrainBody(p, safeRects(0));
    assert.deepEqual({ x: p.x, y: p.y }, before);
  }
});

test("unanswered arrival anchors remain neutral and outside all choice centres", () => {
  for (let count = 1; count <= 60; count++) for (let slot = 0; slot < count; slot++) {
    const point = neutralTarget(slot + 22, slot, count);
    const p = body(slot + 22, point.x, point.y);
    constrainBody(p, safeRects(1));
    assert.ok(outsideQr(p));
    for (const x of [384, 960, 1517]) assert.ok(Math.hypot((p.x - x) / 1.1, p.y - 518) >= 254, "neutral arrivals must not appear inside an answer field");
  }
});

test("reduced-motion changes use the new field without stale membership or overlap", () => {
  const people = Array.from({ length: 12 }, (_, i) => {
    const target = fieldTarget(0, i, 12, i);
    const p = body(i, target.x, target.y);
    p.targetX = target.x; p.targetY = target.y;
    return p;
  });
  const original = people[0];
  settleBodies(people, 1);
  const changed = fieldTarget(2, 0, 1, people[0].seed);
  people[0].targetX = changed.x; people[0].targetY = changed.y;
  settleBodies(people, 1);
  assert.equal(people[0], original);
  assert.ok(people[0].x > 1250, "the same player now occupies the new field");
  assert.equal(people[0].vx, 0);
  for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) {
    assert.ok(Math.hypot(people[i].x - people[j].x, (people[i].y - people[j].y) * .8) > 65);
  }
});
