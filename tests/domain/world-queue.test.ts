import test from "node:test";
import assert from "node:assert/strict";
import { StableQueueController } from "@/features/screen/world/stable-queue";
import {
  PLAYER_LAYOUT,
  placementForSlot,
  type PlayerPlacement,
} from "@/features/screen/world/player-layout";
import type { WorldPlayer } from "@/features/screen/world/types";

const player = (
  index: number,
  patch: Partial<WorldPlayer> = {},
): WorldPlayer => ({
  id: `person-${String(index).padStart(4, "0")}`,
  nickname: "五字测试昵称".slice(0, 5),
  avatar: "/assets/avatars/male_01.png",
  gender: "male",
  joinedAt: index,
  field: "q1:0",
  status: "exploring",
  isAvailable: false,
  activity: 0,
  seed: index,
  ...patch,
});
function assertWindow(list: PlayerPlacement[], capacity: number) {
  assert.equal(new Set(list.map((p) => p.id)).size, list.length);
  const groups = new Map<string, PlayerPlacement[]>();
  for (const item of list)
    groups.set(item.queueKey, [...(groups.get(item.queueKey) ?? []), item]);
  for (const group of groups.values()) {
    assert.ok(
      group.length <= capacity,
      `${group[0]?.queueKey}: ${group.length}`,
    );
    const visible = group
      .filter((p) => p.opacity > 0.02)
      .sort((a, b) => a.y - b.y);
    for (let i = 1; i < visible.length; i++)
      assert.ok(
        visible[i].y - visible[i - 1].y >= visible[i].height - 0.1,
        `overlap: ${visible[i - 1].phase} / ${visible[i].phase}`,
      );
  }
}

test("queue capacity is respected in every movement frame, including overflow thresholds", () => {
  for (const mode of ["CHOICE", "LIVE"] as const) {
    const capacity = PLAYER_LAYOUT[mode].capacity;
    for (const count of [0, 1, capacity, capacity + 1, 10, 11, 20]) {
      const controller = new StableQueueController(
        Array.from({ length: count }, (_, i) => player(i)),
      );
      const initial = controller.advance(0, mode);
      assert.equal(initial.length, Math.min(count, capacity));
      for (let frame = 0; frame < 1200; frame++)
        assertWindow(controller.advance(16, mode), capacity);
      if (count <= capacity)
        assert.deepEqual(controller.advance(0, mode), initial);
    }
  }
});

test("initial sorting is stable; nickname and availability changes do not shuffle or reset the queue", () => {
  const roster = Array.from({ length: 8 }, (_, i) => player(i)).reverse();
  const controller = new StableQueueController();
  controller.update(roster);
  const first = controller.advance(0, "CHOICE");
  assert.deepEqual(
    first.map((p) => p.id),
    [0, 1, 2, 3, 4].map((i) => player(i).id),
  );
  assert.ok(first.every((p) => p.phase === "hold"));
  controller.advance(3150, "CHOICE");
  controller.update(
    roster.map((p) => ({ ...p, nickname: "晚风", isAvailable: true })),
  );
  const moving = controller.advance(100, "CHOICE");
  assert.equal(moving[0].phase, "exit");
  assert.ok(
    moving.every((p) => p.player.nickname === "晚风" && p.player.isAvailable),
  );
});

test("a new full-queue member receives the next window without duplicating or reshuffling survivors", () => {
  const roster = Array.from({ length: 7 }, (_, i) => player(i));
  const controller = new StableQueueController(roster);
  const newcomer = player(99);
  controller.update([...roster, newcomer]);
  assert.equal(controller.advance(0, "CHOICE")[0].phase, "exit");
  for (let i = 0; i < 60; i++)
    assertWindow(controller.advance(16, "CHOICE"), 5);
  const after = controller.advance(0, "CHOICE");
  assert.deepEqual(
    after.map((p) => p.id),
    [1, 2, 3, 4, 99].map((i) => player(i).id),
  );
});

test("burst additions retain all participants in bounded windows and eventually display each", () => {
  const initial = Array.from({ length: 5 }, (_, i) => player(i));
  const controller = new StableQueueController(initial);
  const all = Array.from({ length: 25 }, (_, i) => player(i));
  controller.update(all);
  const seen = new Set<string>();
  for (let frame = 0; frame < 6000; frame++) {
    const list = controller.advance(16, "CHOICE");
    assertWindow(list, 5);
    list.filter((p) => p.opacity > 0.9).forEach((p) => seen.add(p.id));
  }
  assert.equal(seen.size, all.length);
});

