import { test } from "node:test";
import assert from "node:assert/strict";
import { getAvatarById } from "../../src/config/avatars";
import { allowedAvatarSource } from "../../src/domain/photo";

test("versioned small system avatars stay public and legacy avatar paths remain valid", () => {
  for (const gender of ["male", "female"] as const) {
    for (let number = 1; number <= 10; number++) {
      const id = `${gender}_${String(number).padStart(2, "0")}`;
      const current = getAvatarById(id)?.src;
      assert.equal(current, `/assets/avatars-v520/${gender}/${id}.webp`);
      assert.ok(current && allowedAvatarSource(current));
      assert.ok(allowedAvatarSource(`/assets/avatars/${gender}/${id}.png`));
    }
  }
  assert.equal(allowedAvatarSource("/api/avatar/private-photo"), false);
  assert.equal(
    allowedAvatarSource("/assets/avatars-v520/unknown/avatar.webp"),
    false,
  );
  assert.equal(
    allowedAvatarSource("https://outside.example/avatar.webp"),
    false,
  );
});
