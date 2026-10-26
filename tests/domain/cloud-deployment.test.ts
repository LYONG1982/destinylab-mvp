import test from "node:test";
import assert from "node:assert/strict";
import { validateCloudEnvironment } from "../../scripts/cloud-validation.mjs";
import {
  cloudTestTarget,
  verifyCloudTestBinding,
} from "../../scripts/lib/cloud-test-guard.mjs";
import { databaseOptions } from "../../src/server/database-options";
const env = {
  DESTINY_DATA_MODE: "server",
  DESTINY_PUBLIC_URL: "https://uat.example.invalid",
  DESTINY_CLOUD_TEST_ORIGIN: "https://uat.example.invalid",
  DATABASE_URL: "postgres://user:pass@db/destiny_cloud_test",
  DESTINY_DATABASE_SSL: "verify-full",
  DESTINY_SESSION_SECRET: "s".repeat(32),
  DESTINY_OPERATOR_PASSWORD_HASH: `scrypt$${"a".repeat(32)}$${"b".repeat(128)}`,
  DESTINY_ACTIVITY_ID: "cloudtest-guard",
  DESTINY_CLOUD_TEST_TOKEN: "t".repeat(32),
};
test("cloud public runtime rejects insecure transport and acceptance test token", () => {
  validateCloudEnvironment(env);
  for (const change of [
    { DESTINY_DATABASE_SSL: "disable" },
    { DESTINY_ALLOW_LAN_HTTP: "true" },
    { DESTINY_PUBLIC_URL: "http://example.invalid" },
    { DESTINY_PUBLIC_URL: "https://uat.example.invalid/path" },
    { DATABASE_URL: "postgres://user:pass@db/destiny_uat" },
    { DESTINY_SESSION_SECRET: "short" },
  ])
    assert.throws(() => validateCloudEnvironment({ ...env, ...change }));
});
test("test writes require origin, independent database and actual remote binding", () => {
  const target = cloudTestTarget(env);
  verifyCloudTestBinding(target, { ok: true, testBinding: target.binding });
  for (const change of [
    { DESTINY_CLOUD_TEST_ORIGIN: "https://other.invalid" },
    { DATABASE_URL: "postgres://user:pass@db/destiny_uat" },
    { DESTINY_ACTIVITY_ID: "meet" },
    { DESTINY_CLOUD_TEST_TOKEN: "" },
  ])
    assert.throws(() => cloudTestTarget({ ...env, ...change }));
  for (const response of [
    { ok: true },
    { ok: true, testBinding: "f".repeat(64) },
    { ok: false, testBinding: target.binding },
  ])
    assert.throws(() => verifyCloudTestBinding(target, response));
  const wrongDb = cloudTestTarget({
    ...env,
    DATABASE_URL: "postgres://user:pass@db/another_test",
  });
  assert.throws(() =>
    verifyCloudTestBinding(target, { ok: true, testBinding: wrongDb.binding }),
  );
});
test("pg TLS verifies certificates and cannot be overridden by URL options", () => {
  assert.deepEqual(databaseOptions(env.DATABASE_URL, env).ssl, {
    rejectUnauthorized: true,
  });
  assert.throws(() =>
    databaseOptions(`${env.DATABASE_URL}?sslmode=no-verify`, env),
  );
  assert.throws(() =>
    databaseOptions(env.DATABASE_URL, {
      ...env,
      DESTINY_DATABASE_POOL_MAX: "100",
    }),
  );
  assert.equal(
    databaseOptions(env.DATABASE_URL, {
      ...env,
      DESTINY_DATABASE_SSL: "disable",
    }).ssl,
    false,
  );
});
