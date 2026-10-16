import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { database } from "../../src/server/db";
import { emptyActivity } from "../../src/server/state";
import { execute, readState } from "../../src/server/service";
import { migrateMeetPoints } from "../../src/server/meet-points-migration";

const url = new URL(process.env.DATABASE_URL || "http://invalid");
if (
  !["127.0.0.1", "localhost"].includes(url.hostname) ||
  !url.pathname.endsWith("_test")
)
  throw Error("Isolated local test database required");
const activity = `points-${randomUUID().slice(0, 8)}`;
let backupDir = "";
after(async () => {
  await database().query("DELETE FROM dl_commands WHERE activity_id=$1", [
    activity,
  ]);
  await database().query("DELETE FROM dl_events WHERE activity_id=$1", [
    activity,
  ]);
  await database().query("DELETE FROM dl_activities WHERE id=$1", [activity]);
  await database().end();
  if (backupDir) await rm(backupDir, { recursive: true, force: true });
});

test("live defaults, safe backfill, persistence, permissions and duplicate request handling", async (t) => {
  await database().query(
    await readFile(
      new URL("../../database/001-live.sql", import.meta.url),
      "utf8",
    ),
  );
  const initial = emptyActivity();
  assert.equal(initial.points.length, 20);
  const legacyPoint = {
    ...initial.points[0],
    id: "legacy-point",
    occupant: "legacy-invitation",
    location: "已有地点",
  };
  initial.points = [legacyPoint];
  initial.invitations = [
    {
      id: "legacy-invitation",
      from: "a",
      to: "b",
      status: "MEET_ASSIGNED",
      pointId: legacyPoint.id,
      createdAt: initial.now,
      departures: {},
      arrivals: {},
      confirmations: {},
      common: [],
      choices: {},
      pass: "test",
      code: "1234",
    },
  ];
  await database().query("INSERT INTO dl_activities(id,state) VALUES($1,$2)", [
    activity,
    initial,
  ]);
  backupDir = await mkdtemp(join(tmpdir(), "destiny-point-backup-"));

  await t.test(
    "backup precedes backfill, repeats do not change revision or current invitation",
    async () => {
      const result = await migrateMeetPoints(activity, backupDir);
      assert.equal(result.added, 19);
      const backup = JSON.parse(await readFile(result.backup!, "utf8"));
      assert.deepEqual(backup.state, initial);
      assert.equal((await stat(result.backup!)).mode & 0o777, 0o600);
      const state = await readState(activity);
      assert.equal(state.points.length, 20);
      assert.deepEqual(state.points[0], legacyPoint);
      assert.deepEqual(state.invitations, initial.invitations);
      assert.deepEqual(state.participants, initial.participants);
      assert.equal((await migrateMeetPoints(activity, backupDir)).added, 0);
      assert.equal((await readState(activity)).revision, state.revision);
    },
  );

  await t.test(
    "operator settings persist and replay does not toggle twice",
    async () => {
      const command = {
        type: "point-status",
        pointId: "meet-2",
        enabled: false,
      };
      const id = randomUUID();
      const operator = { role: "operator" as const, actor: "operator" };
      await execute(activity, operator, command, id, initial.epoch);
      const revision = (await readState(activity)).revision;
      await execute(activity, operator, command, id, initial.epoch);
      assert.equal((await readState(activity)).revision, revision);
      assert.equal(
        (await readState(activity)).points.find((p) => p.id === "meet-2")!
          .closed,
        true,
      );
      await assert.rejects(
        execute(
          activity,
          { actor: "a", role: "participant" },
          command,
          randomUUID(),
          initial.epoch,
        ),
      );
      await assert.rejects(
        execute(
          activity,
          operator,
          { ...command, pointId: legacyPoint.id },
          randomUUID(),
          initial.epoch,
        ),
        /确认场地空闲/,
      );
      await execute(
        activity,
        operator,
        { type: "point-add", name: "Meet21" },
        randomUUID(),
        initial.epoch,
      );
      await assert.rejects(
        execute(
          activity,
          operator,
          { type: "point-add", name: "Meet21" },
          randomUUID(),
          initial.epoch,
        ),
        /已经存在/,
      );
      const state = await readState(activity);
      assert.equal(state.points.length, 21);
      assert.equal(state.points.at(-1)!.location, "");
      await execute(
        activity,
        operator,
        { ...command, enabled: true },
        randomUUID(),
        initial.epoch,
      );
      assert.equal(
        (await readState(activity)).points.find((p) => p.id === "meet-2")!
          .closed,
        false,
      );
    },
  );
});
