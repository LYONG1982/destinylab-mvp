import test from "node:test";
import assert from "node:assert/strict";
import { createSeed } from "@/data/seed";
import { WorldAdapter } from "@/features/screen/world/adapter";
import { WorldMockSource } from "@/features/screen/world/mock";
import { PairSceneController } from "@/features/screen/world/pair-controller";
import {
  displayablePair,
  uniqueQualifiedPairs,
} from "@/features/screen/world/pair-adapter";
import { pairPoint, MEET_POINT } from "@/features/screen/world/pair-geometry";
import { pairLayout } from "@/features/screen/world/pair-config";
import { WorldClock } from "@/features/screen/world/state-machine";
import type { MeetPair, WorldFrame } from "@/features/screen/world/types";
const frame = (
  elapsed = 0,
  mode: WorldFrame["mode"] = "MEET",
  paused = false,
): WorldFrame => ({
  mode,
  modeElapsedMs: elapsed,
  remainingMs: 18000 - elapsed,
  intersection: paused ? { id: "i", elapsedMs: 1000, count: 1 } : null,
});
const fixtures = () => new WorldMockSource().getSnapshot().meetScene!;
function stateWithPair() {
  const state = createSeed("waiting"),
    inv = state.invitations.find((i) => i.from === "p-shanfeng")!;
  inv.realMeetAt = state.now;
  inv.acceptedAt = state.now - 1000;
  inv.status = "CONFIRMED";
  return { state, inv };
}
test("pair projection is absent by default, both grants required and read-only", () => {
  const { state, inv } = stateWithPair(),
    raw = JSON.stringify(state);
  assert.equal(
    new WorldAdapter().read(state).meetScene!.qualifiedPairs.length,
    0,
  );
  const provider = {
    revision: 0,
    allows: (_i: string, p: string) => p === inv.from,
  };
  assert.equal(
    new WorldAdapter(provider).read(state).meetScene!.qualifiedPairs.length,
    0,
  );
  const adapter = new WorldAdapter({ revision: 0, allows: () => true });
  const data = adapter.read(state);
  assert.ok(data.meetScene!.qualifiedPairs.length > 0);
  assert.equal(JSON.stringify(state), raw);
  const p = data.meetScene!.qualifiedPairs.find(
    (p) =>
      p.male.nickname ===
      state.participants.find((p) => p.id === inv.from)!.name,
  )!;
  assert.ok(p);
  assert.equal(p.status, "meet_confirmed");
  assert.equal(p.justConfirmed, false);
  for (const id of [inv.id, inv.from, inv.to])
    assert.equal(JSON.stringify(data.meetScene).includes(id), false);
});
test("grant revision revokes a pair on the identical business snapshot without affecting total", () => {
  const { state } = stateWithPair();
  let granted = true;
  const grants = { revision: 0, allows: () => granted };
  const adapter = new WorldAdapter(grants);
  const first = adapter.read(state);
  assert.ok(first.meetScene!.qualifiedPairs.length > 0);
  granted = false;
  grants.revision++;
  const removed = adapter.read(state);
  assert.deepEqual(removed.meetScene!.qualifiedPairs, []);
  assert.equal(first.totalMeetings, removed.totalMeetings);
  assert.strictEqual(adapter.read(state), removed);
});
test("provider errors, invalid avatars or missing profiles cannot disclose pairs", () => {
  const { state, inv } = stateWithPair();
  assert.deepEqual(
    new WorldAdapter({
      revision: 1,
      allows: () => {
        throw Error("offline");
      },
    }).read(state).meetScene!.qualifiedPairs,
    [],
  );
  state.invitations = [inv];
  state.participants.find((p) => p.id === inv.to)!.avatarId = null;
  assert.deepEqual(
    new WorldAdapter({ revision: 1, allows: () => true }).read(state).meetScene!
      .qualifiedPairs,
    [],
  );
});
test("accepted-only does not qualify; history and duplicate records do not replay a fresh connection", () => {
  const { state, inv } = stateWithPair();
  state.invitations = [inv];
  delete inv.realMeetAt;
  const adapter = new WorldAdapter({ revision: 0, allows: () => true });
  assert.deepEqual(adapter.read(state).meetScene!.qualifiedPairs, []);
  const next = structuredClone(state);
  next.revision++;
  next.invitations[0].realMeetAt = next.now;
  const p = adapter.read(next).meetScene!.qualifiedPairs[0];
  assert.equal(p.justConfirmed, true);
  const duplicated = structuredClone(next);
  duplicated.revision++;
  duplicated.invitations.push({
    ...duplicated.invitations[0],
    id: "duplicate",
  });
  assert.equal(adapter.read(duplicated).meetScene!.qualifiedPairs.length, 1);
  assert.equal(
    new WorldAdapter({ revision: 0, allows: () => true }).read(duplicated)
      .meetScene!.qualifiedPairs[0].justConfirmed,
    false,
  );
});
test("pair positions follow gender fields even when a woman initiates; completed users need not be available", () => {
  const { state, inv } = stateWithPair();
  state.invitations = [{ ...inv, from: inv.to, to: inv.from }];
  for (const p of state.participants) {
    p.ready = false;
    p.present = true;
  }
  const pair = new WorldAdapter({ revision: 1, allows: () => true }).read(state)
    .meetScene!.qualifiedPairs[0];
  assert.equal(pair.male.gender, "male");
  assert.equal(pair.female.gender, "female");
  assert.ok(displayablePair(pair));
  state.participants[0].present = false;
  assert.equal(
    new WorldAdapter({ revision: 2, allows: () => true }).read(state).meetScene!
      .qualifiedPairs.length,
    0,
  );
});
test("mock has ten explicit pairs; meeting creates fresh priority without a business store", () => {
  const source = new WorldMockSource();
  assert.equal(source.getSnapshot().meetScene!.qualifiedPairs.length, 10);
  assert.equal(source.getSnapshot().totalMeetings, 28);
  assert.ok(
    source.getSnapshot().meetScene!.qualifiedPairs.every(displayablePair),
  );
  source.meet();
  assert.equal(source.getSnapshot().totalMeetings, 29);
  assert.equal(source.getSnapshot().meetScene!.qualifiedPairs.length, 11);
  assert.equal(
    source
      .getSnapshot()
      .meetScene!.qualifiedPairs.filter((p) => p.justConfirmed).length,
    1,
  );
  source.revokePairs();
  assert.equal(source.getSnapshot().totalMeetings, 29);
  assert.deepEqual(source.getSnapshot().meetScene!.qualifiedPairs, []);
});
function advance(c: PairSceneController, until: number, start = 0) {
  let f = c.frame();
  for (let t = start; t < until; t += 50)
    f = c.advance(Math.min(50, until - t), frame(), true);
  return f;
}
test("zero, one, two, three and ten pairs produce at most three distinct pairs without recurring empty flashes", () => {
  for (const n of [0, 1, 2, 3, 10]) {
    const c = new PairSceneController();
    c.update({ qualifiedPairs: fixtures().qualifiedPairs.slice(0, n) });
    const first = c.advance(0, frame(), true);
    assert.equal(first.slots.length, Math.min(n, 3));
    const last = advance(c, 8000);
    assert.equal(last.slots.length, Math.min(n, 3));
    if (n <= 3)
      assert.deepEqual(
        last.slots.map((s) => s.pair.id),
        first.slots.map((s) => s.pair.id),
      );
  }
});
test("three slot choreography has one collision focus and preserves separate safe regions", () => {
  const c = new PairSceneController();
  c.update(fixtures());
  c.advance(0, frame(), true);
  const collisions = new Set<number>();
  for (let t = 0; t < 18000; t += 50) {
    const f = c.advance(50, frame(t), false);
    const ids = f.slots.flatMap((s) => [s.pair.male.id, s.pair.female.id]);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(f.slots.filter((s) => s.phase === "collision").length <= 1);
    f.slots
      .filter((s) => s.phase === "collision")
      .forEach((s) => collisions.add(s.slot));
    for (const s of f.slots)
      for (let side = 0; side < 2; side++)
        for (let j = 0; j <= 20; j++) {
          const p = pairPoint(
            s.pattern,
            side,
            j / 20,
            { x: 0, y: 0 },
            s.layout,
          );
          assert.ok(
            p.x > s.layout.centerX - 250 &&
              p.x < s.layout.centerX + 250 &&
              p.y < 620,
          );
        }
  }
  assert.equal(collisions.size, 3);
});
test("fresh pair replaces oldest slot only at the safe node, leaving other tokens and clocks unchanged", () => {
  const source = new WorldMockSource(),
    c = new PairSceneController();
  c.update(source.getSnapshot().meetScene);
  c.advance(0, frame(), true);
  const before = advance(c, 1750);
  source.meet();
  c.update(source.getSnapshot().meetScene);
  assert.deepEqual(
    c.frame().slots.map((s) => s.token),
    before.slots.map((s) => s.token),
  );
  const until = advance(c, 9000, 1750);
  assert.equal(until.slots.filter((s) => s.phase === "out").length, 1);
  const final = advance(c, 9500, 9000);
  assert.equal(
    final.slots[0].pair.id,
    source.getSnapshot().meetScene!.qualifiedPairs.at(-1)!.id,
  );
  assert.equal(final.slots[0].justConfirmed, true);
  for (const i of [1, 2]) {
    assert.equal(final.slots[i].token, before.slots[i].token);
    assert.equal(final.slots[i].elapsedMs - before.slots[i].elapsedMs, 7750);
  }
});
test("slot replacement cannot begin with insufficient mode remainder", () => {
  const c = new PairSceneController();
  c.update(fixtures());
  c.advance(0, frame(), false);
  c.advance(11550, frame(11550), false);
  assert.ok(c.frame().slots.every((s) => s.phase !== "out"));
});
test("fair bounded burst queue still visits historical pairs and deduplicates repeated snapshots", () => {
  const source = new WorldMockSource(),
    c = new PairSceneController();
  c.update(source.getSnapshot().meetScene);
  c.advance(0, frame(), true);
  source.meet(40);
  c.update(source.getSnapshot().meetScene);
  const q = c.queuedCount;
  c.update(source.getSnapshot().meetScene);
  assert.equal(c.queuedCount, q);
  assert.ok(q <= 103);
  const seen = new Set<string>();
  for (let t = 0; t < 220000; t += 100) {
    const f = c.advance(100, frame(), true);
    f.slots.forEach((s) => seen.add(s.pair.id));
    assert.ok(f.slots.filter((s) => s.phase === "collision").length <= 1);
  }
  for (let i = 0; i < 10; i++)
    assert.ok(seen.has(`mock-meet-${i}`), `starved historical pair ${i}`);
});
test("shared users never occupy two slots, including conflicting urgent arrivals", () => {
  const source = new WorldMockSource();
  source.pairCount(1);
  source.conflictPair();
  const c = new PairSceneController();
  c.update(source.getSnapshot().meetScene);
  const f = c.advance(0, frame(), true);
  assert.equal(f.slots.length, 1);
  for (let t = 0; t < 60000; t += 100) {
    const f = c.advance(100, frame(), true);
    const people = f.slots.flatMap((s) => [s.pair.male.id, s.pair.female.id]);
    assert.equal(new Set(people).size, people.length);
  }
});
test("global intersection freezes every slot clock and mode retains 12/8/18 durations", () => {
  const c = new PairSceneController();
  c.update(fixtures());
  c.advance(0, frame(), true);
  c.advance(1750, frame(), true);
  const before = c.frame();
  c.advance(6000, frame(0, "MEET", true), true);
  assert.deepEqual(c.frame(), before);
  const clock = new WorldClock();
  assert.equal(clock.tick(12000).mode, "LIVE");
  assert.equal(clock.tick(8000).mode, "MEET");
  assert.equal(clock.tick(9000).mode, "MEET");
  assert.equal(clock.tick(9000).mode, "CHOICE");
});
test("withdrawal, unknown grants and invalid profiles remove pairs immediately even during collision", () => {
  const source = new WorldMockSource(),
    c = new PairSceneController();
  c.update(source.getSnapshot().meetScene);
  c.advance(0, frame(), true);
  c.advance(1750, frame(), true);
  const revoked = c.frame().slots[0].pair.id;
  source.revokePair(revoked);
  c.update(source.getSnapshot().meetScene);
  assert.ok(c.frame().slots.every((s) => s.pair.id !== revoked));
  source.network(false);
  c.update(source.getSnapshot().meetScene);
  assert.equal(c.frame().slots.length, 0);
  source.network(true);
  c.update(source.getSnapshot().meetScene);
  advance(c, 15000);
  assert.ok(c.frame().slots.every((s) => !s.justConfirmed));
});
test("mutual to actual meeting preserves record identity but only actual meeting increments total", () => {
  const { state, inv } = stateWithPair();
  delete inv.realMeetAt;
  inv.status = "ACCEPTED";
  state.invitations = [inv];
  const a = new WorldAdapter({ revision: 0, allows: () => true });
  const first = a.read(state);
  const pair = first.meetScene!.qualifiedPairs[0];
  assert.equal(pair.status, "mutual_confirmed");
  const next = structuredClone(state);
  next.revision++;
  next.invitations[0].realMeetAt = state.now;
  next.invitations[0].status = "CONFIRMED";
  const second = a.read(next);
  assert.equal(second.meetScene!.qualifiedPairs[0].id, pair.id);
  assert.equal(second.meetScene!.qualifiedPairs[0].status, "meet_confirmed");
  assert.equal(second.totalMeetings, first.totalMeetings + 1);
  const cancelled = structuredClone(state);
  cancelled.revision++;
  cancelled.invitations[0].status = "CANCELLED";
  assert.deepEqual(a.read(cancelled).meetScene!.qualifiedPairs, []);
});
test("record dedupe prefers meeting status; all slot sizes and endpoint coordinates are deliberate", () => {
  const p = fixtures().qualifiedPairs[0];
  const mutual = {
    ...p,
    status: "mutual_confirmed" as const,
    confirmedAt: p.confirmedAt + 100,
  };
  assert.deepEqual(uniqueQualifiedPairs([p, mutual, p]), [p]);
  for (const n of [1, 2, 3])
    for (let slot = 0; slot < n; slot++) {
      const l = pairLayout(n, slot);
      assert.equal(l.avatarSize, [0, 176, 168, 152][n]);
      assert.equal(l.nameSize, [0, 34, 32, 30][n]);
      for (let family = 0; family < 5; family++)
        for (let side = 0; side < 2; side++)
          assert.deepEqual(pairPoint(family, side, 1, { x: 0, y: 0 }, l), {
            x: l.centerX,
            y: l.meetY,
          });
    }
});
test("duplicate combinations and missing grants are filtered; five path families stay in safe region and converge", () => {
  const p = fixtures().qualifiedPairs[0];
  const illegal = {
    ...p,
    id: "denied",
    male: { ...p.male, allowPublicDisplay: false },
  } as unknown as MeetPair;
  assert.equal(
    uniqueQualifiedPairs([
      p,
      { ...p, id: "duplicate", confirmedAt: p.confirmedAt + 1 },
      illegal,
    ]).length,
    1,
  );
  for (let family = 0; family < 5; family++)
    for (let side = 0; side < 2; side++)
      for (let n = 0; n <= 100; n++) {
        const out = pairPoint(family, side, n / 100, { x: 0, y: 0 });
        assert.ok(
          out.x >= 700 && out.x <= 1180 && out.y >= 340 && out.y <= 725,
        );
        if (n === 100) assert.deepEqual(out, MEET_POINT);
      }
});

