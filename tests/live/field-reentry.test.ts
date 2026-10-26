import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { database, transaction } from "../../src/server/db";
import { emptyActivity } from "../../src/server/state";
import {
  execute,
  join,
  load,
  save,
  type Session,
} from "../../src/server/service";
import { miniEnter, miniLogin } from "../../src/server/wechat-service";
import { fieldAction, fieldPreview } from "../../src/server/field-service";
import { reenterField } from "../../src/server/field-reentry";
import * as h5 from "../../src/app/api/live/[...path]/route";
import * as mini from "../../src/app/api/mini/[...path]/route";
import { QUESTIONS, AGES } from "../../src/data/questions";

const dbUrl = new URL(process.env.DATABASE_URL || "http://invalid");
if (
  !["127.0.0.1", "localhost"].includes(dbUrl.hostname) ||
  !dbUrl.pathname.endsWith("_test")
)
  throw Error("Isolated local test database required");
after(() => database().end());
const read = (activity: string) => transaction((c) => load(c, activity));
const operator: Session = { actor: "operator", role: "operator" };
async function fixture(kind: "h5" | "mini") {
  const activity = `reentry-${randomUUID().slice(0, 8)}`,
    state = emptyActivity();
  await database().query("INSERT INTO dl_activities(id,state) VALUES($1,$2)", [
    activity,
    JSON.stringify(state),
  ]);
  let session: Session, headers: Record<string, string>;
  if (kind === "h5") {
    const joined = await join(new Request("http://localhost"), activity);
    session = joined.session;
    headers = { Cookie: `dl-participant-${activity}=${joined.token}` };
  } else {
    const auth = await miniLogin(activity, randomUUID(), async () => ({
      appid: process.env.DESTINY_WECHAT_APPID!,
      openid: randomUUID(),
    }));
    session = await miniEnter(auth.identity, activity);
    headers = { Authorization: `Bearer ${auth.token}` };
  }
  const command = async (value: object, who = session) =>
    execute(activity, who, value, randomUUID(), state.epoch);
  await command({
    type: "profile",
    name: "回场清禾",
    gender: "female",
    age: AGES[1],
    avatarId: "female_01",
    ready: true,
  });
  for (const q of QUESTIONS)
    await command({ type: "answer", questionId: q.id, value: q.options[0] });
  const api = async (
    path: string,
    input?: object,
    id: string = randomUUID(),
    overrides = {},
    act = activity,
  ) => {
    const method = input === undefined ? "GET" : "POST";
    const req = new Request(
      `${process.env.DESTINY_PUBLIC_URL}/api/${kind === "h5" ? "live" : "mini"}/${path}?activity=${act}&audience=participant`,
      {
        method,
        headers: {
          ...headers,
          Origin: process.env.DESTINY_PUBLIC_URL!,
          "Content-Type": "application/json",
          "Idempotency-Key": id,
          ...overrides,
        },
        body: input === undefined ? undefined : JSON.stringify(input),
      },
    );
    const response = await (kind === "h5" ? h5 : mini)[method](req, {
      params: Promise.resolve({ path: path.split("/") }),
    });
    return { status: response.status, data: await response.json() };
  };
  const action = async (action: string) => {
    const current = await read(activity);
    const input = {
      action,
      epoch: current.epoch,
      ids: ["leave", "return", "remove"].includes(action)
        ? [session.actor]
        : [],
    };
    const preview = await fieldPreview(activity, input);
    return fieldAction(
      activity,
      {
        ...input,
        preview: preview.token,
        confirmation: activity,
        cleared: true,
      },
      randomUUID(),
    );
  };
  return { activity, state, session, command, api, action };
}

