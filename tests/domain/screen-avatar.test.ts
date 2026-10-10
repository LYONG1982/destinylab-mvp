import test from "node:test";
import assert from "node:assert/strict";
import { createSeed, SCENARIOS } from "@/data/seed";
import { applyCommand } from "@/domain/commands";
import { recommendations, screenProjection } from "@/domain/selectors";
import {
  femaleAvatars,
  maleAvatars,
  getAvatarById,
  validAvatar,
  withCompatibleAvatar,
} from "@/config/avatars";
import { ScreenAdapter, displayNode } from "@/components/motion/screen/model";
import { MotionController } from "@/components/motion/screen/controller";
import { reconcile, step, density } from "@/components/motion/screen/physics";
import type { Command, DemoState, Participant } from "@/domain/types";
const run = (s: DemoState, command: Command, actor = "p-shanfeng") =>
  applyCommand(
    s,
    { actor, command, epoch: s.epoch, id: crypto.randomUUID() },
    s.now,
  );

test("catalogue uses twenty unique local IDs; completed fixtures are valid and fresh profile is unselected", () => {
  assert.equal(
    new Set([...maleAvatars, ...femaleAvatars].map((a) => a.id)).size,
    20,
  );
  assert.equal(getAvatarById("https://example.com/photo.png"), undefined);
  for (const [scenario] of SCENARIOS)
    for (const p of createSeed(scenario).participants)
      assert.equal(
        p.profileComplete
          ? validAvatar(p.avatarId, p.gender)
          : p.avatarId === null,
        true,
      );
});
test("profile rejects missing, unknown and opposite gender avatars; selected avatar persists without changing recommendation ranks", () => {
  const s = createSeed("discover");
  const profile = {
    type: "profile",
    name: "山风",
    gender: "male",
    age: "26–29",
    ready: true,
  } as const;
  for (const avatarId of [null, "female_01", "male_99"])
    assert.throws(() => run(s, { ...profile, avatarId }), /头像/);
  const result = run(s, { ...profile, avatarId: "male_08" });
  assert.equal(result.participants[0].avatarId, "male_08");
  assert.deepEqual(
    recommendations(result, "p-shanfeng"),
    recommendations(s, "p-shanfeng"),
  );
  assert.deepEqual(result.invitations, s.invitations);
});
test("legacy normalization is deterministic, leaves explicit null alone and preserves business fields", () => {
  const original = createSeed("confirmed").participants[0];
  const legacy = { ...original } as Partial<Participant>;
  delete legacy.avatarId;
  const normalized = withCompatibleAvatar(legacy as Participant);
  assert.equal(normalized.avatarId, "male_03");
  assert.deepEqual(
    { ...normalized, avatarId: undefined },
    { ...legacy, avatarId: undefined },
  );
  assert.deepEqual(normalized, withCompatibleAvatar(legacy as Participant));
  assert.equal(
    withCompatibleAvatar({ ...original, avatarId: null }).avatarId,
    null,
  );
  assert.equal(
    withCompatibleAvatar({ ...original, avatarId: "female_05" }).avatarId,
    null,
  );
  assert.equal(
    withCompatibleAvatar({ ...legacy, profileComplete: false } as Participant)
      .avatarId,
    null,
  );
});
test("display adapter exposes approved nickname and selected avatar, never raw identity or pair details", () => {
  const s = createSeed("discover");
  const adapter = new ScreenAdapter();
  const snapshot = adapter.read(s);
  assert.equal(snapshot.events.length, 0);
  assert.equal(snapshot.nodes[0].image, getAvatarById("male_03")!.src);
  assert.equal(snapshot.nodes[0].label, "山风");
  assert.equal(snapshot.nodes[0].displayMode, "PUBLIC");
  const json = JSON.stringify(snapshot);
  for (const forbidden of [
    "p-shanfeng",
    "p-xiaoman",
    "4721",
    "Meet01",
    "currentId",
  ])
    assert.ok(!json.includes(forbidden));
  assert.equal(
    displayNode("n1", {
      mode: "PUBLIC",
      name: "保密昵称",
      displayGranted: false,
    }).label,
    "探索者 001",
  );
  assert.equal(
    displayNode("n1", { mode: "LIGHT", name: "虚构小雨", displayGranted: true })
      .label,
    "虚*",
  );
  assert.equal(adapter.read(s), snapshot);
});
test("first profile emits one birth without falsely incrementing attendance, repeated edit does not emit birth", () => {
  const adapter = new ScreenAdapter();
  const s = createSeed("fresh");
  adapter.read(s);
  const profile = {
    type: "profile",
    name: "山风",
    gender: "male",
    age: "26–29",
    ready: false,
    avatarId: "male_04",
  } as const;
  const next = run(s, profile);
  const snapshot = adapter.read(next);
  assert.equal(snapshot.events.filter((e) => e.type === "JOIN").length, 1);
  assert.equal(snapshot.projection.active, screenProjection(s).active);
  assert.equal(
    adapter.read(run(next, profile)).events.filter((e) => e.type === "JOIN")
      .length,
    0,
  );
});
test("answers update only changed statistic; a single mutual invitation cannot produce a MATCH cue", () => {
  const adapter = new ScreenAdapter();
  let s = createSeed("fresh");
  adapter.read(s);
  s = run(s, { type: "answer", questionId: "q1", value: "认真认识" });
  assert.deepEqual(
    adapter
      .read(s)
      .events.filter((e) => e.type === "ANSWER")
      .map((e) => e.option),
    [2],
  );
  s = createSeed("waiting", s.epoch);
  adapter.read(s);
  const next = run(
    s,
    { type: "accept", invitationId: s.participants[0].currentId! },
    "p-xiaoman",
  );
  const snapshot = adapter.read(next);
  assert.equal(
    snapshot.events.some((e) => e.type === "MATCH"),
    false,
  );
  assert.equal(snapshot.projection.real, 28);
});
test("aggregate consume and confirmed encounter use separate MATCH semantics, neither event writes counts", () => {
  const adapter = new ScreenAdapter();
  let s = createSeed("broadcast");
  adapter.read(s);
  s = run(s, { type: "broadcast-consume" }, "operator");
  assert.equal(
    adapter.read(s).events.find((e) => e.type === "MATCH")?.phase,
    "mutual",
  );
  const original = createSeed("one-confirm");
  adapter.read(original);
  const i = original.invitations.find(
    (i) => i.id === original.participants[0].currentId,
  )!;
  const missing = [i.from, i.to].find((id) => !i.confirmations[id])!;
  const next = run(original, { type: "confirm", invitationId: i.id }, missing);
  const snapshot = adapter.read(next);
  assert.equal(snapshot.projection.real, 29);
  assert.equal(
    snapshot.events.find((e) => e.type === "MATCH")?.phase,
    "confirmed",
  );
});
test("event controller bounds, coalesces, deduplicates, rejects unfiltered MATCH and clears expired effects", () => {
  const c = new MotionController();
  const event = {
    type: "JOIN",
    id: "once",
    node: "n1",
    timestamp: Date.now(),
  } as const;
  c.receive(event, 0);
  c.receive(event, 0);
  assert.equal(c.effects.length, 1);
  for (let i = 0; i < 500; i++)
    c.receive(
      { type: "ANSWER", id: `a${i}`, option: i % 3, timestamp: Date.now() },
      0,
    );
  assert.ok(c.effects.length <= 8);
  c.receive({ type: "MATCH", id: "unsafe", timestamp: Date.now() }, 0);
  assert.equal(
    c.effects.some((e) => e.id === "unsafe"),
    false,
  );
  c.prune(4000);
  assert.equal(c.effects.length, 0);
  c.dispose();
});
test("1/20/50/100/200 person layouts bound physics, preserve real cluster counts and stay within obstacles", () => {
  const area = { x: 1040, y: 220, width: 300, height: 580 };
  for (const count of [1, 20, 50, 100, 200]) {
    const nodes = Array.from({ length: count }, (_, i) =>
      displayNode(`n${i + 1}`),
    );
    const layout = reconcile([], nodes, area, 1, 0);
    assert.equal(layout.bodies.length + layout.clustered, count);
    assert.ok(layout.bodies.length <= 32);
    assert.ok(density(count, area, 1).capacity <= 32);
    for (let t = 0; t < 600; t++) step(layout.bodies, area, 1 / 30, t * 33, 1);
    for (const body of layout.bodies) {
      assert.ok(Number.isFinite(body.x + body.y));
      assert.ok(
        body.x - body.radius >= area.x &&
          body.x + body.radius <= area.x + area.width,
      );
      assert.ok(
        body.y - body.radius >= area.y &&
          body.y + body.radius <= area.y + area.height,
      );
    }
  }
});
