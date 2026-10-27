import { chromium } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { emptyActivity } from "../../src/server/state.ts";

// This bounded test runs separately from the long backend soak. A single host
// generates all browser traffic, so its result is not physical-device capacity.
const origin = "http://127.0.0.1:3244";
const preflight = process.env.DESTINY_520_BROWSER_PREFLIGHT === "1";
const count = preflight ? 1 : 100;
const rounds = preflight ? 1 : 3;
const phaseTimeout = 90000;
const outputDir = path.resolve("docs/verification/2026-10-27-520-uat");
const reportPath = path.join(outputDir, preflight ? "520-browser-entry-preflight.json" : "520-browser-entry-report.json");
const runtime = process.env.DESTINY_520_RUNTIME_ENV ||
  "/Users/lvyong198201/.local/share/destinylab/uat-520-20261026/runtime.env";
let pool, browser, browserServer;
let contexts = [];
let stopping = false;
const report = {
  status: "running", startedAt: new Date().toISOString(), phase: "setup",
  scope: `${count} isolated Chromium contexts, ${rounds} cold/hot entry rounds; shared local generator and server`,
  preflight,
  target: origin, rounds: [], errors: [],
  host: { platform: os.platform(), arch: os.arch(), cpus: os.cpus().length, memoryBytes: os.totalmem() },
  limits: ["Not 100 devices, public-network, Wi-Fi or WeChat acceptance", "Browser context creation is recorded separately from navigation-to-usable latency", "Cold uses fresh contexts; hot clears identity storage while retaining HTTP cache", "No browser SSE soak: long backend HTTP/SSE soak is reported separately"],
};
const percentile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] : null;
};
const summary = (values) => ({ count: values.length, p50Ms: percentile(values, .5), p95Ms: percentile(values, .95), p99Ms: percentile(values, .99), maxMs: values.length ? Math.max(...values) : null });
const safeError = (error) => String(error?.message || error)
  .replace(/postgres(?:ql)?:\/\/\S+/gi, "[REDACTED_DATABASE_URL]")
  .replace(/[A-Za-z0-9_-]{43}/g, "[REDACTED_TOKEN]").slice(0, 500);
