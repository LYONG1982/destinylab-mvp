import test from "node:test";
import assert from "node:assert/strict";
import { createSeed, SCENARIOS } from "@/data/seed";
import { applyCommand } from "@/domain/commands";
import {
  commonAnswers,
  currentInvite,
  distribution,
  nicknameError,
  person,
  recommendations,
  routeFor,
  screenProjection,
  stats,
} from "@/domain/selectors";
import type { Command, DemoState } from "@/domain/types";
let n = 0;
function run(
  s: DemoState,
  actor: string,
  command: Command,
  id = `test-${n++}`,
) {
  return applyCommand(s, { actor, command, epoch: s.epoch, id }, s.now);
}
const A = "p-shanfeng",
  B = "p-xiaoman";
function id(s: DemoState) {
  return person(s, A)!.currentId!;
}
function send(s = createSeed("discover")) {
  return run(s, A, { type: "invite", targetId: B });
}
function accept(s = send()) {
  return run(s, B, { type: "accept", invitationId: id(s) });
}
function bothArrived() {
  let s = accept();
  for (const actor of [A, B]) {
    s = run(s, actor, { type: "depart", invitationId: id(s) });
    s = run(s, actor, { type: "arrive", invitationId: id(s) });
  }
  return s;
}
test("nickname uses exact Han range and 1–5 character boundaries", () => {
  for (const name of ["山", "小满", "一二三四五"])
    assert.equal(nicknameError(name), "");
  for (const name of ["", "abcdef", "山A", "小满1", "小满🌿", "一二三四五六"])
    assert.ok(nicknameError(name));
});
test("seed has valid relationships, one clock, 28 historical meets and coherent first-question distribution", () => {
  const s = createSeed("discover");
  assert.equal(stats(s).real, 28);
  assert.equal(stats(s).active, 37);
  assert.equal(stats(s).answered, 143);
  assert.deepEqual(
    distribution(s).map((d) => d.percentage),
    [33, 42, 25],
  );
  assert.equal(commonAnswers(person(s, A)!, person(s, B)!).length, 3);
  for (const i of s.invitations) {
    assert.ok(person(s, i.from));
    assert.ok(person(s, i.to));
    assert.notEqual(person(s, i.from)!.gender, person(s, i.to)!.gender);
  }
  assert.equal(screenProjection(s).real, stats(s).real);
});
test("recommendations expose exactly 0/1/2/3 candidates and calculate common answers", () => {
  for (const [scene, count] of [
    ["zero", 0],
    ["one", 1],
    ["two", 2],
    ["discover", 3],
  ] as const) {
    const s = createSeed(scene);
    assert.equal(recommendations(s, A).length, count);
    recommendations(s, A).forEach((r) => {
      assert.equal(r.participant.gender, "female");
      assert.equal(
        r.common.length,
        commonAnswers(person(s, A)!, r.participant).length,
      );
    });
  }
  const s = createSeed("discover");
  recommendations(s, B).forEach((r) =>
    assert.equal(r.participant.gender, "male"),
  );
});
test("browsing person is not recommended and must actively become ready before sending", () => {
  let s = createSeed("browse");
  assert.ok(!recommendations(s, B).some((r) => r.participant.id === A));
  assert.throws(() => send(s), /准备见面/);
  s = run(s, A, { type: "ready", value: true });
  s = send(s);
  assert.equal(currentInvite(s, person(s, A)!)?.status, "SENT");
});
test("only receiver can accept; active invitation prevents multiple chains", () => {
  const s = send();
  assert.throws(
    () => run(s, A, { type: "accept", invitationId: id(s) }),
    /只有收到/,
  );
  assert.throws(
    () => run(s, A, { type: "invite", targetId: "p-wanfeng" }),
    /结束当前/,
  );
  assert.throws(
    () => run(s, "p-wanfeng", { type: "accept", invitationId: id(s) }),
    /不是你的/,
  );
  const accepted = accept(s);
  assert.equal(
    currentInvite(accepted, person(accepted, A)!)?.status,
    "MEET_ASSIGNED",
  );
  assert.equal(
    accepted.points.filter((p) => p.occupant === id(accepted)).length,
    1,
  );
});
test("one participant can record a meeting without departure or arrival and leaves the other unrecorded", () => {
  let s = accept();
  const invitationId = id(s);
  s = run(s, A, { type: "confirm", invitationId });
  const i = currentInvite(s, person(s, A)!)!;
  assert.ok(i.confirmations[A]);
  assert.equal(i.confirmations[B], undefined);
  assert.equal(i.departures[A], undefined);
  assert.equal(i.departures[B], undefined);
  assert.equal(i.arrivals[A], undefined);
  assert.equal(i.arrivals[B], undefined);
  assert.equal(i.realMeetAt, undefined);
  assert.equal(routeFor(s, person(s, A)!), "10-next-step");
  assert.equal(routeFor(s, person(s, B)!), "08-mutual");
});
test("two independent meet confirmations add exactly one fact; replays and later repeat do not add", () => {
  let s = bothArrived();
  const invitationId = id(s);
  s = run(s, A, { type: "confirm", invitationId }, "confirm-A");
  assert.equal(stats(s).real, 28);
  s = run(s, B, { type: "confirm", invitationId }, "confirm-B");
  assert.equal(stats(s).real, 29);
  const replay = run(s, B, { type: "confirm", invitationId }, "confirm-B");
  assert.equal(replay, s);
  s = run(s, B, { type: "confirm", invitationId }, "another-command");
  assert.equal(stats(s).real, 29);
  assert.equal(screenProjection(s).real, 29);
  assert.ok(
    s.points.some((p) => p.occupant === invitationId),
    "physical resource remains held after real meeting",
  );
});
test("decline/cancel/expiry produce no encounter and allow explicit rediscovery", () => {
  let s = send();
  s = run(s, B, { type: "decline", invitationId: id(s) });
  assert.equal(stats(s).real, 28);
  s = run(s, A, { type: "rediscover", invitationId: id(s) });
  assert.equal(person(s, A)!.currentId, null);
  let expired = send();
  expired = run(expired, "operator", { type: "advance", minutes: 16 });
  assert.equal(currentInvite(expired, person(expired, A)!)?.status, "EXPIRED");
  assert.throws(() => accept(expired), /状态已变化/);
});
test("last meet point cannot be double assigned; releasing a vacant point wakes waiting relation", () => {
  let s = createSeed("busy");
  assert.equal(currentInvite(s, person(s, A)!)?.status, "ACCEPTED");
  s = run(s, "operator", { type: "release", pointId: "meet-1" });
  assert.equal(currentInvite(s, person(s, A)!)?.status, "MEET_ASSIGNED");
  assert.equal(s.points[0].occupant, id(s));
  assert.throws(
    () => run(s, "operator", { type: "release", pointId: "meet-1" }),
    /先结束/,
  );
});
test("operator help cannot substitute for participant meeting; leave cancels active chain", () => {
  let s = accept();
  s = run(s, A, { type: "help", invitationId: id(s) });
  s = run(s, A, { type: "help", invitationId: id(s) });
  assert.equal(s.helps.length, 1);
  s = run(s, "operator", {
    type: "help-status",
    helpId: s.helps[0].id,
    status: "ACK",
  });
  s = run(s, "operator", {
    type: "help-status",
    helpId: s.helps[0].id,
    status: "RESOLVED",
  });
  assert.equal(stats(s).real, 28);
  assert.throws(
    () => run(s, "operator", { type: "confirm", invitationId: id(s) }),
    /不是你的/,
  );
  s = run(s, "operator", {
    type: "participant",
    participantId: B,
    action: "leave",
  });
  assert.equal(currentInvite(s, person(s, A)!)?.status, "CANCELLED");
  assert.ok(!person(s, B)!.present);
});
test("pause blocks only new invitations and completed old feedback cannot mutate a new chain", () => {
  let s = send();
  s = run(s, "operator", { type: "pause", value: true });
  s = accept(s);
  assert.equal(currentInvite(s, person(s, A)!)?.status, "MEET_ASSIGNED");
  let ready = createSeed("discover");
  ready = run(ready, "operator", { type: "pause", value: true });
  assert.throws(() => send(ready), /暂停新邀请/);
  let done = createSeed("confirmed");
  const old = id(done);
  done = run(done, A, { type: "next", invitationId: old, choice: "END" });
  done = run(done, A, { type: "rediscover", invitationId: old });
  done = run(done, A, { type: "invite", targetId: "p-wanfeng" });
  assert.throws(
    () => run(done, A, { type: "next", invitationId: old, choice: "WALK" }),
    /任务已变更/,
  );
});
test("next choices are individual and partner pause removes future recommendation", () => {
  let s = createSeed("confirmed");
  s = run(s, A, { type: "next", invitationId: id(s), choice: "MERCHANT" });
  const i = currentInvite(s, person(s, A)!)!;
  assert.equal(i.choices[A], "MERCHANT");
  assert.equal(i.choices[B], undefined);
  s = run(s, "operator", {
    type: "merchant",
    merchantId: "cloud",
    active: false,
  });
  assert.ok(!s.merchants.find((m) => m.id === "cloud")!.active);
  assert.equal("consents" in s, false);
  assert.equal("benefits" in s, false);
});
test("screen projection contains no people, identities, meet codes or exact places; only three-pair aggregation plays", () => {
  const s = createSeed("broadcast");
  const output = JSON.stringify(screenProjection(s));
  for (const forbidden of [
    "山风",
    "小满",
    "p-shanfeng",
    "4721",
    "Meet01",
    "nickname",
    "avatar",
  ])
    assert.ok(!output.includes(forbidden));
  assert.equal(screenProjection(s).canBroadcast, true);
  const consumed = run(s, "operator", { type: "broadcast-consume" });
  assert.equal(screenProjection(consumed).canBroadcast, false);
  assert.equal(screenProjection(createSeed("mutual")).canBroadcast, false);
});
test("epoch guard rejects delayed actions from a previous scenario", () => {
  const s = createSeed("discover");
  assert.throws(
    () =>
      applyCommand(s, {
        actor: A,
        id: "old",
        epoch: "previous",
        command: { type: "invite", targetId: B },
      }),
    /场景已更新/,
  );
});
test("all named scenarios have valid current links and no duplicated physical reservation", () => {
  for (const [name] of SCENARIOS) {
    const s = createSeed(name);
    for (const p of s.participants)
      if (p.currentId)
        assert.ok(
          s.invitations.some(
            (i) => i.id === p.currentId && [i.from, i.to].includes(p.id),
          ),
        );
    const occupants = s.points.flatMap((p) => (p.occupant ? [p.occupant] : []));
    assert.equal(new Set(occupants).size, occupants.length);
    for (const pid of occupants)
      assert.ok(s.invitations.some((i) => i.id === pid));
  }
});

test("fixture milestones follow invitation, acceptance, departure, arrival and confirmation order", () => {
  for (const [name] of SCENARIOS) {
    const s = createSeed(name);
    for (const i of s.invitations) {
      if (i.acceptedAt)
        assert.ok(
          i.createdAt <= i.acceptedAt,
          `${name}: accepted before invitation`,
        );
      for (const actor of [i.from, i.to]) {
        if (i.departures[actor])
          assert.ok(
            i.acceptedAt && i.acceptedAt <= i.departures[actor],
            `${name}: departure before acceptance`,
          );
        if (i.arrivals[actor])
          assert.ok(
            i.departures[actor] && i.departures[actor] <= i.arrivals[actor],
            `${name}: arrival before departure`,
          );
        if (i.confirmations[actor])
          assert.ok(
            i.arrivals[actor] && i.arrivals[actor] <= i.confirmations[actor],
            `${name}: confirmation before arrival`,
          );
        if (i.realMeetAt)
          assert.ok(
            i.confirmations[actor] && i.confirmations[actor] <= i.realMeetAt,
            `${name}: real meet before confirmation`,
          );
      }
    }
  }
});
