import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultPublicFields,
  publicProfile,
  safePublicProfile,
  validateAgencyDraft,
} from "../../src/domain/agency";
import { emptyTongzhouProfile } from "../../src/domain/tongzhou";
const draft = {
  note: "private",
  signed: false,
  service: "none" as const,
  nickname: "林间",
  code: "TZ-123",
  intro: "喜欢散步",
  fields: [...defaultPublicFields(), "realName", "phone"],
};
test("new and legacy publication requests cannot expose real name or phone", () => {
  assert.ok(!defaultPublicFields().includes("phone"));
  assert.ok(!defaultPublicFields().includes("realName"));
  const checked = validateAgencyDraft(draft);
  assert.deepEqual(checked.fields, defaultPublicFields());
  const result = publicProfile(
    {
      ...emptyTongzhouProfile(),
      realName: "PRIVATE-NAME",
      phone: "13800001111",
      city: "上海",
    },
    draft,
    false,
  );
  assert.equal(result.title, "林间");
  assert.deepEqual(result.items, [
    { key: "city", label: "所在城市", value: "上海" },
  ]);
  const legacy = safePublicProfile({
    ...result,
    items: [
      ...result.items,
      { key: "realName", label: "姓名", value: "PRIVATE-NAME" },
      { key: "phone", label: "手机号", value: "13800001111" },
      { key: "note", label: "备注", value: "PRIVATE-NOTE" },
    ],
  });
  assert.deepEqual(legacy, result);
  assert.equal(
    publicProfile(emptyTongzhouProfile(), { ...draft, nickname: "" }, false)
      .title,
    "",
  );
});

test("legacy code titles disappear while nicknames and internal identifiers remain", () => {
  const legacy = safePublicProfile({
    title: "TZ-172BFE5B528E",
    code: "TZ-172BFE5B528E",
    photo: false,
    items: [],
  });
  assert.equal(legacy.title, "");
  assert.equal(legacy.code, "TZ-172BFE5B528E");
  assert.equal(safePublicProfile({ ...legacy, title: "清风" }).title, "清风");
});
