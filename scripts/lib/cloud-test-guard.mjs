import { createHmac, timingSafeEqual } from "node:crypto";
export function cloudTestTarget(env) {
  const origin = env.DESTINY_CLOUD_TEST_ORIGIN;
  if (!origin || origin !== env.DESTINY_PUBLIC_URL)
    throw new Error("TEST_ORIGIN_MISMATCH");
  const u = new URL(origin);
  if (
    u.origin !== origin ||
    (u.protocol !== "https:" &&
      !(u.protocol === "http:" && u.hostname === "127.0.0.1"))
  )
    throw new Error("TEST_ORIGIN_INVALID");
  const name = decodeURIComponent(new URL(env.DATABASE_URL).pathname.slice(1));
  const activity = env.DESTINY_ACTIVITY_ID;
  const token = env.DESTINY_CLOUD_TEST_TOKEN;
  if (
    !/^[a-z0-9_]+_test$/.test(name) ||
    !/^cloudtest-[a-z0-9-]+$/.test(activity || "") ||
    !token ||
    token.length < 32
  )
    throw new Error("TEST_ISOLATION_REQUIRED");
  return {
    origin,
    activity,
    token,
    binding: createHmac("sha256", token)
      .update(`${origin}\n${name}\n${activity}`)
      .digest("hex"),
  };
}
export function verifyCloudTestBinding(target, response) {
  const proof = response?.testBinding;
  if (
    response?.ok !== true ||
    typeof proof !== "string" ||
    !/^[a-f0-9]{64}$/.test(proof) ||
    !timingSafeEqual(
      Buffer.from(proof, "hex"),
      Buffer.from(target.binding, "hex"),
    )
  )
    throw new Error("REMOTE_TEST_DATABASE_NOT_VERIFIED");
}
