import test from "node:test";
import assert from "node:assert/strict";
import { createSeed } from "@/data/seed";
import { applyCommand } from "@/domain/commands";
import { screenProjection, recommendations } from "@/domain/selectors";
import { ScreenAdapter } from "@/components/motion/screen/model";
import {
  authorizedTongzhouSubmissions,
  emptyTongzhouProfile,
  ownTongzhouSubmission,
  readTongzhouSubmissions,
  TONGZHOU_CONSENT_VERSION,
  validateTongzhouProfile,
  type TongzhouProfile,
} from "@/domain/tongzhou";
import type { Command, DemoState } from "@/domain/types";
const A = "p-shanfeng",
  B = "p-xiaoman";
const profile = (): TongzhouProfile => ({
  ...emptyTongzhouProfile(),
  realName: "虚构填报甲",
  phone: "13800000000",
  gender: "男",
  birthYear: "1995",
  ethnicity: "回族",
  city: "演示城市",
  maritalStatus: "未婚",
});
let sequence = 0;
function run(s: DemoState, c: Command, actor = A, id = `tz-${sequence++}`) {
  return applyCommand(s, { command: c, actor, id, epoch: s.epoch }, s.now);
}
function submit(
  s: DemoState,
  actor = A,
  fields = profile(),
  version = ownTongzhouSubmission(s, actor)?.version || 0,
) {
  return run(
    s,
    {
      type: "tongzhou-submit",
      fields,
      consent: true,
      consentVersion: TONGZHOU_CONSENT_VERSION,
      expectedVersion: version,
    },
    actor,
  );
}

test("consent and all seven basic fields are required, optional answers may remain blank", () => {
  const s = createSeed("discover");
  for (const key of [
    "realName",
    "phone",
    "gender",
    "birthYear",
    "city",
    "maritalStatus",
    "ethnicity",
  ] as const) {
    assert.throws(() => submit(s, A, { ...profile(), [key]: "   " }));
    assert.equal(s.tongzhouSubmissions.length, 0);
  }
  for (const consent of [false, true])
    assert.throws(
      () =>
        run(s, {
          type: "tongzhou-submit",
          fields: profile(),
          consent,
          consentVersion: consent ? "stale" : TONGZHOU_CONSENT_VERSION,
          expectedVersion: 0,
        }),
      /授权/,
    );
  assert.equal(submit(s).tongzhouSubmissions[0].fields!.height, "");
  assert.equal(emptyTongzhouProfile().ethnicity, "");
  assert.equal(
    validateTongzhouProfile({ ...profile(), ethnicity: "  自填民族  " }).fields
      .ethnicity,
    "自填民族",
  );
});

test("format, lengths, enum and optional-field validation protect every write; unknown properties are discarded", () => {
  const s = createSeed("discover");
  for (const patch of [
    { phone: "138" },
    { birthYear: "95" },
    { birthYear: "2020" },
    { height: "abc" },
    { height: "251" },
    { maritalStatus: "已婚" },
    { expectations: "长".repeat(301) },
    { income: "伪造选项" },
    { ethnicity: "字".repeat(31) },
  ])
    assert.throws(() => submit(s, A, { ...profile(), ...patch }));
  const next = submit(s, A, {
    ...profile(),
    answers: { q1: "私密字段" },
    photo: "data:image/png",
  } as TongzhouProfile);
  assert.equal("answers" in next.tongzhouSubmissions[0].fields!, false);
  assert.equal("photo" in next.tongzhouSubmissions[0].fields!, false);
  assert.notEqual(next, s);
});

test("self-only commands, fixed agency access, one current record and idempotent retry", () => {
  const original = createSeed("discover");
  for (const actor of ["operator", "tongzhou", "unknown"])
    assert.throws(() => submit(original, actor), /本人/);
  let s = submit(original);
  const first = s.tongzhouSubmissions[0];
  s = submit(s, A, { ...profile(), city: "新城市" });
  assert.equal(s.tongzhouSubmissions.length, 1);
  assert.equal(s.tongzhouSubmissions[0].submittedAt, first.submittedAt);
  const second = submit(s, B, { ...profile(), realName: "虚构填报乙" });
  assert.equal(
    ownTongzhouSubmission(second, A)!.fields!.realName,
    "虚构填报甲",
  );
  assert.equal(authorizedTongzhouSubmissions(second, A).length, 0);
  assert.equal(authorizedTongzhouSubmissions(second, "operator").length, 0);
  assert.equal(authorizedTongzhouSubmissions(second, "tongzhou").length, 2);
  const command: Command = { type: "tongzhou-delete", expectedVersion: 2 };
  s = run(s, command, A, "same-command");
  assert.equal(run(s, command, A, "same-command"), s);
});

