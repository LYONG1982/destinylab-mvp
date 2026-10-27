import { chromium } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { emptyActivity } from "../../src/server/state.ts";
import { QUESTIONS } from "../../src/data/questions.ts";

const BASE_URL = "http://127.0.0.1:3244";
const BROWSER_COUNT = 100;
const ENTRY_ROUNDS = 3;
const SOAK_MS = 30 * 60 * 1000;
const BURST_INTERVAL_MS = 30 * 1000;
const RESPONSE_TIMEOUT_MS = 60 * 1000;
const RUN_SOAK = process.env.DESTINY_520_LOAD_SOAK !== "0";
const OUTPUT_DIR = process.env.DESTINY_520_LOAD_OUTPUT_DIR || os.tmpdir();
const protocolHeader = "520-v1";
const sessionRequestStartedAt = new WeakMap();
const sessionRequestDuration = new WeakMap();
const entryPhase = new WeakMap();
const q1 = QUESTIONS.find((question) => question.id === "q1");
if (!q1) throw new Error("q1 fixture is unavailable");

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function summarize(values) {
  return {
    count: values.length,
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    p99Ms: percentile(values, 0.99),
    maxMs: values.length ? Math.max(...values) : null,
  };
}

function serverProcessSample() {
  try {
    const raw = execFileSync("ps", ["-p", "16466", "-o", "%cpu=,rss=,etime="], {
      encoding: "utf8",
      timeout: 2000,
      maxBuffer: 1024,
    }).trim();
    const [cpu, rssKb, elapsed] = raw.split(/\s+/);
    return {
      pid: 16466,
      cpuPercent: Number(cpu),
      rssBytes: Number(rssKb) * 1024,
      elapsed,
    };
  } catch {
    return { pid: 16466, status: "unavailable" };
  }
}

function postgresContainerSample() {
  try {
    const status = execFileSync(
      "docker",
      [
        "inspect",
        "--format={{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}",
        "destinylab-rejoin-uat-20261026",
      ],
      { encoding: "utf8", timeout: 3000, maxBuffer: 1024 },
    ).trim();
    const [state, health] = status.split(/\s+/);
    return { name: "destinylab-rejoin-uat-20261026", state, health };
  } catch {
    return { name: "destinylab-rejoin-uat-20261026", status: "unavailable" };
  }
}

async function postgresConnectionSample(pool) {
  try {
    const result = await pool.query(
      "SELECT current_database() AS database, count(*)::int AS total, count(*) FILTER (WHERE state='active')::int AS active, count(*) FILTER (WHERE wait_event_type IS NOT NULL)::int AS waiting, current_setting('max_connections')::int AS max_connections FROM pg_stat_activity WHERE datname=current_database()",
    );
    return result.rows[0];
  } catch (error) {
    return { status: "unavailable", errorCode: error?.code || "unknown" };
  }
}

function validateEnvironment() {
  if (process.env.DESTINY_PUBLIC_URL !== BASE_URL)
    throw new Error(`DESTINY_PUBLIC_URL must be ${BASE_URL}`);
  if (!process.env.DATABASE_URL)
    throw new Error(
      "DATABASE_URL is required through the protected runtime env",
    );
  const url = new URL(process.env.DATABASE_URL);
  if (
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    !url.pathname.endsWith("_test")
  )
    throw new Error(
      "The load runner requires a local database ending in _test",
    );
}

async function createLoadActivity(pool) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const activity = `load-520-${randomUUID().replaceAll("-", "").slice(0, 20)}`;
    if (activity === "meet-uat-520") throw new Error("Unsafe activity id");
    const inserted = await pool.query(
      "INSERT INTO dl_activities(id,state) VALUES($1,$2::jsonb) ON CONFLICT(id) DO NOTHING RETURNING id",
      [activity, JSON.stringify(emptyActivity())],
    );
    if (inserted.rowCount === 1) return activity;
  }
  throw new Error("Could not allocate a unique load activity");
}

