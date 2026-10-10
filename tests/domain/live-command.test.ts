import test from "node:test";
import assert from "node:assert/strict";
import { validateLiveCommand } from "@/server/validate-command";

test("participant commands are allowlisted, typed, and returned without extras", () => {
  assert.deepEqual(
    validateLiveCommand(
      { type: "answer", questionId: "q1", value: "一起逛逛" },
      "participant",
    ),
    { type: "answer", questionId: "q1", value: "一起逛逛" },
  );
  assert.deepEqual(
    validateLiveCommand(
      { type: "display-consent", invitationId: "inv-abc_123", allow: false },
      "participant",
    ),
    { type: "display-consent", invitationId: "inv-abc_123", allow: false },
  );
  assert.deepEqual(
    validateLiveCommand(
      {
        type: "profile",
        name: "小林",
        gender: "female",
        avatarId: "female_02",
        age: "26–29",
        ready: true,
      },
      "participant",
    ),
    {
      type: "profile",
      name: "小林",
      gender: "female",
      avatarId: "female_02",
      age: "26–29",
      ready: true,
    },
  );
});

test("operator commands are allowlisted and validate public display question", () => {
  assert.deepEqual(
    validateLiveCommand(
      { type: "participant", participantId: "participant-01", action: "hint" },
      "operator",
    ),
    { type: "participant", participantId: "participant-01", action: "hint" },
  );
  assert.deepEqual(
    validateLiveCommand(
      { type: "display-question", questionId: "q1" },
      "operator",
    ),
    { type: "display-question", questionId: "q1" },
  );
  assert.deepEqual(
    validateLiveCommand({ type: "point-add", name: "Meet01" }, "operator"),
    { type: "point-add", name: "Meet01" },
  );
  assert.deepEqual(
    validateLiveCommand({ type: "point-add", name: "Meet123" }, "operator"),
    { type: "point-add", name: "Meet123" },
  );
  assert.deepEqual(
    validateLiveCommand(
      { type: "merchant", merchantId: "cloud", active: false },
      "operator",
    ),
    { type: "merchant", merchantId: "cloud", active: false },
  );
});

test("role forgery and commands outside each role allowlist are rejected", () => {
  assert.throws(
    () => validateLiveCommand({ type: "pause", value: true }, "participant"),
    /参与者不能执行/,
  );
  assert.throws(
    () =>
      validateLiveCommand(
        { type: "answer", questionId: "q1", value: "一起逛逛" },
        "operator",
      ),
    /运营人员不能执行/,
  );
  assert.throws(
    () =>
      validateLiveCommand({ type: "point-add", name: "Meet01" }, "participant"),
    /参与者不能执行/,
  );
  for (const type of [
    "advance",
    "broadcast-consume",
    "sweep",
    "tongzhou-submit",
    "unknown",
  ]) {
    assert.throws(
      () => validateLiveCommand({ type }, "operator"),
      /运营人员不能执行/,
    );
    assert.throws(
      () => validateLiveCommand({ type }, "participant"),
      /参与者不能执行/,
    );
  }
});

test("forged actor, command id, prototype fields, and unexpected keys are rejected", () => {
  for (const extra of [
    "actor",
    "id",
    "prototype",
    "constructor",
    "__proto__",
  ]) {
    const command = Object.assign(Object.create(null), {
      type: "ready",
      value: true,
      [extra]: "operator",
    });
    assert.throws(
      () => validateLiveCommand(command, "participant"),
      /不允许的字段/,
    );
  }
  assert.throws(
    () =>
      validateLiveCommand(
        Object.create({ type: "ready", value: true }),
        "participant",
      ),
    /原型无效/,
  );
});

test("invalid enums, values, IDs, booleans, and overlong strings are rejected", () => {
  const invalidCommands: unknown[] = [
    { type: "answer", questionId: "q99", value: "一起逛逛" },
    { type: "answer", questionId: "q1", value: "随便" },
    {
      type: "profile",
      name: "A",
      gender: "female",
      avatarId: "female_01",
      age: "26–29",
      ready: true,
    },
    {
      type: "profile",
      name: "小林",
      gender: "female",
      avatarId: "male_01",
      age: "26–29",
      ready: true,
    },
    {
      type: "profile",
      name: "小林",
      gender: "female",
      avatarId: "female_01",
      age: "99",
      ready: true,
    },
    { type: "ready", value: "true" },
    { type: "invite", targetId: "bad id" },
    { type: "invite", targetId: "x".repeat(121) },
    { type: "display-consent", invitationId: "inv-123", allow: 1 },
    { type: "next", invitationId: "inv-123", choice: "FLY" },
    { type: "participant", participantId: "p-1", action: "delete" },
  ];
  for (const command of invalidCommands) {
    assert.throws(() => validateLiveCommand(command, "participant"));
  }
  assert.throws(
    () =>
      validateLiveCommand(
        { type: "help-status", helpId: "help-1", status: "NEW" },
        "operator",
      ),
    /帮助状态无效/,
  );
  for (const name of ["Meet1", "Meet1234", "MeetAA", "meet01", "Meet 01"]) {
    assert.throws(
      () => validateLiveCommand({ type: "point-add", name }, "operator"),
      /Meet 加 2 至 3 位数字/,
    );
  }
  assert.throws(
    () =>
      validateLiveCommand(
        { type: "point-add", name: "Meet01", pointId: "Meet02" },
        "operator",
      ),
    /不允许的字段/,
  );
  assert.throws(
    () =>
      validateLiveCommand(
        { type: "display-question", questionId: "q2" },
        "operator",
      ),
    /仅允许展示 q1/,
  );
});

test("command objects with accessors or non-plain prototypes are rejected", () => {
  const accessor = { type: "ready" } as Record<string, unknown>;
  Object.defineProperty(accessor, "value", {
    enumerable: true,
    get: () => true,
  });
  assert.throws(
    () => validateLiveCommand(accessor, "participant"),
    /普通可枚举数据/,
  );
  assert.throws(() => validateLiveCommand([], "participant"), /必须是对象/);
});
