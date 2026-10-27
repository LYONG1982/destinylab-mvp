import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { database } from "../../src/server/db";
import { emptyActivity, newParticipant, mobileProjection, worldProjection } from "../../src/server/state";
import { execute, readState } from "../../src/server/service";
import { QUESTIONS } from "../../src/data/questions";
import { pointOccupants } from "../../src/domain/encounters";
import type { DemoState } from "../../src/domain/types";

const url = new URL(process.env.DATABASE_URL || "http://invalid");
if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/destinylab_520_uat_test") throw Error("Dedicated local test database required");
after(() => database().end());
const operator = { role: "operator" as const, actor: "operator" };
async function fixture() {
  const activity = `selfsvc-${randomUUID().slice(0, 12)}`, state = emptyActivity();
  state.participants = ["male", "female"].map((gender, n) => ({
    ...newParticipant(), gender: gender as "male" | "female", name: n ? "星宁" : "云川",
    avatarId: n ? "female_06" : "male_04", age: "26–29", ready: true, profileComplete: true,
    answers: Object.fromEntries(QUESTIONS.map(q => [q.id, q.options[0]])),
  }));
  await database().query("INSERT INTO dl_activities(id,state) VALUES($1,$2::jsonb)", [activity, JSON.stringify(state)]);
  return { activity, state };
}
const send = (activity: string, s: DemoState, actor: string, command: unknown, id = randomUUID()) => execute(activity, { role: "participant", actor }, command, id, s.epoch);
async function pair() {
  const f = await fixture(); const [a, b] = f.state.participants;
  await send(f.activity, f.state, a.id, { type: "invite", targetId: b.id });
  let s = await readState(f.activity);
  await send(f.activity, s, b.id, { type: "accept", invitationId: s.invitations[0].id });
  s = await readState(f.activity); return { ...f, s, a, b, invitationId: s.invitations[0].id };
}

test("two concurrent personal reports and retries persist one event per person and one pair", async () => {
  const f = await pair(), ids = [randomUUID(), randomUUID()];
  await Promise.all([f.a, f.b].map((p, n) => send(f.activity, f.s, p.id, { type: "confirm", invitationId: f.invitationId }, ids[n])));
  let s = await readState(f.activity), inv = s.invitations[0];
  assert.equal(s.events.filter(e => e.type === "CONFIRM").length, 2);
  assert.equal(s.events.filter(e => e.type === "REAL_MEET").length, 1);
  assert.equal(worldProjection(s, f.activity).totalMeetings, 1);
  assert.deepEqual(inv.departures, {}); assert.deepEqual(inv.arrivals, {});
  const timestamps = { ...inv.confirmations }, revision = s.revision;
  await send(f.activity, s, f.a.id, { type: "confirm", invitationId: inv.id }, ids[0]);
  assert.equal((await readState(f.activity)).revision, revision);
  await send(f.activity, s, f.a.id, { type: "confirm", invitationId: inv.id });
  s = await readState(f.activity); inv = s.invitations[0];
  assert.deepEqual(inv.confirmations, timestamps); assert.equal(s.events.filter(e => e.type === "CONFIRM").length, 2);
  const mine = mobileProjection(s, f.a.id, f.activity);
  assert.deepEqual(Object.keys(mine.invitations[0].encounterCodes!), [f.a.id]);
});

test("a saved personal record unlocks next and remains saved when the partner later cancels", async () => {
  const f = await pair();
  await send(f.activity, f.s, f.a.id, { type: "confirm", invitationId: f.invitationId });
  let s = await readState(f.activity);
  assert.equal(s.invitations[0].confirmations[f.b.id], undefined);
  assert.equal(worldProjection(s, f.activity).totalMeetings, 0);
  await send(f.activity, s, f.a.id, { type: "next", invitationId: f.invitationId, choice: "WALK" });
  await assert.rejects(send(f.activity, s, f.b.id, { type: "next", invitationId: f.invitationId, choice: "END" }), /记录本人/);
  await send(f.activity, s, f.b.id, { type: "cancel", invitationId: f.invitationId });
  s = await readState(f.activity);
  await send(f.activity, s, f.a.id, { type: "next", invitationId: f.invitationId, choice: "END" });
  await assert.rejects(send(f.activity, s, f.b.id, { type: "confirm", invitationId: f.invitationId }), /当前不能/);
  assert.ok(s.invitations[0].confirmations[f.a.id]);
  assert.equal(pointOccupants(s.points.find(p => p.id === s.invitations[0].pointId)!).length, 1);
});

test("operator point creation/deletion is durable and private; occupied slots cannot be removed", async () => {
  const f = await pair();
  await execute(f.activity, operator, { type: "point-add", name: "Meet31", location: "合成测试位置" }, randomUUID(), f.s.epoch);
  let s = await readState(f.activity); const point = s.points.find(p => p.name === "Meet31")!;
  assert.equal(point.capacity, 30);
  await assert.rejects(send(f.activity, s, f.a.id, { type: "point-remove", pointId: point.id }), /不能执行/);
  await assert.rejects(execute(f.activity, operator, { type: "point-remove", pointId: s.invitations[0].pointId }, randomUUID(), s.epoch), /占用/);
  const key = randomUUID();
  await execute(f.activity, operator, { type: "point-remove", pointId: point.id }, key, s.epoch);
  await execute(f.activity, operator, { type: "point-remove", pointId: point.id }, key, s.epoch);
  s = await readState(f.activity);
  assert.ok(s.points.find(p => p.id === point.id)!.deletedAt);
  assert.equal(s.events.filter(e => e.type === "POINT_REMOVE").length, 1);
  assert.ok(!mobileProjection(s, f.a.id, f.activity).points.some(p => p.id === point.id));
  await assert.rejects(execute(f.activity, operator, { type: "point-add", name: "Meet31" }, randomUUID(), s.epoch), /已经存在/);
});

test("explicit legacy capacity application backs up old state and does not overwrite configured capacities", async () => {
  const f = await fixture(); delete f.state.points[0].capacity; f.state.points[1].capacity = 2;
  await database().query("UPDATE dl_activities SET state=$2::jsonb WHERE id=$1", [f.activity, JSON.stringify(f.state)]);
  const id = randomUUID();
  await execute(f.activity, operator, { type: "point-capacity-defaults", mode: "apply" }, id, f.state.epoch);
  await execute(f.activity, operator, { type: "point-capacity-defaults", mode: "apply" }, id, f.state.epoch);
  const s = await readState(f.activity);
  assert.equal(s.points[0].capacity, 30); assert.equal(s.points[1].capacity, 2);
  const backups = await database().query("SELECT snapshot FROM dl_field_archives WHERE activity_id=$1 AND action='point-capacity-defaults'", [f.activity]);
  assert.equal(backups.rows.length, 1);
  assert.equal(backups.rows[0].snapshot.points[0].capacity, undefined);
  assert.equal(backups.rows[0].snapshot.points[1].capacity, 2);
});