async function addSseProbe(context) {
  await context.addInitScript(() => {
    if (window.__destinySseTracked) return;
    const NativeEventSource = window.EventSource;
    const tracked = [];
    Object.defineProperty(window, "__destinySseTracked", {
      configurable: false,
      value: tracked,
    });
    window.EventSource = class TrackedEventSource extends NativeEventSource {
      constructor(url, options) {
        super(url, options);
        tracked.push(this);
      }
    };
  });
}

function requestMatches(response, pathname, activity) {
  try {
    const url = new URL(response.url());
    return (
      url.origin === BASE_URL &&
      url.pathname === pathname &&
      url.searchParams.get("activity") === activity &&
      url.searchParams.get("audience") === "participant"
    );
  } catch {
    return false;
  }
}

function requestMatchesUrl(request, pathname, activity) {
  try {
    const url = new URL(request.url());
    return (
      url.origin === BASE_URL &&
      url.pathname === pathname &&
      url.searchParams.get("activity") === activity &&
      url.searchParams.get("audience") === "participant"
    );
  } catch {
    return false;
  }
}

async function enter(context, page, activity, navigation) {
  const started = performance.now();
  const sessionResponsePromise = page
    .waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        requestMatches(response, "/api/live/session", activity),
      { timeout: RESPONSE_TIMEOUT_MS },
    )
    .then(
      (response) => ({ response }),
      (error) => ({ error }),
    );
  const sseResponsePromise = page
    .waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        requestMatches(response, "/api/live/events", activity),
      { timeout: RESPONSE_TIMEOUT_MS },
    )
    .then(
      (response) => ({ response }),
      (error) => ({ error }),
    );

  const pageResponse =
    navigation === "reload"
      ? await page.reload({ waitUntil: "domcontentloaded" })
      : await page.goto(
          `${BASE_URL}/mobile/01-start?activity=${encodeURIComponent(activity)}`,
          {
            waitUntil: "domcontentloaded",
            timeout: RESPONSE_TIMEOUT_MS,
          },
        );
  const domContentLoadedMs = performance.now() - started;
  if (!pageResponse || pageResponse.status() >= 400)
    throw new Error(
      `Activity page returned ${pageResponse?.status() ?? "no response"}`,
    );
  const currentUrl = new URL(page.url());
  if (
    currentUrl.pathname !== "/mobile/01-start" ||
    currentUrl.searchParams.get("activity") !== activity
  )
    throw new Error("The participant entry route lost its activity identifier");
  const [sessionResult, sseResult] = await Promise.all([
    sessionResponsePromise,
    sseResponsePromise,
  ]);
  if (sessionResult.error) throw sessionResult.error;
  if (sseResult.error) throw sseResult.error;
  const sessionResponse = sessionResult.response;
  const sseResponse = sseResult.response;
  const snapshot = await sessionResponse.json();
  if (
    sessionResponse.status() !== 200 ||
    !snapshot.actor ||
    !snapshot.state?.epoch
  )
    throw new Error(`Entry API returned status ${sessionResponse.status()}`);
  if (sseResponse.status() !== 200)
    throw new Error(`SSE returned status ${sseResponse.status()}`);
  await page.locator("main.mobile-shell .intent-card:not([disabled])").waitFor({
    state: "visible",
    timeout: RESPONSE_TIMEOUT_MS,
  });
  await page.waitForFunction(
    () => {
      const button = document.querySelector("main.mobile-shell .intent-card");
      return button instanceof HTMLButtonElement && !button.disabled;
    },
    { timeout: RESPONSE_TIMEOUT_MS },
  );
  return {
    actor: snapshot.actor,
    epoch: snapshot.state.epoch,
    domContentLoadedMs,
    sessionApiMs: sessionRequestDuration.get(sessionResponse.request()) ?? null,
    pageAvailableMs: performance.now() - started,
  };
}

async function warmEntry(context, page, activity) {
  await context.clearCookies();
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  return enter(context, page, activity, "reload");
}

