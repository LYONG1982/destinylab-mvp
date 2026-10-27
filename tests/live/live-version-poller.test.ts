import { test } from "node:test";
import assert from "node:assert/strict";
import { createLiveVersionPoller } from "../../src/server/live-version-poller";

async function until(predicate: () => boolean, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("条件等待超时");
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

test("100 subscribers share one activity query and the final unsubscribe stops polling", async () => {
  let queries = 0,
    revision = 1;
  const poller = createLiveVersionPoller({
    intervalMs: 10,
    readRevision: async () => {
      queries++;
      return revision;
    },
  });
  const seen = Array.from({ length: 100 }, () => new Set<number>());
  const unsubscribe = seen.map((revisions) =>
    poller.subscribe("load-520-unit", (next) => {
      if (next !== null) revisions.add(next);
    }),
  );
  await until(() => seen.every((revisions) => revisions.has(1)));
  assert.ok(
    queries < 10,
    `expected shared polling, observed ${queries} queries`,
  );
  revision = 2;
  await until(() => seen.every((revisions) => revisions.has(2)));
  assert.ok(queries < 15, `expected one query per poll, observed ${queries}`);
  unsubscribe.forEach((close) => close());
  const stoppedAt = queries;
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(queries, stoppedAt);
  assert.equal(poller.activeActivityCount(), 0);
});

test("a transient database error backs off and retries without dropping subscribers", async () => {
  let queries = 0;
  const errors: unknown[] = [];
  const received: number[] = [];
  const poller = createLiveVersionPoller({
    intervalMs: 10,
    readRevision: async () => {
      queries++;
      if (queries === 1) throw new Error("temporary database failure");
      return 7;
    },
    onError: (_activity, error) => errors.push(error),
  });
  const unsubscribe = poller.subscribe("load-520-retry", (revision) => {
    if (revision !== null) received.push(revision);
  });
  await until(() => received.includes(7));
  assert.equal(queries, 2);
  assert.equal(errors.length, 1);
  assert.deepEqual(received, [7]);
  unsubscribe();
  assert.equal(poller.activeActivityCount(), 0);
});

test("different activities poll and notify independently", async () => {
  const revisions = new Map([
    ["load-520-a", 3],
    ["load-520-b", 8],
  ]);
  const reads = new Map<string, number>();
  const received = new Map<string, number[]>();
  const poller = createLiveVersionPoller({
    intervalMs: 10,
    readRevision: async (activity) => {
      reads.set(activity, (reads.get(activity) || 0) + 1);
      return revisions.get(activity) ?? null;
    },
  });
  const closeA = poller.subscribe("load-520-a", (revision) => {
    if (revision !== null)
      received.set("load-520-a", [
        ...(received.get("load-520-a") || []),
        revision,
      ]);
  });
  const closeB = poller.subscribe("load-520-b", (revision) => {
    if (revision !== null)
      received.set("load-520-b", [
        ...(received.get("load-520-b") || []),
        revision,
      ]);
  });
  await until(
    () =>
      received.get("load-520-a")?.includes(3) === true &&
      received.get("load-520-b")?.includes(8) === true,
  );
  assert.equal(reads.get("load-520-a"), 1);
  assert.equal(reads.get("load-520-b"), 1);
  revisions.set("load-520-a", 4);
  revisions.set("load-520-b", 9);
  await until(
    () =>
      received.get("load-520-a")?.includes(4) === true &&
      received.get("load-520-b")?.includes(9) === true,
  );
  closeA();
  const readsA = reads.get("load-520-a");
  const readsB = reads.get("load-520-b");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(reads.get("load-520-a"), readsA);
  assert.ok((reads.get("load-520-b") || 0) > readsB!);
  closeB();
  assert.equal(poller.activeActivityCount(), 0);
});
