import test from "node:test";
import assert from "node:assert/strict";
import { createSeed } from "@/data/seed";
import { completeMeetPoints, defaultMeetPoints } from "@/domain/meet-points";
import { hasEncounterWork, isPointDeleted, pointCapacity, reconcileEncounters } from "@/domain/encounters";
import { validateLiveCommand } from "@/server/validate-command";

test("fresh points default to 30 pairs and legacy capacity still falls back to one", () => {
  const points = defaultMeetPoints();
  assert.equal(points.length, 30);
  assert.ok(points.every((point) => point.capacity === 30));
  assert.equal(pointCapacity({ ...points[0], capacity: undefined }), 1);
  assert.equal(pointCapacity({ ...points[0], capacity: 160 }), 160);
  assert.equal(pointCapacity({ ...points[0], capacity: 161 }), 1);
});

test("deleted defaults remain as history and are not restored by point completion or allocation", () => {
  const points = defaultMeetPoints();
  points[0].deletedAt = 123;
  points[0].closed = true;
  const completed = completeMeetPoints(points);
  assert.equal(completed.length, 30);
  assert.equal(completed.filter((point) => point.name === "Meet01").length, 1);
  assert.equal(isPointDeleted(completed[0]), true);

  const state = createSeed("discover");
  state.points = [completed[0]];
  state.invitations = [{
    id: "waiting-pair", from: state.participants[0].id, to: state.participants[1].id,
    status: "ACCEPTED", createdAt: state.now, acceptedAt: state.now, pointId: null,
    departures: {}, arrivals: {}, confirmations: {}, common: [], choices: {}, pass: "A-001", code: "",
    codeVersion: "520",
    encounterCodes: { [state.participants[0].id]: "100", [state.participants[1].id]: "420" },
  }];
  assert.equal(hasEncounterWork(state), false);
  assert.equal(reconcileEncounters(state, state.now), false);
  assert.equal(state.invitations[0].pointId, null);
});

test("point add accepts optional position and 1..160 capacity; removal and backfill stay operator-only", () => {
  assert.deepEqual(validateLiveCommand({ type: "point-add", name: "Meet31" }, "operator"), {
    type: "point-add", name: "Meet31",
  });
  assert.deepEqual(validateLiveCommand({ type: "point-add", name: "Meet31", location: "东门", capacity: 160 }, "operator"), {
    type: "point-add", name: "Meet31", location: "东门", capacity: 160,
  });
  assert.throws(() => validateLiveCommand({ type: "point-add", name: "Meet31", capacity: 161 }, "operator"), /1至160/);
  assert.throws(() => validateLiveCommand({ type: "point-remove", pointId: "meet-1" }, "participant"), /不能执行/);
  assert.throws(() => validateLiveCommand({ type: "point-capacity-defaults", mode: "apply" }, "participant"), /不能执行/);
  assert.deepEqual(validateLiveCommand({ type: "point-remove", pointId: "meet-1" }, "operator"), {
    type: "point-remove", pointId: "meet-1",
  });
});