for (const kind of ["h5", "mini"] as const) {
  test(`${kind}: explicit reentry preserves identity and answers; reads never restore`, async () => {
    const f = await fixture(kind);
    await f.command(
      { type: "participant", action: "pause", participantId: f.session.actor },
      operator,
    );
    await f.command({ type: "pause", value: true }, operator);
    await f.action("leave");
    const before = await read(f.activity),
      original = before.participants[0];
    assert.equal((await f.api("snapshot")).status, 200);
    assert.equal(
      (await f.api(kind === "h5" ? "session" : "enter", {})).status,
      200,
    );
    assert.equal((await f.api("reenter")).status, 404);
    assert.equal((await read(f.activity)).participants[0].present, false);
    await assert.rejects(f.command({ type: "ready", value: true }), /离场/);
    const id = randomUUID();
    const responses = await Promise.all([
      f.api("reenter", { epoch: before.epoch }, id),
      f.api("reenter", { epoch: before.epoch }, id),
      f.api("reenter", { epoch: before.epoch }),
    ]);
    for (const r of responses)
      assert.equal(r.status, 200, JSON.stringify(r.data));
    const after = await read(f.activity),
      restored = after.participants[0];
    assert.deepEqual(restored, {
      ...original,
      present: true,
      ready: false,
      currentId: null,
    });
    assert.deepEqual(after.scans, before.scans);
    assert.deepEqual(after.responses, before.responses);
    assert.equal(after.participants.length, 1);
    assert.equal(after.activityPaused, true);
    assert.equal(after.events.filter((e) => e.type === "REENTER").length, 1);
    await assert.rejects(f.command({ type: "ready", value: true }), /推荐/);
    // An old successful request cannot undo a newer administrator leave.
    await f.action("leave");
    assert.equal(
      (await f.api("reenter", { epoch: before.epoch }, id)).status,
      200,
    );
    assert.equal((await read(f.activity)).participants[0].present, false);
    assert.equal((await f.api("reenter", { epoch: before.epoch })).status, 200);
    await f.command(
      { type: "participant", action: "resume", participantId: f.session.actor },
      operator,
    );
    await f.command({ type: "ready", value: true });
    assert.equal((await read(f.activity)).participants[0].ready, true);
    // Reenter while already present must not reset a deliberate ready choice.
    await f.api("reenter", { epoch: before.epoch });
    assert.equal((await read(f.activity)).participants[0].ready, true);
  });

  test(`${kind}: ownership, closed field, removal and round changes remain enforced`, async () => {
    const f = await fixture(kind),
      other = await fixture(kind),
      epoch = f.state.epoch;
    await f.action("leave");
    assert.equal(
      (await f.api("reenter", { epoch, participantId: other.session.actor }))
        .status,
      400,
    );
    assert.equal(
      (await f.api("reenter", { epoch }, randomUUID(), {}, other.activity))
        .status,
      401,
    );
    assert.equal(
      (
        await f.api("reenter", { epoch }, randomUUID(), {
          Cookie: "",
          Authorization: "",
        })
      ).status,
      401,
    );
    if (kind === "h5")
      assert.equal(
        (
          await f.api("reenter", { epoch }, randomUUID(), {
            Origin: "https://invalid.example",
          })
        ).status,
        403,
      );
    assert.equal((await f.api("reenter", { epoch }, "bad")).status, 400);
    assert.equal((await f.api("reenter", { epoch: "old-round" })).status, 409);
    await f.action("close");
    assert.equal((await f.api("reenter", { epoch })).status, 409);
    await f.action("open");
    await f.action("remove");
    assert.equal((await f.api("reenter", { epoch })).status, 410);
    await f.action("close");
    await f.action("reset");
    await f.action("open");
    const old = await f.api("reenter", { epoch });
    assert.ok([409, 410].includes(old.status));
    assert.equal((await read(f.activity)).participants.length, 0);
    // Existing explicit new-round admission still creates a new identity.
    const entered = await f.api(
      kind === "h5" ? "session" : "enter",
      kind === "h5" ? { enter: true } : {},
    );
    assert.equal(entered.status, 200);
    assert.notEqual(entered.data.actor, f.session.actor);
  });
}

test("reentry preserves ended invitations, real meets, photo consent and occupied points", async () => {
  const f = await fixture("h5");
  await transaction(async (c) => {
    const before = await load(c, f.activity, true),
      next = structuredClone(before);
    const me = next.participants[0],
      id = randomUUID();
    me.currentId = id;
    me.photo = { id: randomUUID(), screen: true };
    next.invitations.push({
      id,
      from: me.id,
      to: "synthetic-partner",
      status: "ARRIVING",
      createdAt: Date.now(),
      pointId: next.points[0].id,
      departures: { [me.id]: Date.now() },
      arrivals: {},
      confirmations: {},
      common: [],
      choices: {},
      pass: "123456",
      code: "synthetic",
    });
    next.invitations.push({
      ...next.invitations[0],
      id: randomUUID(),
      status: "CONFIRMED",
      realMeetAt: Date.now(),
    });
    next.points[0].occupant = id;
    await save(c, f.activity, before, next);
  });
  await f.action("leave");
  const before = await read(f.activity);
  const result = await f.api("reenter", { epoch: before.epoch });
  assert.equal(result.status, 200);
  const after = await read(f.activity);
  assert.deepEqual(after.invitations, before.invitations);
  assert.deepEqual(after.points, before.points);
  assert.deepEqual(after.participants[0].photo, before.participants[0].photo);
  assert.equal(after.participants[0].currentId, null);
  assert.equal(after.invitations[0].status, "CANCELLED");
});

test("reentry and admin changes serialize; rejected payload cannot reuse another command key", async () => {
  const f = await fixture("h5"),
    epoch = f.state.epoch,
    id = randomUUID();
  await execute(
    f.activity,
    f.session,
    { type: "ready", value: false },
    id,
    epoch,
  );
  await f.action("leave");
  assert.equal((await f.api("reenter", { epoch }, id)).status, 409);
  await assert.rejects(
    reenterField(f.activity, operator, { epoch }, randomUUID()),
    /本人/,
  );
  const c = await database().connect();
  try {
    await c.query("BEGIN");
    const before = await load(c, f.activity, true),
      next = structuredClone(before);
    const pending = f.api("reenter", { epoch });
    next.fieldOpen = false;
    await save(c, f.activity, before, next);
    await c.query("COMMIT");
    assert.equal((await pending).status, 409);
    assert.equal((await read(f.activity)).participants[0].present, false);
  } finally {
    c.release();
  }
});
