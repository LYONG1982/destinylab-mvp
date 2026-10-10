import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  createHeartGeometry,
  heartState,
} from "@/features/screen/world/pair-heart";
import {
  HEART_OUTLINE,
  HEART_SVG_PATH,
} from "@/features/screen/world/pair-heart-shape";
import { PairConnection } from "@/features/screen/world/PairConnection";
import { PairSceneController } from "@/features/screen/world/pair-controller";
import { WorldMockSource } from "@/features/screen/world/mock";
import {
  PAIR_HEART,
  PAIR_TIMING,
  pairLayout,
} from "@/features/screen/world/pair-config";
import type { PairSceneFrame, WorldFrame } from "@/features/screen/world/types";
const world: WorldFrame = {
  mode: "MEET",
  modeElapsedMs: 0,
  remainingMs: 18000,
  intersection: null,
};
const source = () => new WorldMockSource().getSnapshot().meetScene!;
function scene(count = 3) {
  const director = new PairSceneController(),
    data = source();
  director.update({
    ...data,
    qualifiedPairs: data.qualifiedPairs.slice(0, count),
  });
  director.advance(0, world, true);
  return director;
}
function at(
  director: PairSceneController,
  age: number,
  count = 3,
): PairSceneFrame {
  const frame = director.frame();
  return {
    ...frame,
    layoutCount: count,
    slots: frame.slots.map((s) => ({
      ...s,
      elapsedMs: 1700 + age,
      opacity: 1,
      layout: pairLayout(count, s.slot),
    })),
  };
}

test("heart volume is centered, closed, outward wound, finite and nondegenerate", () => {
  const g = createHeartGeometry(),
    p = g.getAttribute("position"),
    normal = g.getAttribute("normal"),
    index = g.index!;
  assert.ok(p.count <= 1690);
  const box = g.boundingBox!,
    size = box.getSize(new THREE.Vector3()),
    center = box.getCenter(new THREE.Vector3());
  assert.ok(Math.abs(size.x - 1) < 1e-6 && Math.abs(size.y - 0.904) < 0.003);
  assert.ok(center.length() < 1e-6 && size.z > 0.4 && size.z < 0.5);
  for (let i = 0; i < p.count; i++) {
    assert.ok(
      [
        p.getX(i),
        p.getY(i),
        p.getZ(i),
        normal.getX(i),
        normal.getY(i),
        normal.getZ(i),
      ].every(Number.isFinite),
    );
    assert.ok(
      Math.abs(
        new THREE.Vector3().fromBufferAttribute(normal, i).length() - 1,
      ) < 1e-5,
    );
  }
  const edges = new Map<string, { count: number; orientation: number }>();
  let volume = 0;
  for (let i = 0; i < index.count; i += 3) {
    const ids = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    const [a, b, c] = ids.map((id) =>
      new THREE.Vector3().fromBufferAttribute(p, id),
    );
    assert.ok(
      new THREE.Vector3()
        .subVectors(b, a)
        .cross(new THREE.Vector3().subVectors(c, a))
        .length() > 1e-8,
    );
    volume += a.dot(new THREE.Vector3().crossVectors(b, c)) / 6;
    for (let e = 0; e < 3; e++) {
      const u = ids[e],
        v = ids[(e + 1) % 3],
        key = [u, v].sort((x, y) => x - y).join(":"),
        old = edges.get(key) || { count: 0, orientation: 0 };
      old.count++;
      old.orientation += u < v ? 1 : -1;
      edges.set(key, old);
    }
  }
  assert.ok(volume > 0);
  for (const edge of edges.values())
    assert.deepEqual(edge, { count: 2, orientation: 0 });
  // Two lobes above the center notch, with a unique pointed bottom; fallback keeps the same outline.
  assert.ok(
    Math.max(...HEART_OUTLINE.map((p) => p.y)) - HEART_OUTLINE[0].y > 0.17,
  );
  assert.ok(Math.abs(HEART_OUTLINE[32].x) < 1e-12);
  assert.ok(HEART_SVG_PATH.endsWith(" Z"));
  g.dispose();
});