async function save() {
  report.updatedAt = new Date().toISOString();
  report.generatorRssBytes = process.memoryUsage().rss;
  await writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
}
function resourceSample() {
  let pressure = "unavailable";
  try { pressure = execFileSync("memory_pressure", ["-Q"], { encoding: "utf8", timeout: 3000 }).trim(); } catch {}
  let chromiumProcesses = { status: "unavailable" };
  try {
    const rootPid = browserServer?.process()?.pid;
    const rows = execFileSync("ps", ["-axo", "pid=,ppid=,rss=,%cpu="], { encoding: "utf8", timeout: 3000 }).trim().split("\n").map((line) => {
      const [pid, ppid, rssKb, cpu] = line.trim().split(/\s+/).map(Number);
      return { pid, ppid, rssKb, cpu };
    });
    const pids = new Set([rootPid]);
    for (let changed = true; changed;) {
      changed = false;
      for (const row of rows) if (pids.has(row.ppid) && !pids.has(row.pid)) { pids.add(row.pid); changed = true; }
    }
    const owned = rows.filter((row) => pids.has(row.pid));
    chromiumProcesses = { rootPid, count: owned.length, aggregateRssBytes: owned.reduce((sum, r) => sum + r.rssKb * 1024, 0), aggregateCpuPercent: owned.reduce((sum, r) => sum + r.cpu, 0) };
  } catch {}
  return { at: new Date().toISOString(), runnerRssBytes: process.memoryUsage().rss, chromiumProcesses, osFreeBytes: os.freemem(), memoryPressure: pressure };
}
async function bounded(task, timeout, label) {
  let timer;
  return Promise.race([task, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} deadline ${timeout}ms`)), timeout); })])
    .finally(() => clearTimeout(timer));
}
async function closeBrowsers() {
  const closing = browser;
  browser = null;
  if (closing) await bounded(closing.close(), 10000, "browser cleanup").catch(() => {});
  if (browserServer) await bounded(browserServer.close(), 10000, "browser server cleanup").catch(() => {});
  browserServer = null;
  contexts = [];
}
async function createContexts(activity) {
  const start = performance.now();
  const pages = [];
  // Allocate before the burst in bounded batches; all 100 navigations then begin
  // together. Keep native HTTP caching enabled (Playwright routing disables it).
  for (let offset = 0; offset < count; offset += 10) {
    const batch = await Promise.all(Array.from({ length: Math.min(10, count - offset) }, () => browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" })));
    contexts.push(...batch);
    for (const context of batch) {
      await context.addInitScript(({ expectedActivity }) => {
        window.__entryGuardFailures = [];
        const check = (input) => {
          const candidate = typeof input === "string" || input instanceof URL ? String(input) : input.url;
          const url = new URL(candidate, location.href);
          if (url.pathname.startsWith("/api/live/") && url.searchParams.get("activity") !== expectedActivity) {
            window.__entryGuardFailures.push({ path: url.pathname, activity: url.searchParams.get("activity") });
            throw new Error("Test blocked a live request for a different activity");
          }
        };
        const nativeFetch = window.fetch.bind(window);
        window.fetch = (input, options) => { check(input); return nativeFetch(input, options); };
        const NativeEventSource = window.EventSource;
        window.EventSource = class extends NativeEventSource {
          constructor(url, options) { check(url); super(url, options); }
        };
      }, { expectedActivity: activity });
    }
    pages.push(...await Promise.all(batch.map((context) => context.newPage())));
  }
  return { pages, creationMs: performance.now() - start };
}
async function enter(page, activity, hot) {
  const localErrors = [];
  const listener = (error) => localErrors.push(safeError(error));
  page.on("pageerror", listener);
  try {
    if (hot) {
      await page.context().clearCookies();
      await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    }
    let apiStarted;
    const requested = (request) => {
      const url = new URL(request.url());
      if (request.method() === "POST" && url.pathname === "/api/live/session" && url.searchParams.get("activity") === activity) apiStarted = performance.now();
    };
    page.on("request", requested);
    const session = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === "POST" && url.pathname === "/api/live/session" && url.searchParams.get("activity") === activity;
    }, { timeout: 60000 }).then(async (response) => {
      const snapshot = await response.json();
      return { status: response.status(), snapshot, durationMs: apiStarted === undefined ? null : performance.now() - apiStarted };
    });
    // Convert early rejection to data so navigation failures cannot leave an
    // unhandled promise behind while the other 99 contexts finish.
    const settledSession = session.then((value) => ({ value }), (error) => ({ error }));
    const started = performance.now();
    try {
      const response = hot ? await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 }) : await page.goto(`${origin}/mobile/01-start?activity=${activity}`, { waitUntil: "domcontentloaded", timeout: 60000 });
      if (response?.status() !== 200) throw new Error(`Page HTTP ${response?.status()}`);
      const url = new URL(page.url());
      if (url.pathname !== "/mobile/01-start" || url.searchParams.get("activity") !== activity) throw new Error("Entry route lost activity");
      const outcome = await settledSession;
      if (outcome.error) throw outcome.error;
      if (outcome.value.status !== 200 || !outcome.value.snapshot.actor || outcome.value.snapshot.activity !== activity) throw new Error(`Session HTTP ${outcome.value.status} or invalid identity`);
      await page.locator("main.mobile-shell .intent-card:not([disabled])").first().waitFor({ state: "visible", timeout: 60000 });
      const pageAvailableMs = performance.now() - started;
      const guardFailures = await page.evaluate(() => window.__entryGuardFailures || []);
      if (guardFailures.length) throw new Error("Activity isolation guard failed");
      if (localErrors.length) throw new Error(localErrors.join("; "));
      const assets = await page.evaluate(() => {
        const rows = performance.getEntriesByType("resource").filter((entry) => {
          const url = new URL(entry.name);
          return url.pathname.startsWith("/assets/") || url.pathname.startsWith("/_next/static/");
        });
        return { completed: rows.filter((r) => r.responseEnd > 0).length, cacheHits: rows.filter((r) => r.transferSize === 0 && r.decodedBodySize > 0).length, transferredBytes: rows.reduce((sum, r) => sum + r.transferSize, 0) };
      });
      return { ok: true, actor: outcome.value.snapshot.actor, pageAvailableMs, apiMs: outcome.value.durationMs, apiStatus: outcome.value.status, assets };
    } finally { page.off("request", requested); }
  } catch (error) { return { ok: false, error: safeError(error) }; }
  finally { page.off("pageerror", listener); }
}
async function phase(pages, activity, name) {
  report.phase = name;
  const sampleBefore = resourceSample();
  await save();
  const results = await bounded(Promise.all(pages.map((page) => enter(page, activity, name.endsWith("hot")))), phaseTimeout, name);
  const successful = results.filter((result) => result.ok);
  const api = summary(successful.map((r) => r.apiMs).filter(Number.isFinite));
  const usable = summary(successful.map((r) => r.pageAvailableMs));
  const uniqueActors = new Set(successful.map((r) => r.actor)).size;
  return { attempted: count, successful: successful.length, failed: count - successful.length, uniqueActors, duplicates: successful.length - uniqueActors, api, pageUsable: usable,
    thresholds: { apiP95Under2s: api.count === count && api.p95Ms <= 2000, pageP95Under5s: usable.count === count && usable.p95Ms <= 5000 },
    assetsAtUsableTime: { completed: successful.reduce((sum, r) => sum + r.assets.completed, 0), cacheHits: successful.reduce((sum, r) => sum + r.assets.cacheHits, 0), transferredBytes: successful.reduce((sum, r) => sum + r.assets.transferredBytes, 0) },
    sampleBefore, sampleAfter: resourceSample(), errors: results.filter((r) => !r.ok).map((r) => r.error), actors: successful.map((r) => r.actor) };
}
async function main() {
  process.loadEnvFile(runtime);
  const db = new URL(process.env.DATABASE_URL || "http://invalid");
  if (process.env.DESTINY_PUBLIC_URL !== origin || !["127.0.0.1", "localhost"].includes(db.hostname) || db.pathname !== "/destinylab_520_uat_test") throw new Error("Local 3244/test-database guard failed");
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  const ready = await fetch(`${origin}/api/health/ready`, { signal: AbortSignal.timeout(5000) });
  if (!ready.ok || (await ready.json()).ok !== true) throw new Error("Candidate is not ready");
  report.buildId = (await readFile(".next-520-uat/BUILD_ID", "utf8")).trim();
  browserServer = await chromium.launchServer({ headless: true, args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"] });
  report.browserRootPid = browserServer.process().pid;
  browser = await chromium.connect(browserServer.wsEndpoint());
  report.browserVersion = browser.version();
  for (let index = 0; index < rounds; index++) {
    const activity = `browser520-${randomUUID().replaceAll("-", "").slice(0, 20)}`;
    await pool.query("INSERT INTO dl_activities(id,state) VALUES($1,$2::jsonb)", [activity, JSON.stringify(emptyActivity())]);
    const row = { round: index + 1, activity, startedAt: new Date().toISOString() };
    report.rounds.push(row);
    report.phase = `round_${index + 1}_allocate_contexts`;
    await save();
    const created = await bounded(createContexts(activity), 120000, "100 context allocation");
    row.contextCreationMs = created.creationMs;
    row.cold = await phase(created.pages, activity, `round_${index + 1}_cold`);
    await save();
    if (row.cold.successful !== count) throw new Error(`Round ${index + 1} cold entry failed; preserving first failure and stopping bounded run`);
    row.hot = await phase(created.pages, activity, `round_${index + 1}_hot`);
    row.coldHotActorOverlap = row.hot.actors.filter((actor) => row.cold.actors.includes(actor)).length;
    const dbRow = await pool.query("SELECT jsonb_array_length(state->'participants') AS participants FROM dl_activities WHERE id=$1", [activity]);
    row.databaseParticipants = dbRow.rows[0].participants;
    row.finishedAt = new Date().toISOString();
    await save();
    await bounded(Promise.all(contexts.map((context) => context.close())), 15000, "context cleanup");
    contexts = [];
    if (row.hot.successful !== count || row.coldHotActorOverlap !== 0 || row.databaseParticipants !== 2 * count) throw new Error(`Round ${index + 1} identity count or hot entry failed`);
  }
  report.status = report.rounds.every((r) => r.cold.thresholds.apiP95Under2s && r.hot.thresholds.apiP95Under2s && r.cold.thresholds.pageP95Under5s && r.hot.thresholds.pageP95Under5s) ? "passed_controlled_browser_thresholds" : "completed_thresholds_not_met";
  if (preflight && report.status === "passed_controlled_browser_thresholds") report.status = "preflight_passed";
  if (report.status === "completed_thresholds_not_met") process.exitCode = 1;
}
const onSignal = () => { stopping = true; void closeBrowsers(); };
process.on("SIGTERM", onSignal);
process.on("SIGINT", onSignal);
try { await bounded(main(), 9 * 60000, "whole browser run"); }
catch (error) { report.status = stopping ? "interrupted" : "failed"; report.errors.push(safeError(error)); process.exitCode = 1; }
finally {
  await closeBrowsers();
  await pool?.end().catch(() => {});
  report.finishedAt = new Date().toISOString();
  await save().catch(() => {});
  console.log(JSON.stringify({ status: report.status, phases: report.rounds.length, report: reportPath }));
}
