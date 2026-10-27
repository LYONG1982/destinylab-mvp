import test from "node:test";
import assert from "node:assert/strict";
import { createSeed } from "@/data/seed";
import { QUESTIONS } from "@/data/questions";
import { applyCommand } from "@/domain/commands";
import { hasPersonalEncounter, routeFor, stats } from "@/domain/selectors";
import { defaultMeetPoints } from "@/domain/meet-points";
import { pointOccupants } from "@/domain/encounters";
import type { Command, DemoState } from "@/domain/types";

let sequence = 0;
const act = (s: DemoState, actor: string, command: Command) => applyCommand(s, { actor, command, epoch: s.epoch, id: `self-${sequence++}` }, s.now + sequence);
function fixture(pairs = 1) {
  const s = createSeed("discover");
  s.invitations = []; s.events = []; s.commands = []; s.points = defaultMeetPoints().slice(0, 1);
  s.participants = Array.from({ length: pairs * 2 }, (_, n) => ({
    ...structuredClone(s.participants[0]), id: `person-${n}`, gender: n % 2 ? "female" as const : "male" as const,
    name: n % 2 ? "星宁" : "云川", avatarId: n % 2 ? "female_06" : "male_04", currentId: null,
    present: true, paused: false, ready: true, profileComplete: true,
    answers: Object.fromEntries(QUESTIONS.map(q => [q.id, q.options[0]])),
  }));
  return s;
}
function paired(s = fixture(), pair = 0) {
  s = act(s, `person-${pair * 2}`, { type: "invite", targetId: `person-${pair * 2 + 1}` });
  return act(s, `person-${pair * 2 + 1}`, { type: "accept", invitationId: s.invitations.at(-1)!.id });
}

test("one personal record unlocks only that person's next step, without departures or arrivals", () => {
  let s = paired(); const id = s.invitations[0].id;
  s = act(s, "person-0", { type: "confirm", invitationId: id });
  assert.equal(routeFor(s, s.participants[0]), "10-next-step");
  assert.equal(routeFor(s, s.participants[1]), "08-mutual");
  assert.equal(s.invitations[0].status, "MEET_ASSIGNED");
  assert.deepEqual(s.invitations[0].departures, {}); assert.deepEqual(s.invitations[0].arrivals, {});
  assert.equal(s.invitations[0].confirmations["person-1"], undefined);
  assert.equal(stats(s).real, 0);
  assert.throws(() => act(s, "person-1", { type: "next", invitationId: id, choice: "WALK" }), /记录本人/);
  s = act(s, "person-0", { type: "next", invitationId: id, choice: "WALK" });
  assert.equal(s.invitations[0].choices["person-0"], "WALK");
  assert.equal(s.invitations[0].choices["person-1"], undefined);
  const time = s.invitations[0].confirmations["person-0"];
  s = act(s, "person-0", { type: "confirm", invitationId: id });
  assert.equal(s.invitations[0].confirmations["person-0"], time);
  assert.equal(s.events.filter(e => e.type === "CONFIRM").length, 1);
  s = act(s, "person-1", { type: "confirm", invitationId: id });
  assert.equal(stats(s).real, 1); assert.equal(s.invitations[0].status, "CONFIRMED");
  assert.equal(s.events.filter(e => e.type === "REAL_MEET").length, 1);
  s = act(s, "person-1", { type: "confirm", invitationId: id });
  assert.equal(stats(s).real, 1); assert.equal(s.events.filter(e => e.type === "REAL_MEET").length, 1);
});

