import test from "node:test";
import assert from "node:assert/strict";
import { defaultMeetPoints, completeMeetPoints } from "@/domain/meet-points";
import { createSeed } from "@/data/seed";
import { applyCommand } from "@/domain/commands";
import { validateLiveCommand } from "@/server/validate-command";
import type { Command, DemoState } from "@/domain/types";

let sequence = 0;
function run(state: DemoState, command: Command, actor = "operator") {
  return applyCommand(
    state,
    { actor, command, epoch: state.epoch, id: `point-test-${sequence++}` },
    state.now,
  );
}
test("30 fresh points have unique IDs and numbers, without invented addresses", () => {
  const points = defaultMeetPoints();
  assert.equal(points.length, 30);
  assert.equal(new Set(points.map((p) => p.id)).size, 30);
  assert.deepEqual(
    points.map((p) => p.name),
    Array.from(
      { length: 30 },
      (_, i) => `Meet${String(i + 1).padStart(2, "0")}`,
    ),
  );
  assert.ok(
    points.every((p) => !p.location && !p.distance && !p.closed && !p.occupant),
  );
  assert.deepEqual(createSeed("fresh").points, points);
});
test("backfill preserves IDs, occupancy, custom fields and disabled state, avoiding ID collisions", () => {
  const existing = [
    {
      ...defaultMeetPoints()[0],
      id: "legacy-id",
      location: "旧地址",
      occupant: "ongoing",
    },
    { ...defaultMeetPoints()[1], id: "meet-3", closed: true },
    { ...defaultMeetPoints()[2], id: "custom-id", name: "Meet99" },
  ];
  const before = structuredClone(existing);
  const filled = completeMeetPoints(existing);
  assert.equal(filled.length, 31);
  assert.deepEqual(filled.slice(0, 3), before);
  assert.deepEqual(existing, before);
  assert.equal(new Set(filled.map((p) => p.id)).size, filled.length);
  assert.deepEqual(completeMeetPoints(filled), filled);
});
test("only operators can configure points and occupied points cannot be disabled", () => {
  let state = createSeed("mutual");
  const command: Command = {
    type: "point-status",
    pointId: state.points[0].id,
    enabled: false,
  };
  assert.throws(() => validateLiveCommand(command, "participant"));
  assert.throws(() =>
    validateLiveCommand({ ...command, enabled: "false" }, "operator"),
  );
  assert.deepEqual(validateLiveCommand(command, "operator"), command);
  assert.throws(() => run(state, command, "p-shanfeng"), /运营身份/);
  assert.throws(() => run(state, command), /确认场地空闲/);
  state = createSeed("discover");
  state = run(state, command);
  assert.equal(state.points[0].closed, true);
  state = run(state, { type: "invite", targetId: "p-xiaoman" }, "p-shanfeng");
  const invite = state.invitations.find((i) => i.status === "SENT")!;
  state = run(state, { type: "accept", invitationId: invite.id }, "p-xiaoman");
  assert.equal(
    state.invitations.find((i) => i.id === invite.id)!.pointId,
    state.points[1].id,
  );
  state = run(state, { ...command, enabled: true });
  assert.equal(state.points[0].closed, false);
});
