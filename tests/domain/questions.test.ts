import test from "node:test";
import assert from "node:assert/strict";
import { QUESTIONS } from "@/data/questions";
import { createSeed, SCENARIOS } from "@/data/seed";
import { applyCommand } from "@/domain/commands";
import {
  available,
  commonAnswers,
  complete,
  currentInvite,
  distribution,
  person,
  phase,
  recommendations,
  routeFor,
  stats,
} from "@/domain/selectors";
import type { Command, DemoState } from "@/domain/types";
const A = "p-shanfeng",
  B = "p-xiaoman";
let serial = 0;
function run(s: DemoState, actor: string, command: Command) {
  return applyCommand(
    s,
    { actor, command, epoch: s.epoch, id: `q10-${serial++}` },
    s.now,
  );
}
function legacy(scene = "discover") {
  const s = createSeed(scene);
  s.participants.forEach((p) =>
    QUESTIONS.slice(6).forEach((q) => delete p.answers[q.id]),
  );
  s.invitations.forEach(
    (i) =>
      (i.common = i.common.filter((a) => Number(a.questionId.slice(1)) <= 6)),
  );
  return s;
}
test("old six-answer participants must supply all four real answers before new recommendations or invitations", () => {
  let s = legacy();
  const original = structuredClone(s);
  const firstAnswers = { ...person(s, A)!.answers };
  assert.equal(complete(person(s, A)!), false);
  assert.equal(available(s, person(s, A)!), false);
  assert.equal(routeFor(s, person(s, A)!), "04-question");
  assert.equal(phase(s, person(s, A)!), "答题中");
  assert.deepEqual(recommendations(s, A), []);
  assert.throws(() => run(s, A, { type: "invite", targetId: B }), /完成探索/);
  for (const [index, q] of QUESTIONS.slice(6).entries()) {
    assert.throws(
      () => run(s, A, { type: "answer", questionId: q.id, value: "无效选项" }),
      /有效答案/,
    );
    s = run(s, A, { type: "answer", questionId: q.id, value: q.options[0] });
    assert.equal(complete(person(s, A)!), index === 3);
    assert.equal(
      routeFor(s, person(s, A)!),
      index === 3 ? "05-discover" : "04-question",
    );
  }
  // The target also needs to complete the expanded bank before a new invitation.
  assert.throws(() => run(s, A, { type: "invite", targetId: B }), /不方便接受/);
  for (const q of QUESTIONS.slice(6))
    s = run(s, B, { type: "answer", questionId: q.id, value: q.options[1] });
  assert.equal(recommendations(s, A)[0].participant.id, B);
  s = run(s, A, { type: "invite", targetId: B });
  for (const [key, value] of Object.entries(firstAnswers))
    assert.equal(person(s, A)!.answers[key], value);
  assert.deepEqual(
    s.invitations.slice(0, original.invitations.length),
    original.invitations,
  );
  assert.deepEqual(s.responses, original.responses);
  assert.deepEqual(s.scans, original.scans);
  assert.deepEqual(distribution(s), distribution(original));
  assert.equal(person(s, A)!.avatarId, person(original, A)!.avatarId);
  assert.equal(s.epoch, original.epoch);
  assert.equal(stats(s).real, 28);
});
test("existing six-answer invitation can accept, arrive and confirm before resuming missing questions", () => {
  let s = legacy("waiting");
  const invitationId = person(s, A)!.currentId!;
  const common = structuredClone(currentInvite(s, person(s, A)!)!.common);
  const answers = structuredClone(s.participants.map((p) => p.answers));
  s = run(s, B, { type: "accept", invitationId });
  for (const actor of [A, B]) {
    s = run(s, actor, { type: "depart", invitationId });
    s = run(s, actor, { type: "arrive", invitationId });
  }
  s = run(s, A, { type: "confirm", invitationId });
  assert.equal(stats(s).real, 28);
  s = run(s, B, { type: "confirm", invitationId });
  assert.equal(stats(s).real, 29);
  assert.equal(routeFor(s, person(s, A)!), "10-next-step");
  s = run(s, A, { type: "next", invitationId, choice: "WALK" });
  assert.equal(routeFor(s, person(s, A)!), "10-next-step");
  assert.equal(phase(s, person(s, A)!), "已选择下一站");
  const fact = s.invitations.find((i) => i.id === invitationId)!.realMeetAt;
  s = run(s, A, { type: "rediscover", invitationId });
  assert.equal(routeFor(s, person(s, A)!), "04-question");
  assert.equal(routeFor(s, person(s, B)!), "10-next-step");
  assert.deepEqual(
    s.participants.map((p) => p.answers),
    answers,
  );
  assert.deepEqual(
    s.invitations.find((i) => i.id === invitationId)!.common,
    common,
  );
  assert.equal(
    s.invitations.find((i) => i.id === invitationId)!.realMeetAt,
    fact,
  );
  assert.equal(stats(s).real, 29);
});
test("legacy task routes and operator statuses take priority over expanded-question completeness", () => {
  for (const [scene, route, status] of [
    ["waiting", "07-invitation", "等待回应"],
    ["busy", "08-mutual", "等待相遇点"],
    ["mutual", "08-mutual", "双方愿意见面"],
    ["arrival", "09-meet", "前往相遇点"],
    ["confirmed", "10-next-step", "已确认见面"],
  ]) {
    const s = legacy(scene);
    for (const actor of [A, B]) {
      assert.equal(routeFor(s, person(s, actor)!), route);
      assert.equal(phase(s, person(s, actor)!), status);
    }
  }
  for (const scene of ["declined", "expired"]) {
    let s = legacy(scene);
    s = run(s, A, {
      type: "rediscover",
      invitationId: person(s, A)!.currentId!,
    });
    assert.equal(routeFor(s, person(s, A)!), "04-question");
  }
});
test("common answers include up to ten exact matches while existing invitation snapshots stay fixed", () => {
  let s = createSeed("discover");
  person(s, B)!.answers = { ...person(s, A)!.answers };
  assert.equal(commonAnswers(person(s, A)!, person(s, B)!).length, 10);
  s = run(s, A, { type: "invite", targetId: B });
  const original = structuredClone(currentInvite(s, person(s, A)!)!.common);
  s = run(s, A, { type: "answer", questionId: "q10", value: "真诚" });
  assert.equal(commonAnswers(person(s, A)!, person(s, B)!).length, 9);
  assert.deepEqual(currentInvite(s, person(s, A)!)!.common, original);
});
test("all mock scenarios contain valid explicit ten-question answers while fresh starts empty", () => {
  for (const [scene] of SCENARIOS) {
    const s = createSeed(scene);
    for (const p of s.participants) {
      if (scene === "fresh" && p.id === A) {
        assert.deepEqual(p.answers, {});
      } else {
        assert.ok(complete(p), `${scene}: ${p.id}`);
        for (const q of QUESTIONS)
          assert.ok((q.options as readonly string[]).includes(p.answers[q.id]));
      }
    }
  }
});