test("personal progress survives counterpart cancellation while new reports on ended tasks are rejected", () => {
  let s = paired(); const id = s.invitations[0].id;
  s = act(s, "person-0", { type: "confirm", invitationId: id });
  s = act(s, "person-1", { type: "cancel", invitationId: id });
  assert.equal(routeFor(s, s.participants[0]), "10-next-step");
  s = act(s, "person-0", { type: "next", invitationId: id, choice: "END" });
  assert.throws(() => act(s, "person-1", { type: "confirm", invitationId: id }), /当前不能/);
  assert.equal(pointOccupants(s.points[0]).length, 1);
  assert.equal(stats(s).real, 0);
  s = act(s, "person-0", { type: "rediscover", invitationId: id });
  assert.equal(s.participants[0].currentId, null);
  assert.ok(s.invitations[0].confirmations["person-0"]);
});

test("one person may explicitly explore again while the other independently completes the old valid task", () => {
  let s = paired(fixture(2)); const id = s.invitations[0].id;
  s = act(s, "person-0", { type: "confirm", invitationId: id });
  s = act(s, "person-0", { type: "rediscover", invitationId: id });
  assert.equal(s.participants[1].currentId, id);
  s = act(s, "person-0", { type: "invite", targetId: "person-3" });
  s = act(s, "person-1", { type: "confirm", invitationId: id });
  assert.equal(s.invitations[0].status, "CONFIRMED"); assert.equal(stats(s).real, 1);
  assert.equal(routeFor(s, s.participants[1]), "10-next-step");
  assert.equal(s.participants[0].currentId, s.invitations[1].id);
});

test("pending, unassigned, invalid-code, foreign, closed and left identities cannot invent a meeting", () => {
  let s = fixture(); s = act(s, "person-0", { type: "invite", targetId: "person-1" });
  const id = s.invitations[0].id;
  assert.throws(() => act(s, "person-0", { type: "confirm", invitationId: id }), /当前不能/);
  s.points = [];
  s = act(s, "person-1", { type: "accept", invitationId: id });
  assert.throws(() => act(s, "person-0", { type: "confirm", invitationId: id }), /当前不能/);
  s = paired(); s.invitations[0].encounterCodes!["person-0"] = "x";
  assert.throws(() => act(s, "person-0", { type: "confirm", invitationId: s.invitations[0].id }), /有效相遇码/);
  s = paired(fixture(2));
  assert.throws(() => act(s, "person-2", { type: "confirm", invitationId: s.invitations[0].id }), /不是你的/);
  s.fieldOpen = false;
  assert.throws(() => act(s, "person-0", { type: "confirm", invitationId: s.invitations[0].id }), /现场已关闭/);
  s.fieldOpen = true; s.participants[0].present = false;
  assert.throws(() => act(s, "person-0", { type: "confirm", invitationId: s.invitations[0].id }), /离场/);
});

test("legacy four-digit tasks can record independently and historical CONFIRMED progress remains readable", () => {
  let s = paired(); const inv = s.invitations[0];
  delete inv.codeVersion; delete inv.encounterCodes; inv.code = "4721";
  s = act(s, "person-0", { type: "confirm", invitationId: inv.id });
  assert.equal(routeFor(s, s.participants[0]), "10-next-step");
  s.invitations[0].status = "CONFIRMED"; s.invitations[0].confirmations = {};
  assert.equal(hasPersonalEncounter(s.invitations[0], "person-1"), true);
  assert.equal(hasPersonalEncounter(s.invitations[0], "stranger"), false);
});

test("one location accommodates30 pairs; pair31 waits until an occupied slot is explicitly released", () => {
  let s = fixture(31);
  for (let n = 0; n < 31; n++) s = paired(s, n);
  assert.equal(pointOccupants(s.points[0]).length, 30);
  assert.equal(s.invitations[30].pointId, null);
  const first = s.invitations[0];
  s = act(s, first.from, { type: "cancel", invitationId: first.id });
  assert.equal(s.invitations[30].pointId, null);
  s = act(s, "operator", { type: "release", pointId: s.points[0].id, invitationId: first.id });
  assert.equal(s.invitations[30].pointId, s.points[0].id);
  assert.equal(pointOccupants(s.points[0]).length, 30);
  assert.equal(new Set(s.invitations.flatMap(i => Object.values(i.encounterCodes!))).size, 62);
});
