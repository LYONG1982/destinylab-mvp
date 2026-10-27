import { test } from "node:test";
import assert from "node:assert/strict";
import { trustedMiniSourceLimit } from "../../src/server/wechat-service";

test("trusted mini login source quota defaults to 300 and caps at 600", () => {
  const previous = process.env.DESTINY_MINI_SOURCE_LIMIT_PER_MINUTE;
  try {
    delete process.env.DESTINY_MINI_SOURCE_LIMIT_PER_MINUTE;
    assert.equal(trustedMiniSourceLimit(), 300);
    process.env.DESTINY_MINI_SOURCE_LIMIT_PER_MINUTE = "600";
    assert.equal(trustedMiniSourceLimit(), 600);
    for (const invalid of ["0", "601", "1.5", "NaN"]) {
      process.env.DESTINY_MINI_SOURCE_LIMIT_PER_MINUTE = invalid;
      assert.throws(() => trustedMiniSourceLimit(), /登录额度配置无效/);
    }
  } finally {
    if (previous === undefined)
      delete process.env.DESTINY_MINI_SOURCE_LIMIT_PER_MINUTE;
    else process.env.DESTINY_MINI_SOURCE_LIMIT_PER_MINUTE = previous;
  }
});