async function writeAnswer(entry, page, activity, round, index, burst) {
  const started = performance.now();
  const result = await page.evaluate(
    async ({ activity, epoch, round, index, burst, options, protocol }) => {
      const url = `/api/live/command?activity=${encodeURIComponent(activity)}&audience=participant`;
      const response = await fetch(url, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
          "X-Destiny-Protocol": protocol,
        },
        body: JSON.stringify({
          epoch,
          command: {
            type: "answer",
            questionId: "q1",
            value: options[(round + index + burst) % options.length],
          },
        }),
      });
      return { status: response.status };
    },
    {
      activity,
      epoch: entry.epoch,
      round,
      index,
      burst,
      options: [...q1.options],
      protocol: protocolHeader,
    },
  );
  return { status: result.status, durationMs: performance.now() - started };
}

async function streamHealth(pages) {
  const states = await Promise.all(
    pages.map(async (page) => {
      try {
        return await page.evaluate(() => {
          const events = window.__destinySseTracked || [];
          return {
            open: events.filter((event) => event.readyState === 1).length,
            connections: events.length,
          };
        });
      } catch {
        return { open: 0, connections: 0 };
      }
    }),
  );
  return {
    pagesWithOpenStream: states.filter((state) => state.open > 0).length,
    openStreams: states.reduce((sum, state) => sum + state.open, 0),
    totalStreamObjects: states.reduce(
      (sum, state) => sum + state.connections,
      0,
    ),
  };
}

async function saveReport(pathname, report) {
  await writeFile(pathname, JSON.stringify(report, null, 2), { mode: 0o600 });
}

