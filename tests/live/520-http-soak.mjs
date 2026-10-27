import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { emptyActivity } from "../../src/server/state.ts";
import { QUESTIONS, AGES } from "../../src/data/questions.ts";

const BASE_URL = "http://127.0.0.1:3244";
const PARTICIPANTS = 100;
const ENTRY_ROUNDS = 3;
const SOAK_MS = 30 * 60 * 1000;
const SAMPLE_MS = 60 * 1000;
const BURST_MS = 60 * 1000;
const ENTRY_REQUEST_TIMEOUT_MS = 60 * 1000;
const SSE_CONNECT_TIMEOUT_MS = 15 * 1000;
const MAX_ENTRY_PHASE_MS = 8 * 60 * 1000;
const MAX_SOAK_PHASE_MS = 34 * 60 * 1000;
const OUTER_TIMEOUT_MS = 45 * 60 * 1000;
const runtimeEnv = process.env.DESTINY_520_RUNTIME_ENV ||
  "/Users/lvyong198201/.local/share/destinylab/uat-520-20261026/runtime.env";
const outputDir = process.env.DESTINY_520_HTTP_SOAK_OUTPUT_DIR ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs/verification/2026-10-27-520-uat");
const protocol = "520-v1";
const question = QUESTIONS.find((item) => item.id === "q1");
const chineseDigits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
const runAbort = new AbortController();
let lastCpuUsage = process.cpuUsage();
if (!question) throw new Error("q1 fixture unavailable");

