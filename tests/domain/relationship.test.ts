import test from "node:test";
import assert from "node:assert/strict";
import { createSeed } from "@/data/seed";
import { applyCommand } from "@/domain/commands";
import type { Command, DemoState } from "@/domain/types";
import { ScreenAdapter } from "@/components/motion/screen/model";
import {
  fieldLayout,
  placeSlots,
  sampleNodes,
} from "@/components/motion/screen/relationship/layout";
import {
  JoinEventQueue,
  type FieldEvent,
} from "@/components/motion/screen/relationship/queue";
import { MotionController } from "@/components/motion/screen/controller";
import { previewFields } from "@/components/motion/screen/relationship/preview";
import { ScreenFrameLoop } from "@/components/motion/screen/frame-loop";
const run = (state: DemoState, command: Command) =>
  applyCommand(
    state,
    {
      actor: "p-shanfeng",
      epoch: state.epoch,
      id: crypto.randomUUID(),
      command,
    },
    state.now,
  );
const profile = {
  type: "profile",
  name: "晚风",
  gender: "male",
  age: "26–29",
  ready: true,
  avatarId: "male_08",
} as const;

test("answer-before-profile counts once, selected avatar then joins with the submitted nickname; rename never rejoins", () => {
  const adapter = new ScreenAdapter();
  let state = createSeed("fresh");
  const before = adapter.read(state);
  state = run(state, { type: "answer", questionId: "q1", value: "一起逛逛" });
  const answer = adapter.read(state);
  assert.equal(answer.question.total, before.question.total + 1);
  assert.equal(answer.members.length, before.members.length);
  assert.ok(answer.events.some((e) => e.field?.kind === "answer" && !e.node));
  state = run(state, profile);
  const joined = adapter.read(state);
  assert.equal(joined.question.total, answer.question.total);
  const event = joined.events.find((e) => e.type === "JOIN")!;
  assert.equal(event.field?.label, "晚风");
  assert.equal(event.field?.optionKey, "q1:1");
  assert.ok(
    joined.members.some(
      (n) => n.key === event.node && n.image?.endsWith("male_08.webp"),
    ),
  );
  const renamed = adapter.read(run(state, { ...profile, name: "山风" }));
  assert.equal(renamed.events.length, 0);
  assert.equal(
    renamed.members.find((n) => n.key === event.node)?.label,
    "山风",
  );
});
test("already-profiled answer is one identifiable arrival; changing choice moves one member and preserves total", () => {
  const adapter = new ScreenAdapter();
  let state = run(createSeed("fresh"), profile);
  adapter.read(state);
  state = run(state, { type: "answer", questionId: "q1", value: "一起逛逛" });
  const answer = adapter.read(state);
  assert.equal(answer.events.filter((e) => e.field).length, 1);
  assert.equal(answer.events.find((e) => e.field)?.field?.kind, "join");
  state = run(state, { type: "answer", questionId: "q1", value: "轻松聊聊" });
  const move = adapter.read(state);
  assert.equal(move.question.total, answer.question.total);
  assert.equal(
    move.question.options[1].count,
    answer.question.options[1].count - 1,
  );
  assert.equal(
    move.question.options[0].count,
    answer.question.options[0].count + 1,
  );
  assert.equal(move.events.find((e) => e.field)?.field?.kind, "move");
  assert.equal(new ScreenAdapter().read(state).events.length, 0);
});
test("anonymous historical totals never fabricate people; public model includes only current question and approved identity", () => {
  const s = createSeed("discover");
  const a = new ScreenAdapter();
  const snapshot = a.read(s);
  assert.ok(snapshot.question.total > snapshot.members.length);
  assert.ok(
    snapshot.members.every((n) => n.image?.startsWith("/assets/avatars-v520/")),
  );
  const json = JSON.stringify(snapshot);
  for (const forbidden of [
    "p-shanfeng",
    "p-xiaoman",
    "Meet01",
    "currentId",
    "tongzhouSubmissions",
    "户外步道",
  ])
    assert.ok(!json.includes(forbidden), forbidden);
  assert.ok(json.includes("山风"));
  const next = structuredClone(s);
  next.responses["history-new"] = "轻松聊聊";
  const after = a.read(next);
  assert.equal(after.members.length, snapshot.members.length);
  assert.equal(after.events.filter((e) => e.node).length, 0);
});
test("2/3/4 layouts stay bounded, zero is supported, deterministic sampling preserves selected survivors and slot anchors", () => {
  const snapshot = new ScreenAdapter().read(createSeed("discover"));
  for (const count of [0, 2, 3, 4]) {
    const preview = previewFields(snapshot, count);
    const layout = fieldLayout(preview.question, 1200, 320);
    assert.equal(layout.length, count || 3);
    for (const f of layout)
      assert.ok(
        f.x >= f.radius * 0.8 &&
          f.x + f.radius * 0.8 <= 1200 &&
          f.y >= f.radius * 0.8 &&
          f.y + f.radius * 0.8 <= 320,
      );
    const key = preview.question.options[0].key;
    assert.deepEqual(
      sampleNodes(preview.members, key, 6),
      sampleNodes([...preview.members].reverse(), key, 6),
    );
    const nodes = sampleNodes(preview.members, key, 6);
    const before = placeSlots(nodes, new Map(), 6);
    const after = placeSlots(nodes.slice(1), before, 6);
    for (const n of nodes.slice(1))
      assert.equal(after.get(n.key), before.get(n.key));
  }
  assert.equal(previewFields(snapshot, 0).question.total, 0);
});
const event = (n: number, wall = Date.now()): FieldEvent => ({
  id: `event-${n}`,
  type: "ACTIVE",
  node: `n${n}`,
  timestamp: wall,
  field: {
    questionKey: "q1",
    optionKey: "q1:1",
    optionLabel: "一起逛逛",
    label: "晚风",
    kind: "join",
  },
});
test("eight-person burst animates three individuals then aggregates five without a hidden backlog; counters remain external", () => {
  const q = new JoinEventQueue();
  const wall = Date.now();
  for (let i = 0; i < 8; i++) q.enqueue(event(i, wall), 0);
  assert.equal(q.pending.length, 3);
  for (const t of [0, 350, 700, 1050]) q.tick(t, wall + t);
  assert.equal(q.active.length, 3);
  assert.equal(q.pending.length, 0);
  assert.match(q.notice!.text, /5 个人/);
  q.tick(4500, wall + 4500);
  assert.equal(q.active.length, 0);
  assert.equal(q.notice, null);
});
test("repeated/expired events, rapid move, removed participants and reset cannot replay a stale avatar", () => {
  const c = new MotionController();
  c.setFieldActive(true);
  const e = event(1);
  c.receive(e, 0);
  c.receive(e, 0);
  assert.equal(c.joins.pending.length, 1);
  c.receive(
    {
      ...e,
      id: "move",
      field: { ...e.field, optionKey: "q1:0", kind: "move" },
    },
    1,
  );
  assert.equal(c.joins.pending.length, 1);
  assert.equal(c.joins.pending[0].field.optionKey, "q1:0");
  c.joins.reconcile([], "q1");
  assert.equal(c.joins.pending.length, 0);
  c.receive({ ...event(2), timestamp: Date.now() - 6000 }, 10);
  assert.equal(c.joins.pending.length, 0);
  for (let n = 0; n < 600; n++) c.receive(event(n + 10), n * 700);
  assert.ok(c.joins.pending.length <= 32);
  assert.ok(c.effects.length <= 8);
  c.joins.tick(500000, Date.now() + 6000);
  assert.equal(c.joins.pending.length, 0);
  c.clear();
  assert.equal(c.joins.priorities().length, 0);
  c.dispose();
});
test("visual scheduler has one RAF even when subscribers are replaced inside a frame, and no loop after disposal", () => {
  const raf = globalThis.requestAnimationFrame,
    cancel = globalThis.cancelAnimationFrame;
  let id = 0;
  const pending = new Map<number, FrameRequestCallback>();
  globalThis.requestAnimationFrame = (cb) => {
    pending.set(++id, cb);
    return id;
  };
  globalThis.cancelAnimationFrame = (n) => {
    pending.delete(n);
  };
  try {
    const clock = new ScreenFrameLoop();
    let stop = () => {};
    stop = clock.add(() => {
      stop();
      clock.add(() => {});
    });
    assert.equal(pending.size, 1);
    const entry = [...pending][0];
    pending.delete(entry[0]);
    entry[1](16);
    assert.equal(pending.size, 1);
    clock.dispose();
    assert.equal(pending.size, 0);
  } finally {
    globalThis.requestAnimationFrame = raf;
    globalThis.cancelAnimationFrame = cancel;
  }
});
