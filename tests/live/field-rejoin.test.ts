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
import * as wall from "../../src/app/api/member-wall/[...path]/route";
import { WALL_CONSENT_VERSION } from "../../src/domain/member-wall";
import * as avatars from "../../src/app/api/avatar/[...path]/route";
import { snapshot } from "../../src/server/service";
import { worldProjection } from "../../src/server/state";
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
  const activity = `rejoin-${randomUUID().slice(0, 8)}`,
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
  const originalHeaders = { ...headers };
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
    return {
      status: response.status,
      data: await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  };
  const action = async (action: string, actor = session.actor) => {
    const current = await read(activity);
    const input = {
      action,
      epoch: current.epoch,
      ids: ["leave", "return", "remove"].includes(action) ? [actor] : [],
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
  return {
    activity,
    state,
    session,
    command,
    api,
    action,
    originalHeaders,
    useCookie: (cookie?: string) => {
      if (cookie) headers.Cookie = cookie;
    },
  };
}

for (const kind of ["h5", "mini"] as const) {
  test(`${kind}: removed identity explicitly creates exactly one fresh participation; archives are immutable`, async () => {
    const f = await fixture(kind);
    await f.action("remove");
    const before = await read(f.activity);
    const archives = async () =>
      (
        await database().query(
          "SELECT * FROM dl_field_archives WHERE activity_id=$1 ORDER BY id",
          [f.activity],
        )
      ).rows;
    const archived = await archives();
    const input = { actor: f.session.actor, epoch: before.epoch };
    for (const path of ["snapshot", "snapshot"]) {
      const r = await f.api(path);
      assert.equal(r.status, 410);
      assert.deepEqual(r.data.removedEntry, input);
    }
    assert.equal(
      (await f.api(kind === "h5" ? "session" : "enter", {})).status,
      410,
    );
    assert.equal(
      (await f.api(kind === "h5" ? "session" : "enter", { enter: true }))
        .status,
      410,
    );
    assert.ok([404, 405].includes((await f.api("rejoin")).status));
    if (kind === "mini") assert.equal((await f.api("enter")).status, 405);
    assert.equal((await read(f.activity)).participants.length, 0);
    const results = await Promise.all(
      Array.from({ length: 8 }, () => f.api("rejoin", input)),
    );
    for (const r of results)
      assert.equal(r.status, 200, JSON.stringify(r.data));
    const actor = results[0].data.actor;
    assert.ok(results.every((r) => r.data.actor === actor));
    assert.notEqual(actor, f.session.actor);
    f.useCookie(results[0].cookie);
    const next = await read(f.activity),
      p = next.participants[0];
    assert.equal(next.participants.length, 1);
    assert.deepEqual(next.scans, [actor]);
    assert.equal(p.name, "");
    assert.equal(p.age, "");
    assert.equal(p.profileComplete, false);
    assert.equal(p.ready, false);
    assert.equal(p.present, true);
    assert.equal(p.avatarId, null);
    assert.ok(!p.photo);
    assert.equal(p.currentId, null);
    assert.deepEqual(p.answers, {});
    assert.deepEqual(next.responses, {});
    assert.deepEqual(next.displayGrants, {});
    assert.deepEqual(next.invitations, []);
    assert.deepEqual(await archives(), archived);
    // A successful request whose response/cookie was lost can be replayed by either session.
    assert.equal((await f.api("rejoin", input)).data.actor, actor);
    assert.equal(
      (await f.api("rejoin", input, randomUUID(), f.originalHeaders)).data
        .actor,
      actor,
    );
    const stale = await f.api(
      "command",
      { epoch: next.epoch, command: { type: "ready", value: true } },
      randomUUID(),
      { "X-Destiny-Actor": f.session.actor },
    );
    assert.equal(stale.status, 409);
    const legacy = await f.api("command", {
      epoch: next.epoch,
      command: { type: "ready", value: true },
    });
    assert.equal(legacy.status, 409);
    const current = await f.api(
      "command",
      { epoch: next.epoch, command: { type: "ready", value: false } },
      randomUUID(),
      { "X-Destiny-Actor": actor },
    );
    assert.equal(current.status, 200, JSON.stringify(current.data));
    if (kind === "h5") {
      const headers = { ...f.originalHeaders, Cookie: results[0].cookie! };
      const me = await wall.GET(
        new Request(
          `${process.env.DESTINY_PUBLIC_URL}/api/member-wall/me?activity=${f.activity}`,
          { headers },
        ),
        { params: Promise.resolve({ path: ["me"] }) },
      );
      assert.equal(me.status, 200);
      const view = await me.json();
      assert.equal(view.actor, actor);
      const updated = await wall.POST(
        new Request(
          `${process.env.DESTINY_PUBLIC_URL}/api/member-wall/consent?activity=${f.activity}`,
          {
            method: "POST",
            headers: {
              ...headers,
              Origin: process.env.DESTINY_PUBLIC_URL!,
              "Content-Type": "application/json",
              "X-Destiny-Actor": view.actor,
            },
            body: JSON.stringify({
              allow: false,
              nickname: "新参与者",
              expectedVersion: view.version,
              consentVersion: WALL_CONSENT_VERSION,
            }),
          },
        ),
        { params: Promise.resolve({ path: ["consent"] }) },
      );
      assert.equal(updated.status, 200, await updated.text());
    }
    await assert.rejects(f.command({ type: "ready", value: true }), /离场/);
    await f.action("leave", actor);
    assert.equal((await f.api("rejoin", input)).status, 200);
    assert.equal((await read(f.activity)).participants[0].present, false);
    await f.action("remove", actor);
    assert.equal((await f.api("rejoin", input)).status, 409);
    assert.equal((await read(f.activity)).participants.length, 0);
    const newContext = await f.api("snapshot");
    assert.deepEqual(newContext.data.removedEntry, {
      actor,
      epoch: next.epoch,
    });
    const again = await f.api("rejoin", newContext.data.removedEntry);
    assert.equal(again.status, 200, JSON.stringify(again.data));
    assert.notEqual(again.data.actor, actor);
    assert.equal((await archives()).length, 2);
  });

  test(`${kind}: rejoin enforces identity, activity, closure, current epoch and serialized admin actions`, async () => {
    const f = await fixture(kind),
      other = await fixture(kind);
    const input = { actor: f.session.actor, epoch: f.state.epoch };
    assert.equal((await f.api("rejoin", input)).status, 409);
    await f.action("remove");
    assert.equal(
      (await f.api("rejoin", { ...input, actor: other.session.actor })).status,
      403,
    );
    assert.equal(
      (await f.api("rejoin", input, randomUUID(), {}, other.activity)).status,
      401,
    );
    assert.equal(
      (
        await f.api("rejoin", input, randomUUID(), {
          Cookie: "",
          Authorization: "",
        })
      ).status,
      401,
    );
    assert.equal(
      (await f.api("rejoin", { ...input, extra: true })).status,
      400,
    );
    if (kind === "h5")
      assert.equal(
        (
          await f.api("rejoin", input, randomUUID(), {
            Origin: "https://invalid.example",
          })
        ).status,
        403,
      );
    const c = await database().connect();
    try {
      await c.query("BEGIN");
      const before = await load(c, f.activity, true),
        next = structuredClone(before);
      const pending = f.api("rejoin", input);
      next.fieldOpen = false;
      await save(c, f.activity, before, next);
      await c.query("COMMIT");
      assert.equal((await pending).status, 409);
    } finally {
      c.release();
    }
    assert.equal((await read(f.activity)).participants.length, 0);
    await f.action("reset");
    await f.action("open");
    assert.equal((await f.api("rejoin", input)).status, 409);
    assert.equal((await read(f.activity)).participants.length, 0);
  });

  test(`${kind}: custom photos cannot be uploaded/bound/read; historical bytes survive system-avatar changes`, async () => {
    const f = await fixture(kind),
      asset = randomUUID(),
      bytes = Buffer.from("synthetic-historical-photo");
    await transaction(async (c) => {
      const before = await load(c, f.activity, true),
        next = structuredClone(before);
      next.participants[0].photo = { id: asset, screen: true };
      await c.query(
        "INSERT INTO dl_avatar_assets(id,activity_id,actor,bytes,attached) VALUES($1,$2,$3,$4,true)",
        [asset, f.activity, f.session.actor, bytes],
      );
      await save(c, f.activity, before, next);
    });
    const avatarApi = async (path: string, input?: object) => {
      if (kind === "mini") return f.api(`avatar/${path}`, input);
      const method = input === undefined ? "GET" : "POST";
      const response = await avatars[method](
        new Request(
          `${process.env.DESTINY_PUBLIC_URL}/api/avatar/${path}?activity=${f.activity}`,
          {
            method,
            headers: {
              ...f.originalHeaders,
              Origin: process.env.DESTINY_PUBLIC_URL!,
              "Content-Type": "application/json",
              "Idempotency-Key": randomUUID(),
            },
            body: input === undefined ? undefined : JSON.stringify(input),
          },
        ),
        { params: Promise.resolve({ path: [path] }) },
      );
      return { status: response.status, data: await response.json() };
    };
    const stored = await read(f.activity);
    assert.equal((await avatarApi("upload", {})).status, 403);
    assert.equal((await avatarApi(asset)).status, 404);
    if (kind === "mini")
      assert.equal((await avatarApi("review", { assetId: asset })).status, 403);
    const input = {
      epoch: stored.epoch,
      command: {
        type: "avatar",
        assetId: asset,
        avatarId: "female_02",
        allowScreen: true,
        expectedVersion: 0,
      },
    };
    assert.equal((await avatarApi("command", input)).status, 403);
    assert.equal(
      (
        await avatarApi("command", {
          ...input,
          command: { ...input.command, assetId: randomUUID() },
        })
      ).status,
      403,
    );
    const mobile = await f.api("snapshot");
    assert.equal(mobile.data.state.participants[0].photo, null);
    assert.equal(
      (await snapshot(f.activity, "operator", operator)).state!.participants[0]
        .photo,
      null,
    );
    assert.ok(
      !JSON.stringify(worldProjection(stored, f.activity)).includes(asset),
    );
    const saved = await avatarApi("command", {
      ...input,
      command: { ...input.command, assetId: null, allowScreen: false },
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.equal(saved.data.state.participants[0].avatarId, "female_02");
    assert.equal(saved.data.state.participants[0].photo, null);
    const after = await read(f.activity);
    assert.deepEqual(after.participants[0].photo, stored.participants[0].photo);
    assert.deepEqual(
      (
        await database().query(
          "SELECT bytes FROM dl_avatar_assets WHERE id=$1",
          [asset],
        )
      ).rows[0].bytes,
      bytes,
    );
    await f.action("remove");
    assert.equal(
      (await f.api("rejoin", { actor: f.session.actor, epoch: stored.epoch }))
        .status,
      200,
    );
    assert.deepEqual(
      (
        await database().query(
          "SELECT bytes FROM dl_avatar_assets WHERE id=$1",
          [asset],
        )
      ).rows[0].bytes,
      bytes,
    );
  });
}
