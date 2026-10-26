import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyTongzhouProfile } from "../../src/domain/tongzhou";
import {
  mergeProfileDraft,
  profilePatch,
  profileProgress,
} from "../../src/domain/registration-profile";
test("profile draft merges disjoint edits and identifies overlapping values including explicit clear", () => {
  const base = {
    ...emptyTongzhouProfile(),
    occupation: "设计师",
    expectations: "真诚",
  };
  const draft = { ...base, occupation: "" };
  const merged = mergeProfileDraft(base, draft, {
    ...base,
    expectations: "认真相处",
  });
  assert.equal(merged.fields.occupation, "");
  assert.equal(merged.fields.expectations, "认真相处");
  assert.deepEqual(merged.conflicts, []);
  const clash = mergeProfileDraft(base, draft, { ...base, occupation: "教师" });
  assert.deepEqual(clash.conflicts, ["occupation"]);
  assert.deepEqual(
    profilePatch(base, { ...draft, expectations: "保留草稿" }, "life"),
    { occupation: "" },
  );
  assert.deepEqual(
    profileProgress({
      current: "invalid",
      visited: ["life", "fake"],
      saved: ["album"],
    }),
    { current: "life", visited: ["life"], saved: ["album"] },
  );
});