// The reset/arrival controls must never relabel a chosen avatar as another gender.
test("mock pair fixtures preserve actual genders and avatars after empty and directed arrivals", () => {
  const source = new WorldMockSource();
  source.empty();
  source.join("female");
  source.join("female");
  source.meet();
  source.onePair();
  assert.deepEqual(source.getSnapshot().meetScene!.qualifiedPairs, []);
  source.empty();
  source.join("female");
  source.join("male");
  const players = source.getSnapshot().participants;
  source.onePair();
  const pair = source.getSnapshot().meetScene!.qualifiedPairs[0];
  assert.ok(displayablePair(pair));
  assert.equal(pair.female.id, players[0].id);
  assert.equal(pair.female.avatar, players[0].avatar);
  assert.equal(pair.male.id, players[1].id);
  assert.equal(pair.male.avatar, players[1].avatar);
});

test("uploaded photo display requires its own grant as well as both pair grants", () => {
  const { state, inv } = stateWithPair();
  state.invitations = [inv];
  const owner = state.participants.find((p) => p.id === inv.from)!;
  owner.photo = { id: "12345678-1234-1234-1234-123456789012", screen: false };
  const provider = { revision: 1, allows: () => true };
  const adapter = new WorldAdapter(provider);
  const first = adapter.read(structuredClone(state));
  assert.ok(!JSON.stringify(first).includes(owner.photo.id));
  owner.photo.screen = true;
  state.revision++;
  const visible = adapter.read(structuredClone(state));
  assert.ok(
    visible.meetScene!.qualifiedPairs[0].male.avatar.includes(owner.photo.id),
  );
  assert.equal(displayablePair(visible.meetScene!.qualifiedPairs[0]), true);
  assert.equal(
    displayablePair({
      ...visible.meetScene!.qualifiedPairs[0],
      male: {
        ...visible.meetScene!.qualifiedPairs[0].male,
        avatar: "https://untrusted.example/avatar.png",
      },
    }),
    false,
  );
  owner.photo.screen = false;
  state.revision++;
  const revoked = adapter.read(structuredClone(state));
  assert.ok(!JSON.stringify(revoked).includes(owner.photo.id));
  assert.equal(visible.totalMeetings, revoked.totalMeetings);
  provider.allows = () => false;
  provider.revision++;
  assert.deepEqual(
    adapter.read(structuredClone(state)).meetScene!.qualifiedPairs,
    [],
  );
});