let pool;
let report;
let heartbeat;
let activeSse = new Set();
let allSse = [];
let stopSse = false;
const streams = { opened: 0, reconnects: 0, forcedDisconnects: 0, failedOpens: 0, active: 0, peakActive: 0, revisions: 0, lastRevision: null, errors: [] };
const host = {
  hostname: os.hostname(),
  platform: `${os.platform()} ${os.release()}`,
  arch: os.arch(),
  cpuModel: os.cpus()[0]?.model || "unknown",
  logicalCpuCount: os.cpus().length,
  totalMemoryBytes: os.totalmem(),
};

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] : null;
}
function summarize(values) {
  return { count: values.length, p50Ms: percentile(values, .5), p95Ms: percentile(values, .95), p99Ms: percentile(values, .99), maxMs: values.length ? Math.max(...values) : null };
}
function safeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[REDACTED_DATABASE_URL]")
    .replace(/[A-Za-z0-9_-]{43}/g, "[REDACTED_TOKEN]")
    .slice(0, 400);
}
function activityId() {
  return `soak520-${randomUUID().replaceAll("-", "").slice(0, 20)}`;
}
function cookieFrom(response, activity) {
  const raw = response.headers.get("set-cookie") || "";
  const name = `dl-participant-${activity}=`;
  const part = raw.split(";").find((item) => item.trim().startsWith(name));
  const token = part?.trim().slice(name.length);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("Entry response omitted a valid participant cookie");
  return `${name}${token}`;
}
function assertEnvironment() {
  if (process.env.DESTINY_PUBLIC_URL !== BASE_URL) throw new Error(`DESTINY_PUBLIC_URL must equal ${BASE_URL}`);
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL missing from protected runtime fixture");
  const dbUrl = new URL(process.env.DATABASE_URL);
  if (!["127.0.0.1", "localhost"].includes(dbUrl.hostname) || dbUrl.pathname.slice(1) !== "destinylab_520_uat_test")
    throw new Error("Database guard requires local database destinylab_520_uat_test");
}
async function saveReport() {
  report.updatedAt = new Date().toISOString();
  report.host.generatorRssBytes = process.memoryUsage().rss;
  report.host.generatorHeapUsedBytes = process.memoryUsage().heapUsed;
  await writeFile(path.join(outputDir, "520-http-soak-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(path.join(outputDir, "520-http-soak-progress.json"), `${JSON.stringify({
    updatedAt: report.updatedAt,
    status: report.status,
    phase: report.phase,
    elapsedSeconds: report.startedAt ? Math.round((Date.now() - Date.parse(report.startedAt)) / 1000) : 0,
    completedEntryRounds: report.entryRounds.filter((round) => round.completedAt).length,
    entryRounds: report.entryRounds.map((round) => ({ activity: round.activity, succeeded: round.succeeded, failed: round.failed, latency: round.latency })),
    soak: report.soak ? { observedSeconds: report.soak.observedSeconds, bursts: report.soak.bursts, stream: { ...streams, errors: streams.errors.slice(-8) }, latestSample: report.soak.samples.at(-1), status: report.soak.status } : null,
    errors: report.errors.slice(-8),
  }, null, 2)}\n`);
}
function serverProcessSample() {
  try {
    const pid = execFileSync("lsof", ["-nP", "-iTCP:3244", "-sTCP:LISTEN", "-t"], { encoding: "utf8", timeout: 2000, maxBuffer: 1024 }).trim().split(/\s+/)[0];
    if (!/^\d+$/.test(pid || "")) return { status: "listener_pid_unavailable" };
    const raw = execFileSync("ps", ["-p", pid, "-o", "%cpu=,rss=,etime="], { encoding: "utf8", timeout: 2000, maxBuffer: 1024 }).trim();
    const [cpu, rssKb, elapsed] = raw.split(/\s+/);
    return { pid: Number(pid), cpuPercent: Number(cpu), rssBytes: Number(rssKb) * 1024, elapsed };
  } catch { return { status: "unavailable" }; }
}
function macMemoryPressureSample() {
  if (os.platform() !== "darwin") return { status: "unsupported_platform" };
  try {
    const pressure = execFileSync("memory_pressure", ["-Q"], { encoding: "utf8", timeout: 3000, maxBuffer: 2048 });
    const freePercent = pressure.match(/System-wide memory free percentage:\s*(\d+)%/i)?.[1];
    const swap = execFileSync("sysctl", ["vm.swapusage"], { encoding: "utf8", timeout: 2000, maxBuffer: 1024 });
    return { freePercent: freePercent ? Number(freePercent) : null, swapSummary: swap.trim().slice(0, 180) };
  } catch { return { status: "unavailable" }; }
}
async function databaseSample() {
  try {
    const result = await pool.query(`SELECT current_database() AS database,
      count(*)::int AS total,
      count(*) FILTER (WHERE state='active')::int AS active,
      count(*) FILTER (WHERE wait_event_type IS NOT NULL)::int AS wait_event_sessions,
      count(*) FILTER (WHERE wait_event_type='Lock')::int AS lock_waiting,
      current_setting('max_connections')::int AS max_connections
      FROM pg_stat_activity WHERE datname=current_database()`);
    return result.rows[0];
  } catch (error) { return { status: "unavailable", errorCode: error?.code || "unknown" }; }
}
async function createActivity() {
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = activityId();
    const result = await pool.query("INSERT INTO dl_activities(id,state) VALUES($1,$2::jsonb) ON CONFLICT(id) DO NOTHING RETURNING id", [id, JSON.stringify(emptyActivity())]);
    if (result.rowCount === 1) return id;
  }
  throw new Error("Could not create isolated synthetic activity");
}
function sessionUrl(activity) { return `${BASE_URL}/api/live/session?activity=${encodeURIComponent(activity)}&audience=participant`; }
function endpoint(activity, name, audience = "participant") { return `${BASE_URL}/api/live/${name}?activity=${encodeURIComponent(activity)}&audience=${audience}`; }
async function enter(activity, entryKey) {
  const started = performance.now();
  const response = await fetch(sessionUrl(activity), {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE_URL, "x-destiny-entry-key": entryKey, "x-destiny-protocol": protocol },
    body: JSON.stringify({ enter: true }),
    signal: AbortSignal.any([AbortSignal.timeout(ENTRY_REQUEST_TIMEOUT_MS), runAbort.signal]),
  });
  const text = await response.text();
  if (!response.ok) throw Object.assign(new Error(`Entry HTTP ${response.status}: ${text.slice(0, 180)}`), { status: response.status });
  const snapshot = JSON.parse(text);
  if (typeof snapshot.actor !== "string" || !snapshot.state?.epoch) throw new Error("Entry response missing actor or epoch");
  const durationMs = performance.now() - started;
  return { actor: snapshot.actor, epoch: snapshot.state.epoch, cookie: cookieFrom(response, activity), durationMs };
}
async function runEntryRound(index) {
  const activity = await createActivity();
  const round = { index: index + 1, activity, startedAt: new Date().toISOString(), succeeded: 0, failed: 0, errors: [], httpStatusCounts: {}, durations: [], actors: [], completedAt: null };
  report.entryRounds.push(round);
  await saveReport();
  const entries = await Promise.all(Array.from({ length: PARTICIPANTS }, async (_, person) => {
    const key = randomUUID();
    try {
      const first = await enter(activity, key);
      let entry = first;
      if (index === 0 && person === 0) {
        // Drop the already committed response at the client boundary, then retry the same idempotency key.
        const retry = await enter(activity, key);
        if (retry.actor !== first.actor || retry.cookie !== first.cookie) throw new Error("Idempotency retry created a new identity or token");
        round.idempotencyProbe = { result: "passed", sameActor: true, sameCookie: true, firstResponseClientDiscarded: true, retryLatencyMs: retry.durationMs };
        entry = retry;
      }
      round.succeeded++;
      round.durations.push(first.durationMs);
      round.actors.push(entry.actor);
      return { ...entry, activity };
    } catch (error) {
      round.failed++;
      const status = Number(error?.status) || "transport_or_validation";
      round.httpStatusCounts[status] = (round.httpStatusCounts[status] || 0) + 1;
      round.errors.push(safeError(error));
      return null;
    }
  }));
  round.latency = summarize(round.durations);
  round.uniqueActors = new Set(round.actors).size;
  round.duplicateActorCount = round.actors.length - round.uniqueActors;
  round.completedAt = new Date().toISOString();
  const state = await pool.query("SELECT state FROM dl_activities WHERE id=$1", [activity]);
  round.databaseParticipants = state.rows[0]?.state?.participants?.length ?? null;
  round.databaseUniqueActors = new Set((state.rows[0]?.state?.participants || []).map((item) => item.id)).size;
  round.p95Under2Seconds = round.latency.p95Ms !== null && round.latency.p95Ms <= 2000;
  round.passed = round.succeeded === PARTICIPANTS && round.failed === 0 && round.uniqueActors === PARTICIPANTS && round.duplicateActorCount === 0 && round.databaseParticipants === PARTICIPANTS && round.databaseUniqueActors === PARTICIPANTS && round.p95Under2Seconds && (index !== 0 || round.idempotencyProbe?.result === "passed");
  await saveReport();
  return entries;
}
async function readRevision(client, chunk) {
  const text = new TextDecoder().decode(chunk, { stream: true });
  client.parseBuffer = `${client.parseBuffer || ""}${text}`;
  const lines = client.parseBuffer.split("\n");
  client.parseBuffer = lines.pop() || "";
  for (const line of lines) {
    const match = /^id: (\d+)$/.exec(line);
    if (!match) continue;
    const revision = Number(match[1]);
    if (Number.isSafeInteger(revision)) {
      streams.revisions++;
      streams.lastRevision = Math.max(streams.lastRevision ?? -1, revision);
      client.lastRevision = Math.max(client.lastRevision ?? -1, revision);
    }
  }
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function connectSse(client) {
  const controller = new AbortController();
  client.controller = controller;
  let response;
  let connectTimer;
  try {
    response = await Promise.race([
      fetch(endpoint(client.activity, "events", client.role || "participant"), {
        headers: client.cookie ? { cookie: client.cookie, "x-destiny-actor": client.actor } : {},
        signal: controller.signal,
      }),
      new Promise((_, reject) => { connectTimer = setTimeout(() => { controller.abort(); reject(new Error("SSE connect timeout")); }, SSE_CONNECT_TIMEOUT_MS); }),
    ]);
    clearTimeout(connectTimer);
    if (!response.ok || !response.headers.get("content-type")?.includes("text/event-stream")) throw new Error(`SSE HTTP ${response.status}`);
    streams.opened++;
    if (client.openedBefore) streams.reconnects++;
    client.openedBefore = true;
    streams.active++;
    streams.peakActive = Math.max(streams.peakActive, streams.active);
    activeSse.add(client);
    const reader = response.body.getReader();
    try {
      while (!stopSse && !controller.signal.aborted) {
        const item = await reader.read();
        if (item.done) break;
        await readRevision(client, item.value);
      }
    } finally {
      try { await reader.cancel(); } catch {}
    }
  } catch (error) {
    clearTimeout(connectTimer);
    if (!stopSse && !controller.signal.aborted) {
      streams.failedOpens++;
      streams.errors.push(safeError(error));
      if (streams.errors.length > 40) streams.errors.shift();
    }
  } finally {
    if (activeSse.delete(client)) streams.active--;
    if (client.controller === controller) client.controller = null;
  }
}
async function sseWorker(client) {
  while (!stopSse) {
    await connectSse(client);
    if (!stopSse) await sleep(150 + Math.floor(Math.random() * 350));
  }
}
async function command(entry, command) {
  const response = await fetch(endpoint(entry.activity, "command"), {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE_URL, cookie: entry.cookie, "x-destiny-actor": entry.actor, "x-destiny-protocol": protocol, "idempotency-key": randomUUID() },
    body: JSON.stringify({ epoch: entry.epoch, command }),
    signal: AbortSignal.any([AbortSignal.timeout(ENTRY_REQUEST_TIMEOUT_MS), runAbort.signal]),
  });
  const body = await response.text();
  if (!response.ok) throw Object.assign(new Error(`Command HTTP ${response.status}: ${body.slice(0, 160)}`), { status: response.status });
  return JSON.parse(body);
}
async function waitForClientRevisions(clients, revision, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (clients.every((client) => client.lastRevision !== undefined && client.lastRevision >= revision)) return true;
    await sleep(100);
  }
  return false;
}
async function readOwnSnapshot(client) {
  const response = await fetch(endpoint(client.activity, "snapshot"), {
    headers: { cookie: client.cookie, "x-destiny-actor": client.actor },
    signal: AbortSignal.any([AbortSignal.timeout(ENTRY_REQUEST_TIMEOUT_MS), runAbort.signal]),
  });
  if (!response.ok) throw Object.assign(new Error(`Snapshot HTTP ${response.status}`), { status: response.status });
  return response.json();
}
async function runBurst(entries, burstIndex) {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const profileDurations = [], answerDurations = [];
  const errors = [];
  const expected = new Map();
  await Promise.all(entries.map(async (entry, index) => {
    try {
      const gender = index % 2 ? "female" : "male";
      const profileStart = performance.now();
      const syntheticName = `压测${String(index + 1).padStart(3, "0").replace(/\d/g, (digit) => chineseDigits[Number(digit)])}`;
      await command(entry, { type: "profile", name: syntheticName, gender, avatarId: `${gender}_${String(index % 10 + 1).padStart(2, "0")}`, age: AGES[index % AGES.length], ready: index % 2 === 0 });
      profileDurations.push(performance.now() - profileStart);
      const answerStart = performance.now();
      const answer = question.options[(index + burstIndex) % question.options.length];
      await command(entry, { type: "answer", questionId: "q1", value: answer });
      answerDurations.push(performance.now() - answerStart);
      expected.set(entry.actor, { name: syntheticName, answer });
    } catch (error) { errors.push(safeError(error)); }
  }));
  const burst = { index: burstIndex + 1, startedAt, durationMs: performance.now() - started, profile: summarize(profileDurations), answer: summarize(answerDurations), failures: errors.length, errors: errors.slice(0, 8) };
  report.soak.bursts.push(burst);
  report.soak.totalWriteFailures += errors.length;
  return { burst, expected };
}
async function takeSample(elapsedSeconds) {
  const cpu = process.cpuUsage(lastCpuUsage);
  lastCpuUsage = process.cpuUsage();
  const row = {
    elapsedSeconds,
    timestamp: new Date().toISOString(),
    activeSse: streams.active,
    openedSse: streams.opened,
    reconnects: streams.reconnects,
    forcedDisconnects: streams.forcedDisconnects,
    sseFailedOpens: streams.failedOpens,
    revisionsReceived: streams.revisions,
    generatorRssBytes: process.memoryUsage().rss,
    generatorHeapUsedBytes: process.memoryUsage().heapUsed,
    generatorCpuUserMsSincePreviousSample: Math.round(cpu.user / 1000),
    generatorCpuSystemMsSincePreviousSample: Math.round(cpu.system / 1000),
    freeMemoryBytes: os.freemem(),
    macMemoryPressure: macMemoryPressureSample(),
    serverProcess: serverProcessSample(),
    postgres: await databaseSample(),
  };
  report.soak.samples.push(row);
  await saveReport();
}
async function runSoak(entries) {
  const activity = await createActivity();
  entries = entries.slice(0, PARTICIPANTS).map((entry) => ({ ...entry, activity }));
  report.soak = { activity, status: "starting", startedAt: new Date().toISOString(), targetSeconds: SOAK_MS / 1000, observedSeconds: 0, totalWriteFailures: 0, bursts: [], samples: [], consistencyChecks: [] };
  await saveReport();
  const sessionEntries = await Promise.all(entries.map(async (original, index) => {
    try { return await enter(activity, randomUUID()); }
    catch (error) { report.soak.entryErrors = [...(report.soak.entryErrors || []), { index, error: safeError(error) }]; return null; }
  }));
  const usable = sessionEntries.filter(Boolean).map((entry) => ({ ...entry, activity }));
  report.soak.entrySucceeded = usable.length;
  if (usable.length !== PARTICIPANTS) throw new Error(`Soak setup reached ${usable.length}/${PARTICIPANTS} entries`);
  const sseClients = usable.map((entry, index) => ({ ...entry, index, lastRevision: undefined }));
  sseClients.push({ activity, index: 1000, lastRevision: undefined, role: "screen" });
  const workers = sseClients.map((client) => sseWorker(client));
  allSse = workers;
  const connectDeadline = Date.now() + 45000;
  const expectedConnections = PARTICIPANTS + 1;
  while (streams.active < expectedConnections && Date.now() < connectDeadline && streams.failedOpens < 20) {
    await sleep(250);
  }
  report.soak.initialActiveSse = streams.active;
  await takeSample(0);
  if (streams.active < expectedConnections) throw new Error(`Only ${streams.active}/${expectedConnections} participant plus screen SSE connections opened initially`);
  report.soak.status = "running";
  const start = Date.now();
  let nextBurst = start + 1000;
  let nextSample = start + SAMPLE_MS;
  let nextForcedDisconnect = start + 5 * 60 * 1000;
  let burstIndex = 0;
  let previousSnapshot = await pool.query("SELECT state FROM dl_activities WHERE id=$1", [activity]);
  const seenActors = new Set((previousSnapshot.rows[0]?.state?.participants || []).map((item) => item.id));
  let latestExpected = new Map();
  while (Date.now() - start < SOAK_MS) {
    const now = Date.now();
    report.soak.observedSeconds = (now - start) / 1000;
    if (now >= nextBurst) {
      const { burst, expected } = await runBurst(usable, burstIndex++);
      latestExpected = expected;
      report.soak.lastBurst = burst.index;
      nextBurst += BURST_MS;
      const current = await pool.query("SELECT state FROM dl_activities WHERE id=$1", [activity]);
      const state = current.rows[0]?.state;
      const actors = new Set((state?.participants || []).map((item) => item.id));
      const answersQ1 = (state?.participants || []).filter((item) => Boolean(item.answers?.q1)).length;
      const consistency = { timestamp: new Date().toISOString(), participants: actors.size, uniqueParticipants: actors.size, profilesComplete: (state?.participants || []).filter((item) => item.profileComplete).length, answeredQ1: answersQ1, responseMapQ1: Object.keys(state?.responses || {}).length, sseActive: streams.active, revision: state?.revision ?? null, newActors: [...actors].filter((actor) => !seenActors.has(actor)).length };
      report.soak.consistencyChecks.push(consistency);
      seenActors.clear(); for (const actor of actors) seenActors.add(actor);
      if (actors.size !== PARTICIPANTS || consistency.profilesComplete !== PARTICIPANTS || consistency.answeredQ1 !== PARTICIPANTS || consistency.responseMapQ1 !== PARTICIPANTS) throw new Error(`Database consistency failed after burst ${burst.index}`);
      burst.targetRevision = state?.revision ?? null;
      burst.sseCaughtUp = await waitForClientRevisions(sseClients, Number(state?.revision));
      if (!burst.sseCaughtUp) throw new Error(`SSE clients did not all receive revision ${state?.revision} after burst ${burst.index}`);
      const clientChecks = await Promise.all(sseClients.slice(0, PARTICIPANTS).map(async (client) => {
        const snapshot = await readOwnSnapshot(client);
        const own = (snapshot.state?.participants || []).find((participant) => participant.id === client.actor);
        const want = expected.get(client.actor);
        return Boolean(own && want && own.profileComplete && own.name === want.name && own.answers?.q1 === want.answer);
      }));
      burst.clientSnapshotChecks = { count: clientChecks.length, passed: clientChecks.filter(Boolean).length, failed: clientChecks.filter((ok) => !ok).length };
      if (burst.clientSnapshotChecks.passed !== PARTICIPANTS) throw new Error(`Participant snapshots inconsistent after burst ${burst.index}`);
      await saveReport();
    }
    if (now >= nextForcedDisconnect) {
      const chosen = [...activeSse].filter((item) => item.index % 5 === Math.floor(nextForcedDisconnect / (5 * 60 * 1000)) % 5).slice(0, 20);
      for (const client of chosen) {
        if (client.controller && !client.controller.signal.aborted) {
          streams.forcedDisconnects++;
          client.controller.abort();
        }
      }
      report.soak.disconnectEvents = report.soak.disconnectEvents || [];
      report.soak.disconnectEvents.push({ elapsedSeconds: Math.round((now - start) / 1000), requested: chosen.length, totalForced: streams.forcedDisconnects });
      nextForcedDisconnect += 5 * 60 * 1000;
    }
    if (now >= nextSample) {
      await takeSample((now - start) / 1000);
      nextSample += SAMPLE_MS;
    }
    await sleep(Math.min(500, Math.max(50, Math.min(nextBurst, nextSample, nextForcedDisconnect) - Date.now())));
  }
  report.soak.observedSeconds = (Date.now() - start) / 1000;
  await takeSample(report.soak.observedSeconds);
  const finalResult = await pool.query("SELECT state FROM dl_activities WHERE id=$1", [activity]);
  const finalState = finalResult.rows[0]?.state;
  const finalActors = new Set((finalState?.participants || []).map((item) => item.id));
  const finalSnapshots = await Promise.all(sseClients.slice(0, PARTICIPANTS).map(async (client) => {
    const snapshot = await readOwnSnapshot(client);
    const own = (snapshot.state?.participants || []).find((participant) => participant.id === client.actor);
    const want = latestExpected.get(client.actor);
    return Boolean(own && want && own.profileComplete && own.name === want.name && own.answers?.q1 === want.answer);
  }));
  const finalSseCaughtUp = await waitForClientRevisions(sseClients, Number(finalState?.revision));
  report.soak.finalConsistency = {
    participantCount: finalActors.size,
    uniqueParticipantCount: finalActors.size,
    profileCompleteCount: (finalState?.participants || []).filter((item) => item.profileComplete).length,
    q1AnswerCount: (finalState?.participants || []).filter((item) => Boolean(item.answers?.q1)).length,
    revision: finalState?.revision ?? null,
    activeSseAtEnd: streams.active,
    participantSnapshotsPassed: finalSnapshots.filter(Boolean).length,
    participantSnapshotsExpected: PARTICIPANTS,
    allSseClientsReachedFinalRevision: finalSseCaughtUp,
    finalRevision: finalState?.revision ?? null,
    sseReconnects: streams.reconnects,
    forcedDisconnects: streams.forcedDisconnects,
    sseFailedOpens: streams.failedOpens,
  };
  report.soak.status = report.soak.observedSeconds >= SOAK_MS / 1000 && finalActors.size === PARTICIPANTS && report.soak.finalConsistency.profileCompleteCount === PARTICIPANTS && report.soak.finalConsistency.q1AnswerCount === PARTICIPANTS && report.soak.finalConsistency.participantSnapshotsPassed === PARTICIPANTS && finalSseCaughtUp && streams.failedOpens === 0 && streams.active === PARTICIPANTS + 1 && report.soak.totalWriteFailures === 0 ? "completed" : "completed_with_limitations";
  report.soak.limits = ["HTTP API and SSE clients only; this is not 100 rendered pages or 100 physical devices", "No client-side rendering, cold asset cache, Wi-Fi, carrier, or WeChat acceptance", "Lost response is simulated by discarding a successful response after receipt; no TCP proxy fault injection", "No direct SQL count/QPS or pool-wait instrumentation; only pg_stat_activity connection and lock-wait snapshots", "One screen subscription was opened; no operator subscription was opened"];
}
function withHardTimeout(promise, timeoutMs, name) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => { runAbort.abort(); stopSse = true; for (const client of [...activeSse]) client.controller?.abort(); reject(new Error(`${name} hard timeout after ${timeoutMs}ms`)); }, timeoutMs); })]).finally(() => clearTimeout(timer));
}
async function main() {
  process.loadEnvFile(runtimeEnv);
  assertEnvironment();
  await mkdir(outputDir, { recursive: true });
  pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3, connectionTimeoutMillis: 5000, query_timeout: 10000, statement_timeout: 10000 });
  const identity = await pool.query("SELECT current_database() AS database, inet_server_port() AS server_port");
  if (identity.rows[0]?.database !== "destinylab_520_uat_test") throw new Error("Connected database identity failed the fixture guard");
  const ready = await fetch(`${BASE_URL}/api/health/ready`, { signal: AbortSignal.timeout(8000) });
  if (!ready.ok || (await ready.json()).ok !== true) throw new Error(`UAT readiness returned HTTP ${ready.status}`);
  report = {
    title: "520 HTTP identity and SSE soak",
    scope: "100 independent HTTP identity sessions plus 100 SSE streams; synthetic local UAT only",
    status: "running",
    phase: "entry_rounds",
    startedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    database: { name: identity.rows[0].database, host: new URL(process.env.DATABASE_URL).hostname, port: identity.rows[0].server_port },
    host,
    entryRounds: [],
    errors: [],
    timeoutPolicy: { perEntryRequestMs: ENTRY_REQUEST_TIMEOUT_MS, sseConnectMs: SSE_CONNECT_TIMEOUT_MS, entryPhaseMs: MAX_ENTRY_PHASE_MS, soakPhaseMs: MAX_SOAK_PHASE_MS, outerMs: OUTER_TIMEOUT_MS },
    evidenceBoundary: "This is backend HTTP/SSE soak evidence, not browser or real-device acceptance.",
  };
  await saveReport();
  heartbeat = setInterval(() => { void saveReport().catch((error) => report.errors.push({ phase: report.phase, error: safeError(error) })); }, SAMPLE_MS);
  const entries = await withHardTimeout((async () => {
    const all = [];
    for (let round = 0; round < ENTRY_ROUNDS; round++) {
      report.phase = `entry_round_${round + 1}`;
      const results = await runEntryRound(round);
      all.push(...results.filter(Boolean));
    }
    return all;
  })(), MAX_ENTRY_PHASE_MS, "entry rounds");
  report.entrySummary = {
    rounds: report.entryRounds.length,
    allRoundsPassed: report.entryRounds.every((round) => round.passed),
    successfulSessions: report.entryRounds.reduce((sum, round) => sum + round.succeeded, 0),
    failures: report.entryRounds.reduce((sum, round) => sum + round.failed, 0),
    totalActors: report.entryRounds.reduce((sum, round) => sum + round.uniqueActors, 0),
    duplicateActorResponses: report.entryRounds.reduce((sum, round) => sum + round.duplicateActorCount, 0),
  };
  report.phase = "sse_soak";
  await saveReport();
  const soakEntries = entries.slice(-PARTICIPANTS);
  await withHardTimeout(runSoak(soakEntries), MAX_SOAK_PHASE_MS, "30-minute SSE soak");
  report.status = report.entrySummary.allRoundsPassed && report.soak.status === "completed" ? "completed" : "completed_with_limitations";
}
let outerTimer;
try {
  await Promise.race([main(), new Promise((_, reject) => { outerTimer = setTimeout(() => reject(new Error(`Outer hard timeout after ${OUTER_TIMEOUT_MS}ms`)), OUTER_TIMEOUT_MS); })]);
} catch (error) {
  runAbort.abort();
  stopSse = true;
  if (!report) console.error(safeError(error));
  if (report) {
    report.status = "failed_or_interrupted";
    report.errors.push({ phase: report.phase, error: safeError(error) });
    if (report.soak) report.soak.observedSeconds = Math.max(report.soak.observedSeconds || 0, report.soak.startedAt ? (Date.now() - Date.parse(report.soak.startedAt)) / 1000 : 0);
  }
  process.exitCode = 1;
} finally {
  clearTimeout(outerTimer);
  clearInterval(heartbeat);
  stopSse = true;
  for (const client of [...activeSse]) client.controller?.abort();
  await Promise.allSettled(allSse);
  if (report) {
    report.finishedAt = new Date().toISOString();
    if (report.status === "running") report.status = "failed_or_interrupted";
    try { await saveReport(); } catch {}
  }
  await pool?.end().catch(() => {});
  if (report) console.log(JSON.stringify({ status: report.status, outputDir, rounds: report.entryRounds.length, actors: report.entrySummary?.totalActors ?? null, soakSeconds: report.soak?.observedSeconds ?? 0, sseReconnects: streams.reconnects, errors: report.errors.length }));
}