test("heart has one bounded beat, continuous fade and no overlapping stagger windows", () => {
  const out = { alpha: 0, scale: 1, presence: 0 };
  let previous = 0;
  for (let age = -1; age <= 1401; age++) {
    assert.strictEqual(heartState(age, false, out), out);
    assert.ok(
      out.alpha >= 0 &&
        out.alpha <= 1 &&
        out.scale >= 0.78 &&
        out.scale <= 1.04,
    );
    assert.ok(Math.abs(out.alpha - previous) < 0.009);
    previous = out.alpha;
  }
  assert.equal(heartState(350, false, out).scale, 1.04);
  assert.equal(heartState(1100, false, out).alpha, 0);
  assert.equal(heartState(1400, false, out).presence, 0);
  assert.ok(PAIR_HEART.durationMs < PAIR_TIMING.stagger);
  const staticFrame = { ...heartState(0, true, out) };
  assert.deepEqual(heartState(20000, true, out), staticFrame);
});

test("pooled heart and sparks survive replay and interruption; removed slots cannot retain a heart", () => {
  const renderer = new PairConnection(),
    director = scene();
  const heart = renderer.group.getObjectByName(
    "pair-heart",
  ) as THREE.InstancedMesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  const pointPools = renderer.group.children.filter(
    (o): o is THREE.Points => o instanceof THREE.Points,
  );
  const sparks = pointPools.find(
    (o) => o.geometry.getAttribute("position").count === 16,
  )!;
  const original = [
    heart.geometry,
    heart.material,
    heart.instanceMatrix,
    ...pointPools.map((o) => o.geometry),
  ];
  for (const count of [1, 2, 3])
    for (const age of [0, 200, 500, 900, 1399, 1400]) {
      const frame = at(scene(count), age, count);
      renderer.draw(frame, false, false, "HIGH");
      assert.ok(renderer.visibleParticles <= 208);
      const expected = age >= 500 && age < 1400 ? 16 : 0;
      assert.equal(sparks.geometry.drawRange.count, expected);
      if (expected)
        for (let i = 0; i < 16; i++) {
          const pos = sparks.geometry.getAttribute("position"),
            radius = sparks.geometry.getAttribute("radius").getX(i) / 2;
          const l = frame.slots[0].layout;
          assert.ok(
            Math.hypot(pos.getX(i) - l.centerX, 1080 - pos.getY(i) - l.meetY) +
              radius <=
              (count === 1 ? 88 : 80) / 2 + 0.001,
          );
        }
    }
  renderer.draw(at(director, 350), false, false);
  assert.equal(heart.visible, true);
  renderer.draw(at(director, 350), false, true);
  assert.equal(renderer.group.visible, false);
  renderer.draw(at(director, 350), false, false);
  assert.equal(renderer.group.visible, true);
  const single = at(scene(1), 350, 1);
  renderer.draw(single, true, false);
  const alphas = heart.geometry.getAttribute("heartAlpha");
  assert.ok(alphas.getX(0) > 0);
  assert.equal(alphas.getX(1), 0);
  assert.equal(alphas.getX(2), 0);
  assert.equal(sparks.geometry.drawRange.count, 0);
  renderer.draw({ ...single, slots: [] }, false, false);
  assert.equal(renderer.group.visible, false);
  assert.deepEqual(
    [
      heart.geometry,
      heart.material,
      heart.instanceMatrix,
      ...pointPools.map((o) => o.geometry),
    ],
    original,
  );
  renderer.group.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.Points) {
      o.geometry.dispose();
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
      else o.material.dispose();
      if (o instanceof THREE.InstancedMesh) o.dispose();
    }
  });
});

test("debug collision waits for the whole afterglow; global events freeze and permissions remove it", () => {
  const c = scene(1);
  c.advance(2200, world, true);
  const before = c.frame();
  c.command("collision");
  assert.equal(c.frame().slots[0].elapsedMs, before.slots[0].elapsedMs);
  c.advance(899, world, true);
  c.command("collision");
  assert.equal(c.frame().slots[0].elapsedMs, 3099);
  c.advance(1, world, true);
  c.command("collision");
  assert.equal(c.frame().slots[0].elapsedMs, 1700);
  c.advance(
    600,
    { ...world, intersection: { id: "pause", elapsedMs: 600, count: 1 } },
    true,
  );
  assert.equal(c.frame().slots[0].elapsedMs, 1700);
  c.advance(200, world, true);
  assert.equal(c.frame().slots[0].elapsedMs, 1900);
  c.update({ ...source(), permissionVerified: false });
  assert.equal(c.frame().slots.length, 0);
});