test("each gender queue has independent timing; pauses and inactive modes do not consume time", () => {
  const roster = [
    ...Array.from({ length: 8 }, (_, i) => player(i)),
    ...Array.from({ length: 8 }, (_, i) =>
      player(i + 100, { gender: "female" }),
    ),
  ];
  const controller = new StableQueueController(roster);
  const current = controller.advance(3250, "CHOICE");
  assert.equal(current.find((p) => p.gender === "male")?.phase, "exit");
  assert.equal(current.find((p) => p.gender === "female")?.phase, "hold");
  assert.deepEqual(controller.advance(8000, "CHOICE", true), current);
  controller.advance(7000, "LIVE");
  assert.deepEqual(controller.advance(0, "CHOICE"), current);
  assert.deepEqual(controller.advance(1000, "MEET"), []);
});

test("Reduced Motion swaps windows instantly at low frequency and never exposes moving positions", () => {
  const controller = new StableQueueController(
    Array.from({ length: 20 }, (_, i) => player(i)),
  );
  const first = controller.advance(0, "LIVE", false, true);
  const next = controller.advance(6000, "LIVE", false, true);
  assert.notDeepEqual(
    next.map((p) => p.id),
    first.map((p) => p.id),
  );
  for (const p of next) {
    assert.equal(p.phase, "hold");
    assert.equal(p.opacity, 1);
    assert.equal(p.y, 300 + p.slot * 112);
  }
  assert.deepEqual(controller.advance(100, "LIVE", false, true), next);
});

test("field and gender edits migrate one identity; neutral participants only appear in LIVE", () => {
  const roster = [
    player(0),
    player(1, { field: null }),
    player(2, { gender: "female", field: "q1:2" }),
  ];
  const controller = new StableQueueController(roster);
  assert.equal(controller.advance(0, "CHOICE").length, 2);
  assert.equal(controller.advance(0, "LIVE").length, 3);
  controller.update(
    roster.map((p) =>
      p.id === player(0).id ? { ...p, gender: "female", field: "q1:1" } : p,
    ),
  );
  const changed = controller.advance(0, "CHOICE");
  assert.equal(changed.length, 2);
  assert.equal(new Set(changed.map((p) => p.id)).size, 2);
  assert.equal(
    changed.find((p) => p.id === player(0).id)?.queueKey,
    "CHOICE:q1:1:female",
  );
});

test("deletions during movement remove stale identities while preserving capacity", () => {
  const roster = Array.from({ length: 12 }, (_, i) => player(i));
  const controller = new StableQueueController(roster);
  controller.advance(3550, "CHOICE");
  controller.update(
    roster.filter((p) => ![player(1).id, player(5).id].includes(p.id)),
  );
  for (let frame = 0; frame < 300; frame++) {
    const list = controller.advance(16, "CHOICE");
    assert.ok(list.every((p) => ![player(1).id, player(5).id].includes(p.id)));
    assertWindow(list, 5);
  }
});

test("logical layout preserves approved dimensions, nickname direction and the QR exclusion boundary", () => {
  const choice = placementForSlot({
    player: player(0),
    mode: "CHOICE",
    queueKey: "test",
    slot: 0,
  });
  assert.equal(choice.x, 88);
  assert.equal(choice.y, 312);
  assert.equal(choice.avatarSize, 80);
  assert.equal(choice.nameSize, 24);
  for (const gender of ["male", "female"] as const) {
    for (let fieldIndex = 0; fieldIndex < 3; fieldIndex++) {
      const item = placementForSlot({
        player: player(0, { gender }),
        mode: "CHOICE",
        queueKey: "test",
        slot: 4,
        fieldIndex,
      });
      assert.equal(item.reverse, false);
      assert.ok(item.x + item.width <= 1600);
    }
    const live = placementForSlot({
      player: player(0, { gender }),
      mode: "LIVE",
      queueKey: "test",
      slot: 5,
    });
    assert.equal(live.avatarSize, 96);
    assert.equal(live.nameSize, 28);
    assert.equal(live.reverse, gender === "female");
    assert.equal(live.y, 860);
    assert.ok(live.avatarCenterX + (live.avatarSize * 1.15) / 2 < 1613);
  }
});
