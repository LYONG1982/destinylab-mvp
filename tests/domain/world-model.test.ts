import test from "node:test";
import assert from "node:assert/strict";
import { createSeed } from "@/data/seed";
import { applyCommand } from "@/domain/commands";
import { available } from "@/domain/selectors";
import type { Command, DemoState } from "@/domain/types";
import {
  allocatePercentages,
  WorldAdapter,
} from "@/features/screen/world/adapter";
import { WorldMockSource } from "@/features/screen/world/mock";
import { WorldClock } from "@/features/screen/world/state-machine";
import type { WorldEvent } from "@/features/screen/world/types";
const run = (state: DemoState, command: Command, actor = "p-shanfeng") =>
  applyCommand(
    state,
    { actor, command, id: crypto.randomUUID(), epoch: state.epoch },
    state.now,
  );
const cue = (id: string, more: Partial<WorldEvent> = {}): WorldEvent => ({
  id,
  type: "mutual_confirmed",
  timestamp: Date.now(),
  ...more,
});

test("world percentages allocate exactly 100, stable ties and empty input", () => {
  assert.deepEqual(allocatePercentages([48, 58, 37]), [34, 40, 26]);
  assert.deepEqual(allocatePercentages([1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(allocatePercentages([0, 0, 0]), [0, 0, 0]);
  for (let a = 1; a < 19; a++)
    for (let b = 1; b < 13; b++)
      assert.equal(
        allocatePercentages([a, b, 3]).reduce((sum, n) => sum + n, 0),
        100,
      );
});
test("adapter preserves source, anonymizes identifiers and cannot expose private pair or Tongzhou records", () => {
  const state = createSeed("discover");
  // Distinct sentinels avoid accidental matches inside timestamps or visual seeds.
  state.invitations.forEach((inv, index) => {
    inv.code = `private-screen-code-${index}`;
  });
  const saved = JSON.stringify(state);
  const adapter = new WorldAdapter();
  const data = adapter.read(state);
  assert.equal(JSON.stringify(state), saved);
  assert.strictEqual(adapter.read(state), data);
  assert.equal(data.events.length, 0);
  assert.equal(data.currentParticipants, 37);
  assert.equal(
    data.availableParticipants,
    state.participants.filter((p) => available(state, p)).length,
  );
  assert.ok(data.totalParticipants > data.participants.length);
  const json = JSON.stringify(data);
  for (const forbidden of [
    "p-shanfeng",
    "p-xiaoman",
    "tongzhouSubmissions",
    "currentId",
    "Meet01",
    "户外步道",
    ...state.invitations.map((inv) => inv.code),
  ])
    assert.ok(!json.includes(forbidden), forbidden);
  assert.ok(
    data.participants.every(
      (p) =>
        [...p.nickname].length <= 5 && p.avatar.startsWith("/assets/avatars-v520/"),
    ),
  );
});
test("answer precedes a single avatar join, then field move and actual availability remain distinct", () => {
  const adapter = new WorldAdapter();
  let state = createSeed("fresh");
  const before = adapter.read(state);
  state = run(state, { type: "answer", questionId: "q1", value: "一起逛逛" });
  const answered = adapter.read(state);
  assert.equal(answered.totalParticipants, before.totalParticipants + 1);
  assert.equal(answered.participants.length, before.participants.length);
  assert.ok(
    answered.events.some((e) => e.type === "choice_selected" && !e.playerId),
  );
  state = run(state, {
    type: "profile",
    name: "晚风",
    gender: "male",
    avatarId: "male_08",
    age: "26–29",
    ready: true,
  });
  const joined = adapter.read(state);
  const event = joined.events.find((e) => e.type === "join")!;
  assert.ok(event);
  assert.equal(joined.totalParticipants, answered.totalParticipants);
  assert.ok(
    joined.participants.some(
      (p) => p.id === event.playerId && p.avatar.endsWith("male_08.webp"),
    ),
  );
  state = run(state, { type: "answer", questionId: "q1", value: "认真认识" });
  const moved = adapter.read(state);
  assert.equal(moved.totalParticipants, joined.totalParticipants);
  assert.equal(
    moved.events.find((e) => e.type === "field_changed")?.playerId,
    event.playerId,
  );
  assert.ok(!moved.events.some((e) => e.type === "join"));
});
test("acceptedAt triggers one anonymous intersection, realMeetAt triggers a separate meeting; reset never replays history", () => {
  const adapter = new WorldAdapter();
  let state = createSeed("waiting");
  adapter.read(state);
  const invitation = state.invitations.find(
    (i) => i.from === "p-shanfeng" && i.status === "SENT",
  )!;
  state = run(
    state,
    { type: "accept", invitationId: invitation.id },
    invitation.to,
  );
  const accepted = adapter.read(state);
  const mutual = accepted.events.filter((e) => e.type === "mutual_confirmed");
  assert.equal(mutual.length, 1);
  assert.equal(mutual[0].playerId, undefined);
  assert.equal(mutual[0].field, undefined);
  assert.equal(accepted.totalMeetings, 28);
  const next = structuredClone(state);
  next.revision++;
  next.invitations.find((i) => i.id === invitation.id)!.realMeetAt = next.now;
  const meeting = adapter.read(next);
  assert.equal(
    meeting.events.filter((e) => e.type === "meeting_confirmed").length,
    1,
  );
  assert.equal(
    meeting.events.filter((e) => e.type === "mutual_confirmed").length,
    0,
  );
  assert.equal(meeting.totalMeetings, 29);
  assert.equal(new WorldAdapter().read(next).events.length, 0);
  const reset = structuredClone(next);
  reset.epoch = "new-epoch";
  assert.equal(adapter.read(reset).events.length, 0);
});
test("world clock pauses and restores the exact mode remainder across a global intersection", () => {
  const clock = new WorldClock();
  assert.equal(clock.tick(12000).mode, "LIVE");
  const before = clock.tick(2300);
  clock.receive(cue("one"));
  assert.equal(clock.tick(2500).intersection?.elapsedMs, 2500);
  const restored = clock.tick(3500);
  assert.equal(restored.intersection, null);
  assert.equal(restored.mode, "LIVE");
  assert.equal(restored.remainingMs, before.remainingMs);
  assert.equal(clock.tick(5700).mode, "MEET");
  assert.equal(clock.tick(9000).mode, "MEET");
  assert.equal(clock.tick(9000).mode, "CHOICE");
});
test("intersection bursts dedupe, bound queued cues and allow normal mode time before the next event", () => {
  const clock = new WorldClock();
  clock.tick(1000);
  const one = cue("same");
  clock.receive(one);
  clock.receive(one);
  for (let n = 0; n < 100; n++) clock.receive(cue(`burst-${n}`));
  assert.ok(clock.queuedCount <= 4);
  assert.equal(clock.tick(6000).intersection, null);
  assert.equal(clock.tick(2300).intersection, null);
  const next = clock.tick(200);
  assert.equal(next.intersection?.count, 100);
  assert.equal(next.remainingMs, 8600);
  assert.equal(clock.tick(20000).remainingMs, next.remainingMs);
  clock.reset("MEET", true);
  clock.receive(cue("stale", { timestamp: Date.now() - 11000 }));
  assert.equal(clock.tick(10).intersection, null);
  clock.receive(cue("fixed"));
  assert.ok(clock.tick(100).intersection);
  assert.equal(clock.tick(10000).mode, "MEET");
  assert.equal(clock.tick(0).remainingMs, 18000);
});
test("mock is isolated, has 143 profiles, seven feedback operations and never adds meetings on mutual confirmation", () => {
  const mock = new WorldMockSource();
  const baseline = mock.getSnapshot();
  assert.equal(baseline.totalParticipants, 143);
  assert.equal(baseline.currentParticipants, 37);
  assert.equal(baseline.availableParticipants, 0);
  assert.deepEqual(
    baseline.question.options.map((o) => o.count),
    [48, 58, 37],
  );
  assert.equal(new Set(baseline.participants.map((p) => p.field)).size, 3);
  const joined = mock.join();
  const id = joined.events[0].playerId!;
  assert.equal(joined.currentParticipants, 38);
  assert.equal(joined.totalParticipants, 143);
  assert.equal(mock.answer(id).totalParticipants, 144);
  assert.equal(mock.field(id).events[0].type, "field_changed");
  assert.equal(mock.open(id).availableParticipants, 1);
  assert.equal(mock.close(id).availableParticipants, 0);
  assert.equal(mock.mutual().totalMeetings, 28);
  assert.equal(mock.meet().totalMeetings, 29);
  assert.equal(mock.stress().participants.length, 143);
  assert.equal(mock.empty().currentParticipants, 0);
  assert.equal(
    mock.empty().question.options.reduce((n, o) => n + o.percent, 0),
    0,
  );
  assert.equal(
    baseline.currentParticipants,
    37,
    "published snapshots stay immutable",
  );
});

test("hidden clearing preserves current mode and exact remaining time, with detached frame values", () => {
  const clock = new WorldClock("LIVE");
  const initial = clock.tick(1700);
  clock.receive(cue("hide-event"));
  const priorFrame = clock.tick(1000);
  clock.receive(cue("queued-event"));
  const cleared = clock.clearEvents();
  assert.equal(cleared.mode, "LIVE");
  assert.equal(cleared.remainingMs, initial.remainingMs);
  assert.equal(cleared.intersection, null);
  assert.equal(clock.queuedCount, 0);
  assert.equal(priorFrame.intersection?.elapsedMs, 1000);
  const after = clock.tick(100);
  assert.equal(after.remainingMs, initial.remainingMs - 100);
  assert.equal(initial.remainingMs, 6300);
  clock.receive(cue("hide-event"));
  assert.equal(
    clock.tick(1).intersection,
    null,
    "hidden event stays deduplicated",
  );
});

test("availability adapter follows complete business eligibility rather than ready alone", () => {
  const adapter = new WorldAdapter();
  const state = createSeed("discover");
  const p = state.participants.find((p) => p.id === "p-shanfeng")!;
  p.ready = false;
  const baseline = adapter.read(state);
  const next = structuredClone(state);
  next.revision++;
  next.participants.find((p) => p.id === "p-shanfeng")!.ready = true;
  const opened = adapter.read(next);
  assert.equal(
    opened.availableParticipants,
    baseline.availableParticipants + 1,
  );
  const event = opened.events.find(
    (event) => event.type === "availability_changed",
  )!;
  assert.equal(event.isAvailable, true);
  assert.equal(
    opened.participants.find((p) => p.id === event.playerId)?.isAvailable,
    true,
  );
  const paused = structuredClone(next);
  paused.revision++;
  paused.participants.find((p) => p.id === "p-shanfeng")!.paused = true;
  assert.equal(
    adapter
      .read(paused)
      .events.find((event) => event.type === "availability_changed")
      ?.isAvailable,
    false,
  );
});

test("first choice, profile visibility and real presence have independent deltas", () => {
  const adapter = new WorldAdapter();
  let state = createSeed("fresh");
  const baseline = adapter.read(state);
  state = run(state, { type: "answer", questionId: "q1", value: "一起逛逛" });
  const choice = adapter.read(state);
  assert.equal(
    choice.events.filter((e) => e.type === "choice_selected").length,
    1,
  );
  assert.equal(
    choice.events.find((e) => e.type === "choice_selected")?.countDelta,
    1,
  );
  assert.equal(
    choice.events.find((e) => e.type === "choice_selected")?.gender,
    undefined,
  );
  assert.equal(choice.currentParticipants, baseline.currentParticipants);
  state = run(state, { type: "answer", questionId: "q1", value: "一起逛逛" });
  assert.equal(adapter.read(state).events.length, 0);
  state = run(state, {
    type: "profile",
    name: "晚风",
    gender: "male",
    avatarId: "male_08",
    age: "26–29",
    ready: true,
  });
  const profile = adapter.read(state);
  assert.deepEqual(
    profile.events.map((e) => e.type),
    ["join"],
  );
  assert.equal(profile.totalParticipants, choice.totalParticipants);
  assert.equal(profile.currentParticipants, choice.currentParticipants);
  const token = profile.events[0].playerId;
  assert.equal(
    profile.participants.find((p) => p.id === token)?.gender,
    "male",
  );
  assert.equal(
    profile.participants.find((p) => p.id === token)?.joinedAt,
    state.participants.find((p) => p.id === "p-shanfeng")?.joinedAt,
  );
  state = run(state, { type: "answer", questionId: "q1", value: "认真认识" });
  const move = adapter.read(state);
  assert.deepEqual(
    move.events.map((e) => e.type),
    ["field_changed"],
  );
  assert.equal(move.events[0].countDelta, 0);
  assert.equal(move.events[0].previousField, "q1:1");
  assert.equal(move.totalParticipants, profile.totalParticipants);
  const next = structuredClone(state);
  next.revision++;
  next.participants.find((p) => p.id === "p-shanfeng")!.present = false;
  const leave = adapter.read(next);
  assert.equal(
    leave.events.find((e) => e.type === "presence_changed")?.presentDelta,
    -1,
  );
  assert.equal(leave.currentParticipants, profile.currentParticipants - 1);
  const returned = structuredClone(next);
  returned.revision++;
  returned.participants.find((p) => p.id === "p-shanfeng")!.present = true;
  const rejoin = adapter.read(returned);
  assert.equal(
    rejoin.events.find((e) => e.type === "presence_changed")?.presentDelta,
    1,
  );
  assert.equal(rejoin.events.filter((e) => e.type === "join").length, 1);
  assert.ok(!rejoin.events.some((e) => e.type === "choice_selected"));
});

test("profile edits and later questions cannot fabricate a new choice or presence", () => {
  const adapter = new WorldAdapter();
  let state = createSeed("discover");
  const base = adapter.read(state);
  state = run(state, {
    type: "profile",
    name: "晚风",
    gender: "female",
    avatarId: "female_03",
    age: "26–29",
    ready: false,
  });
  const edit = adapter.read(state);
  assert.equal(edit.totalParticipants, base.totalParticipants);
  assert.equal(edit.currentParticipants, base.currentParticipants);
  assert.ok(
    !edit.events.some((e) =>
      ["join", "choice_selected", "presence_changed"].includes(e.type),
    ),
  );
  const next = structuredClone(state);
  next.revision++;
  next.participants.find((p) => p.id === "p-shanfeng")!.answers.q2 =
    "a changed later answer";
  const later = adapter.read(next);
  assert.deepEqual(
    later.events.map((e) => e.type),
    ["answer"],
  );
  assert.equal(later.totalParticipants, base.totalParticipants);
});

test("anonymous first choices and rechoices keep aggregate statistics without invented identities", () => {
  const adapter = new WorldAdapter();
  const state = createSeed("discover");
  adapter.read(state);
  const added = structuredClone(state);
  added.revision++;
  added.responses["anonymous-new-one"] = "一起逛逛";
  added.responses["anonymous-new-two"] = "一起逛逛";
  const data = adapter.read(added);
  const event = data.events.find((e) => e.type === "choice_selected")!;
  assert.equal(event.countDelta, 2);
  assert.equal(event.aggregateCount, 2);
  assert.equal(event.playerId, undefined);
  assert.equal(event.gender, undefined);
  const changed = structuredClone(added);
  changed.revision++;
  changed.responses["anonymous-new-one"] = "认真认识";
  const updated = adapter.read(changed);
  assert.equal(updated.totalParticipants, data.totalParticipants);
  assert.equal(updated.events[0].type, "field_changed");
  assert.equal(updated.events[0].countDelta, 0);
  assert.equal(updated.events[0].previousField, "q1:1");
  const epoch = { ...changed, epoch: "new-screen-baseline" };
  assert.deepEqual(adapter.read(epoch).events, []);
});

test("mock supports six gender and field arrivals and atomic five/twenty-person bursts", () => {
  const mock = new WorldMockSource();
  let count = 143;
  let present = 37;
  for (const gender of ["male", "female"] as const)
    for (const field of ["q1:0", "q1:1", "q1:2"]) {
      const data = mock.join(gender, field);
      const id = data.events.find((e) => e.type === "join")!.playerId;
      const joined = data.participants.find((p) => p.id === id)!;
      assert.equal(joined.gender, gender);
      assert.ok(joined.avatar.includes(`/${gender}_`));
      assert.equal(joined.field, field);
      assert.equal(data.totalParticipants, ++count);
      assert.equal(data.currentParticipants, ++present);
      assert.deepEqual(
        data.events.map((e) => e.type),
        ["join", "presence_changed", "choice_selected"],
      );
    }
  let notifications = 0;
  const unsubscribe = mock.subscribe(() => notifications++);
  const five = mock.burst(5, "female", "q1:2");
  assert.equal(notifications, 1);
  assert.equal(five.totalParticipants, count + 5);
  const twenty = mock.burst(20);
  assert.equal(notifications, 2);
  assert.equal(twenty.totalParticipants, count + 25);
  assert.equal(twenty.currentParticipants, present + 25);
  assert.equal(
    new Set(twenty.participants.map((p) => p.id)).size,
    twenty.participants.length,
  );
  assert.equal(
    twenty.events.filter((e) => e.type === "choice_selected").length,
    20,
  );
  assert.equal(
    twenty.question.options.reduce((n, o) => n + o.percent, 0),
    100,
  );
  unsubscribe();
});