test("withdraw/delete immediately revoke agency access and stale writes cannot resurrect personal information", () => {
  let s = submit(createSeed("discover"));
  s = run(s, { type: "tongzhou-withdraw", expectedVersion: 1 });
  assert.equal(authorizedTongzhouSubmissions(s, "tongzhou").length, 0);
  assert.equal(ownTongzhouSubmission(s, A)!.fields!.realName, "虚构填报甲");
  assert.throws(() => submit(s, A, profile(), 1), /其他页面更新/);
  s = run(s, { type: "tongzhou-delete", expectedVersion: 2 });
  assert.equal(ownTongzhouSubmission(s, A)!.fields, null);
  assert.equal(JSON.stringify(s).includes("虚构填报甲"), false);
  assert.equal(JSON.stringify(s).includes("13800000000"), false);
  assert.throws(() => submit(s, A, profile(), 2), /其他页面更新/);
  s = submit(s, A, profile(), 3);
  assert.equal(authorizedTongzhouSubmissions(s, "tongzhou").length, 1);
  assert.equal(s.tongzhouSubmissions.length, 1);
});

test("concurrent editors and reset epochs reject outdated commands without replacing current data", () => {
  const s = submit(createSeed("discover"));
  const newer = submit(s, A, { ...profile(), city: "已更新" }, 1);
  assert.throws(
    () => submit(newer, A, { ...profile(), city: "旧页面" }, 1),
    /其他页面更新/,
  );
  assert.equal(newer.tongzhouSubmissions[0].fields!.city, "已更新");
  const reset = createSeed("discover");
  assert.throws(
    () =>
      applyCommand(reset, {
        actor: A,
        epoch: s.epoch,
        id: "old",
        command: { type: "tongzhou-delete", expectedVersion: 1 },
      }),
    /场景已更新/,
  );
  assert.deepEqual(reset.tongzhouSubmissions, []);
});

test("old snapshots gain an empty collection without generating consent; invalid collections fail closed", () => {
  const s = createSeed("discover");
  delete (s as Partial<DemoState>).tongzhouSubmissions;
  assert.deepEqual(readTongzhouSubmissions(undefined), []);
  assert.equal(authorizedTongzhouSubmissions(s, "tongzhou").length, 0);
  assert.equal(submit(s).tongzhouSubmissions.length, 1);
  for (const bad of [null, {}, [null], [{ status: "active" }]])
    assert.throws(() => readTongzhouSubmissions(bad));
  const valid = submit(s).tongzhouSubmissions;
  assert.deepEqual(readTongzhouSubmissions(valid), valid);
  assert.throws(() => readTongzhouSubmissions([...valid, ...valid]));
  assert.throws(() =>
    readTongzhouSubmissions([{ ...valid[0], status: "deleted" }]),
  );
});

test("submitting private data leaves public projections, statistics, invitations, events and avatars unchanged", () => {
  for (const scenario of ["discover", "waiting", "busy", "confirmed"]) {
    const s = createSeed(scenario);
    const snapshot = structuredClone(s);
    const next = submit(s);
    assert.deepEqual(s, snapshot);
    for (const key of [
      "participants",
      "invitations",
      "points",
      "events",
      "responses",
      "scans",
      "broadcastConsumed",
      "now",
      "wallAt",
    ] as const)
      assert.deepEqual(next[key], s[key]);
    assert.deepEqual(screenProjection(next), screenProjection(s));
    assert.deepEqual(recommendations(next, A), recommendations(s, A));
    const publicJSON = JSON.stringify(new ScreenAdapter().read(next));
    for (const forbidden of [
      "虚构填报甲",
      "13800000000",
      "回族",
      "tongzhouSubmissions",
      "ethnicity",
    ])
      assert.equal(publicJSON.includes(forbidden), false);
  }
});