async function main() {
  validateEnvironment();
  const health = await fetch(`${BASE_URL}/api/health/ready`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!health.ok)
    throw new Error(`The 3244 service is not ready (${health.status})`);
  const healthBody = await health.json();
  if (healthBody.ok !== true)
    throw new Error("The 3244 service readiness check failed");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
  let browser;
  const contexts = [];
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const output = path.join(OUTPUT_DIR, `destinylab-520-load-${stamp}.json`);
  await mkdir(OUTPUT_DIR, { recursive: true, mode: 0o700 });
  const report = {
    status: "running",
    startedAt: new Date().toISOString(),
    baseURL: BASE_URL,
    activity: null,
    activityGuard: {
      expectedActivity: null,
      blockedMismatches: [],
    },
    database: "local _test only",
    browser: null,
    host: {
      platform: os.platform(),
      arch: os.arch(),
      cpuModel: os.cpus()[0]?.model || "unknown",
      cpuCount: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
      initialFreeMemoryBytes: os.freemem(),
      initialRunnerRssBytes: process.memoryUsage().rss,
      serverMetrics: "not captured by this client-side runner",
    },
    rounds: [],
    uniqueActors: 0,
    duplicateActorResponses: 0,
    errors: [],
    soak: {
      requestedSeconds: SOAK_MS / 1000,
      observedSeconds: 0,
      bursts: [],
      samples: [],
      totalWriteFailures: 0,
      writeLatency: null,
      finalStreams: null,
      databaseRevision: null,
      databaseParticipants: null,
    },
  };
  const actors = new Set();
  const writes = [];
  const streamFailures = [];
  const sessionApiResponses = [];

  try {
    report.activity = await createLoadActivity(pool);
    report.activityGuard.expectedActivity = report.activity;
    const row = await pool.query("SELECT current_database() AS name");
    if (!String(row.rows[0]?.name || "").endsWith("_test"))
      throw new Error("The connected database is not isolated");

    browser = await chromium.launch({
      headless: true,
      args: [
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
      ],
    });
    report.browser = {
      version: browser.version(),
      contextsPerRound: BROWSER_COUNT,
    };

    let soakPages = [];
    let soakEntries = [];
    for (let round = 1; round <= ENTRY_ROUNDS; round++) {
      const contextsThisRound = await Promise.all(
        Array.from({ length: BROWSER_COUNT }, () =>
          browser.newContext({
            viewport: { width: 390, height: 844 },
            reducedMotion: "reduce",
          }),
        ),
      );
      contexts.push(...contextsThisRound);
      await Promise.all(contextsThisRound.map(addSseProbe));
      const pages = await Promise.all(
        contextsThisRound.map((context) => context.newPage()),
      );
      for (const page of pages) {
        entryPhase.set(page, "cold");
        await page.route("**/api/live/**", async (route) => {
          const requestUrl = new URL(route.request().url());
          const actualActivity = requestUrl.searchParams.get("activity");
          if (actualActivity !== report.activity) {
            report.activityGuard.blockedMismatches.push({
              round,
              phase: entryPhase.get(page) || "unknown",
              path: requestUrl.pathname,
              expectedActivity: report.activity,
              actualActivity,
            });
            await route.abort("blockedbyclient");
            return;
          }
          await route.continue();
        });
        page.setDefaultTimeout(RESPONSE_TIMEOUT_MS);
        page.on("pageerror", (error) =>
          report.errors.push({
            round,
            type: "pageerror",
            message: error.message,
          }),
        );
        page.on("requestfailed", (request) => {
          if (request.url().includes("/api/live/"))
            streamFailures.push({
              round,
              urlPath: new URL(request.url()).pathname,
            });
        });
        page.on("request", (request) => {
          if (
            request.method() === "POST" &&
            requestMatchesUrl(request, "/api/live/session", report.activity)
          )
            sessionRequestStartedAt.set(request, performance.now());
        });
        page.on("response", (response) => {
          const request = response.request();
          const startedAt = sessionRequestStartedAt.get(request);
          if (startedAt !== undefined) {
            const durationMs = performance.now() - startedAt;
            sessionRequestDuration.set(request, performance.now() - startedAt);
            sessionApiResponses.push({
              round,
              phase: entryPhase.get(page) || "unknown",
              status: response.status(),
              durationMs,
            });
          }
        });
      }

      const coldResults = await Promise.all(
        pages.map(async (page) => {
          try {
            return {
              ok: true,
              entry: await enter(page.context(), page, report.activity, "goto"),
            };
          } catch (error) {
            report.errors.push({
              round,
              phase: "cold_entry",
              message:
                error instanceof Error
                  ? error.message
                  : "Unexpected entry failure",
            });
            return { ok: false, entry: null };
          }
        }),
      );
      const cold = coldResults.flatMap((result) =>
        result.entry ? [result.entry] : [],
      );
      cold.forEach((entry) => actors.add(entry.actor));
      const hotResults = await Promise.all(
        pages.map(async (page) => {
          entryPhase.set(page, "hot");
          try {
            return {
              ok: true,
              entry: await warmEntry(page.context(), page, report.activity),
            };
          } catch (error) {
            report.errors.push({
              round,
              phase: "hot_entry",
              message:
                error instanceof Error
                  ? error.message
                  : "Unexpected entry failure",
            });
            return { ok: false, entry: null };
          }
        }),
      );
      const hot = hotResults.flatMap((result) =>
        result.entry ? [result.entry] : [],
      );
      hot.forEach((entry) => actors.add(entry.actor));
      const coldActors = cold.map((entry) => entry.actor);
      const hotActors = hot.map((entry) => entry.actor);
      report.rounds.push({
        round,
        independentContexts: contextsThisRound.length,
        coldEntry: {
          pageAvailable: summarize(cold.map((entry) => entry.pageAvailableMs)),
          domContentLoaded: summarize(
            cold.map((entry) => entry.domContentLoadedMs),
          ),
          sessionAPI: summarize(
            cold.map((entry) => entry.sessionApiMs).filter(Number.isFinite),
          ),
          sessionAPIResponses: summarize(
            sessionApiResponses
              .filter(
                (sample) => sample.round === round && sample.phase === "cold",
              )
              .map((sample) => sample.durationMs),
          ),
          nonSuccessAPIResponses: sessionApiResponses.filter(
            (sample) =>
              sample.round === round &&
              sample.phase === "cold" &&
              sample.status >= 400,
          ).length,
          attempted: BROWSER_COUNT,
          succeeded: cold.length,
          successRate: cold.length / BROWSER_COUNT,
          uniqueActors: new Set(coldActors).size,
          failures: coldResults.filter((result) => !result.ok).length,
        },
        hotCacheEntry: {
          pageAvailable: summarize(hot.map((entry) => entry.pageAvailableMs)),
          domContentLoaded: summarize(
            hot.map((entry) => entry.domContentLoadedMs),
          ),
          sessionAPI: summarize(
            hot.map((entry) => entry.sessionApiMs).filter(Number.isFinite),
          ),
          sessionAPIResponses: summarize(
            sessionApiResponses
              .filter(
                (sample) => sample.round === round && sample.phase === "hot",
              )
              .map((sample) => sample.durationMs),
          ),
          nonSuccessAPIResponses: sessionApiResponses.filter(
            (sample) =>
              sample.round === round &&
              sample.phase === "hot" &&
              sample.status >= 400,
          ).length,
          attempted: BROWSER_COUNT,
          succeeded: hot.length,
          successRate: hot.length / BROWSER_COUNT,
          uniqueActors: new Set(hotActors).size,
          failures: hotResults.filter((result) => !result.ok).length,
        },
        coldHotActorOverlap: coldActors.filter((actor) =>
          hotActors.includes(actor),
        ).length,
      });
      if (round < ENTRY_ROUNDS) {
        await Promise.all(contextsThisRound.map((context) => context.close()));
      } else {
        soakPages = pages;
        soakEntries = hot;
      }
      await saveReport(output, report);
    }

    if (actors.size !== ENTRY_ROUNDS * BROWSER_COUNT * 2)
      report.duplicateActorResponses =
        ENTRY_ROUNDS * BROWSER_COUNT * 2 - actors.size;
    const initialStreams = await streamHealth(soakPages);
    report.soak.initialStreams = initialStreams;

    if (!RUN_SOAK) {
      report.status = report.activityGuard.blockedMismatches.length
        ? "failed_activity_guard"
        : "entries_completed_soak_pending";
      report.soak.status = "pending";
      report.soak.streamRequestFailures = streamFailures.length;
      return;
    }

    const entryGate = {
      roundsPassed:
        report.rounds.length === ENTRY_ROUNDS &&
        report.rounds.every(
          (round) =>
            round.coldEntry.succeeded === BROWSER_COUNT &&
            round.hotCacheEntry.succeeded === BROWSER_COUNT,
        ),
      uniqueActorsPassed:
        actors.size === ENTRY_ROUNDS * BROWSER_COUNT * 2 &&
        report.duplicateActorResponses === 0,
      allSseSubscriptionsPassed:
        initialStreams.pagesWithOpenStream === BROWSER_COUNT &&
        initialStreams.openStreams === BROWSER_COUNT,
      activityGuardPassed: report.activityGuard.blockedMismatches.length === 0,
      pageErrors: report.errors.filter((error) => error.type === "pageerror")
        .length,
    };
    entryGate.passed =
      entryGate.roundsPassed &&
      entryGate.uniqueActorsPassed &&
      entryGate.allSseSubscriptionsPassed &&
      entryGate.activityGuardPassed &&
      entryGate.pageErrors === 0;
    report.soak.entryGate = entryGate;
    if (!entryGate.passed) {
      report.status = "entries_failed_soak_skipped";
      report.soak.status = "skipped_entry_gate";
      report.soak.skipReason =
        "Three rounds, 600 unique actors, activity isolation, or 100 SSE subscriptions did not pass.";
      report.soak.streamRequestFailures = streamFailures.length;
      return;
    }

    const soakStarted = Date.now();
    let burst = 0;
    while (Date.now() - soakStarted < SOAK_MS) {
      const burstStarted = Date.now();
      const results = await Promise.all(
        soakPages.map((page, index) =>
          writeAnswer(
            soakEntries[index],
            page,
            report.activity,
            ENTRY_ROUNDS,
            index,
            burst,
          ),
        ),
      );
      writes.push(
        ...results
          .filter((result) => result.status >= 200 && result.status < 300)
          .map((result) => result.durationMs),
      );
      const failed = results.filter(
        (result) => result.status < 200 || result.status >= 300,
      );
      report.soak.totalWriteFailures += failed.length;
      report.soak.bursts.push({
        index: burst,
        startedAt: new Date(burstStarted).toISOString(),
        durationMs: Date.now() - burstStarted,
        writes: results.length,
        failures: failed.length,
        latency: summarize(results.map((result) => result.durationMs)),
        statuses: failed.length ? failed.map((result) => result.status) : [200],
      });

      const elapsed = Date.now() - soakStarted;
      report.soak.observedSeconds = elapsed / 1000;
      if (burst % 2 === 0 || elapsed >= SOAK_MS) {
        const stateResult = await pool.query(
          "SELECT state FROM dl_activities WHERE id=$1",
          [report.activity],
        );
        const state = stateResult.rows[0]?.state;
        report.soak.databaseRevision = state?.revision ?? null;
        report.soak.databaseParticipants = state?.participants?.length ?? null;
        report.soak.samples.push({
          elapsedSeconds: elapsed / 1000,
          ...(await streamHealth(soakPages)),
          freeMemoryBytes: os.freemem(),
          runnerRssBytes: process.memoryUsage().rss,
          serverProcess: serverProcessSample(),
          postgresContainer: postgresContainerSample(),
          postgresConnections: await postgresConnectionSample(pool),
          databaseRevision: report.soak.databaseRevision,
          writeFailures: report.soak.totalWriteFailures,
        });
      }
      burst++;
      await saveReport(output, report);
      const nextAt = soakStarted + burst * BURST_INTERVAL_MS;
      const remaining = nextAt - Date.now();
      if (remaining > 0)
        await new Promise((resolve) => setTimeout(resolve, remaining));
    }

    report.soak.observedSeconds = (Date.now() - soakStarted) / 1000;
    report.soak.writeLatency = summarize(writes);
    report.soak.finalStreams = await streamHealth(soakPages);
    const finalState = await pool.query(
      "SELECT state FROM dl_activities WHERE id=$1",
      [report.activity],
    );
    const finalData = finalState.rows[0]?.state;
    report.soak.databaseRevision = finalData?.revision ?? null;
    report.soak.databaseParticipants = finalData?.participants?.length ?? null;
    report.soak.uniqueActorsFromSessions = actors.size;
    report.soak.uniqueActorsInDatabase = new Set(
      (finalData?.participants || []).map((participant) => participant.id),
    ).size;
    report.soak.streamRequestFailures = streamFailures.length;
    report.soak.status =
      report.soak.observedSeconds >= SOAK_MS / 1000 &&
      report.soak.finalStreams.pagesWithOpenStream === BROWSER_COUNT &&
      report.soak.totalWriteFailures === 0 &&
      report.duplicateActorResponses === 0 &&
      report.soak.uniqueActorsInDatabase === ENTRY_ROUNDS * BROWSER_COUNT * 2 &&
      report.activityGuard.blockedMismatches.length === 0
        ? "completed"
        : "completed_with_limitations";
    report.status = report.soak.status;
  } catch (error) {
    report.status = "failed";
    report.errors.push({
      type: "runner",
      name: error instanceof Error ? error.name : "Error",
      message:
        error instanceof Error
          ? error.message.replace(
              /postgres(?:ql)?:\/\/[^\s]+/gi,
              "[REDACTED_DATABASE_URL]",
            )
          : "Unexpected runner failure",
    });
    process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString();
    report.uniqueActors = actors.size;
    report.host.finalFreeMemoryBytes = os.freemem();
    report.host.finalRunnerRssBytes = process.memoryUsage().rss;
    await saveReport(output, report);
    await Promise.all(
      contexts.map((context) => context.close().catch(() => {})),
    );
    await browser?.close().catch(() => {});
    await pool.end().catch(() => {});
    console.log(
      JSON.stringify({
        status: report.status,
        activity: report.activity,
        output,
        rounds: report.rounds.length,
        uniqueActors: report.uniqueActors,
        soakSeconds: report.soak.observedSeconds,
        writeFailures: report.soak.totalWriteFailures,
        streams: report.soak.finalStreams,
      }),
    );
  }
}

void main();
