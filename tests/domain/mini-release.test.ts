import test from "node:test";
import assert from "node:assert/strict";
import { validateMiniRelease } from "../../scripts/mini-release-config.mjs";
import { validateCloudEnvironment } from "../../scripts/cloud-validation.mjs";
test("mini release rejects visitor identity, reserved domains and missing privacy fields", () => {
  const env = {
    TARO_APP_ID: "wx1234567890abcdef",
    TARO_APP_API_ORIGIN: "https://uat.destinylab.cn",
    TARO_APP_PRIVACY_OWNER: "测试主体",
    TARO_APP_PRIVACY_CONTACT: "测试联系渠道",
  };
  assert.equal(validateMiniRelease(env).origin, env.TARO_APP_API_ORIGIN);
  for (const change of [
    { TARO_APP_ID: "touristappid" },
    { TARO_APP_ID: "wx0000000000000000" },
    { TARO_APP_API_ORIGIN: "http://192.168.1.1" },
    { TARO_APP_API_ORIGIN: "https://127.0.0.1" },
    { TARO_APP_API_ORIGIN: "https://api.example.com" },
    { TARO_APP_API_ORIGIN: "https://app.invalid" },
    { TARO_APP_API_ORIGIN: "https://localhost" },
    { TARO_APP_API_ORIGIN: "https://uat.destinylab.cn/path" },
    { TARO_APP_PRIVACY_OWNER: "" },
    { TARO_APP_PRIVACY_CONTACT: "" },
  ])
    assert.throws(() => validateMiniRelease({ ...env, ...change }));
});
test("cloud mini startup rejects missing content callbacks and test bypass", () => {
  const env = {
    DESTINY_DATA_MODE: "server",
    DESTINY_PUBLIC_URL: "https://uat.destinylab.cn",
    DESTINY_MINI_ENABLED: "true",
    DESTINY_WECHAT_APPID: "wx1234567890abcdef",
  };
  assert.throws(
    () => validateCloudEnvironment(env),
    /CLOUD_WECHAT_CONTENT_REQUIRED/,
  );
  assert.throws(
    () =>
      validateCloudEnvironment({
        ...env,
        DESTINY_MINI_MODERATION: "local-test",
      }),
    /CLOUD_WECHAT_CONTENT_REQUIRED/,
  );
});
