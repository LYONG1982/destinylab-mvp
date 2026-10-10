/** ACT03 V2: continuous development-only visual stress with public demo controls in an isolated browser. */
import { chromium, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import os from "node:os";
import { setTimeout as delay } from "node:timers/promises";

const ROOT = '[data-testid="destiny-world"]';
const BUSINESS_KEY = "destinylab:v1.1:state";
const ACTIONS = [
  "TRIGGER NEW MEET",
  "DUPLICATE EVENT",
  "BURST PAIRS",
  "REVOKE ONE",
  "OFFLINE VERIFIED GRANTS",
  "RECONNECT",
  "OFFLINE UNKNOWN GRANTS",
  "RECONNECT",
  "3 PAIRS",
  "NEW CONNECTION",
  "CONFIRM CONNECTION MEET",
  "SHARED PARTICIPANT",
  "10 PAIRS",
  "双向确认",
  "完成问题",
  "开放认识",
  "取消开放",
];
type FrameProbe = {
  intervals: number[];
  index: number;
  frames: number;
  last: number;
  longTasks: number;
  longTaskMs: number;
  maxGap: number;
  raf: number;
};
type ProbeWindow = Window & { __destinySoak?: FrameProbe };
type Sample = {
  elapsedSeconds: number;
  world: Record<string, string | undefined>;
  resources: Record<string, number>;
  canvases: number;
  dom: number;
  visible: string;
  commits: number;
  playerNodes: number;
  visiblePlayers: number;
  activeWindowPlayers: number;
  outgoingPlayers: number;
  queueCounts: Record<string, number>;
  unclassifiedVisiblePlayers: number;
  frameProbe: {
    p50: number;
    p95: number;
    max: number;
    frames: number;
    longTasks: number;
    longTaskMs: number;
  } | null;
  metrics: Record<string, number>;
};
async function files(path: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const file = join(path, entry.name);
    if (entry.isDirectory()) result.push(...(await files(file)));
    else if (/\.(tsx?|css)$/.test(entry.name)) result.push(file);
  }
  return result.sort();
}
async function hashes(paths: string[]) {
  return Object.fromEntries(
    await Promise.all(
      paths.map(async (path) => [
        path,
        createHash("sha256")
          .update(await readFile(path))
          .digest("hex"),
      ]),
    ),
  );
}
function quantile(values: number[], percentile: number) {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  return finite.length
    ? finite[Math.floor((finite.length - 1) * percentile)]
    : null;
}
async function installProbe(page: Page) {
  // A literal browser script avoids tsx/esbuild injecting Node-only __name helpers.
  await page.evaluate(`(() => {
    const probe = { intervals: [], index: 0, frames: 0, last: 0, longTasks: 0, longTaskMs: 0, maxGap: 0, raf: 0 };
    window.__destinySoak = probe;
    const frame = (at) => {
      if (probe.last && document.visibilityState === 'visible') {
        const elapsed = at - probe.last;
        probe.intervals[probe.index++ % 4096] = elapsed;
        probe.maxGap = Math.max(probe.maxGap, elapsed);
        probe.frames++;
      }
      probe.last = at;
      probe.raf = requestAnimationFrame(frame);
    };
    probe.raf = requestAnimationFrame(frame);
    try {
      new PerformanceObserver((list) => {
        for (const item of list.getEntries()) { probe.longTasks++; probe.longTaskMs += item.duration; }
      }).observe({ type: 'longtask', buffered: false });
    } catch {}
  })()`);
}

async function main() {
  const base = process.env.DESTINY_SOAK_URL || "http://localhost:3211";
  const route = "/screen/demo";
  const minutes = Number(process.env.DESTINY_SOAK_MINUTES || 30);
  if (!Number.isFinite(minutes) || minutes < 1)
    throw new Error("Soak minutes must be at least one");
  const destination =
    process.env.DESTINY_SOAK_OUTPUT_DIR ||
    "docs/verification/destiny-field-act3-v2";
  await mkdir(destination, { recursive: true });
  const output = join(
    destination,
    `soak-${new Date().toISOString().replaceAll(":", "-")}.json`,
  );
  const sourceFiles = [
    ...(await files("src/features/screen/world")),
    ...(await files("src/app/screen")),
    "src/features/screen/ScreenApp.tsx",
    "scripts/verify-destiny-pair-v2-soak.ts",
    "src/data/seed.ts",
    "src/data/questions.ts",
    "public/assets/destiny-field/ambient-act12-v2.png",
  ];
  const sourceHashes = await hashes(sourceFiles);
  const buildFile = process.env.DESTINY_SOAK_BUILD_ID_FILE || ".next/BUILD_ID";
  const buildId = (
    await readFile(buildFile, "utf8").catch(() => "unavailable")
  ).trim();
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: [
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();
  const errors: string[] = [],
    consoleErrors: string[] = [],
    knownResourceErrors: string[] = [],
    resourceFailures: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      const location = message.location().url;
      if (
        location === new URL("/favicon.ico", base).href &&
        message.text().includes("404")
      )
        knownResourceErrors.push(`${location}: ${message.text()}`);
      else
        consoleErrors.push(`${location || "unknown URL"}: ${message.text()}`);
    }
  });
  page.on("requestfailed", (request) =>
    resourceFailures.push(
      `${request.method()} ${request.url()} ${request.failure()?.errorText}`,
    ),
  );
  // Every value is fictional and lives only in this newly-created browser context.
  // The script compares each expected fixture after rendering; application writes fail validation.
  const expectedRaw = "isolated-act3-v2-business-storage-sentinel";
  await page.addInitScript(
    ({ key, value }) => localStorage.setItem(key, value),
    { key: BUSINESS_KEY, value: expectedRaw },
  );
  const samples: Sample[] = [];
  let started = Date.now(),
    monotonicStart = performance.now(),
    lastWall = started,
    lastMono = monotonicStart;
  const report = {
    status: "running" as "running" | "passed" | "failed" | "interrupted",
    requestedMinutes: minutes,
    url: `${base}${route}`,
    driver: "development-mock-three-slot-controls",
    environment: "development",
    fixtureInitialParticipants: 143,
    startedAt: "",
    productionBuildIdForSourceReferenceOnly: buildId,
    browser: browser.version(),
    host: {
      platform: os.platform(),
      arch: os.arch(),
      cpu: os.cpus()[0]?.model,
    },
    gpu: "unavailable",
    sceneId: "",
    sourceHashes,
    sourceHashesAfter: {} as Record<string, string>,
    elapsedSeconds: 0,
    observedSeconds: 0,
    sampleIntervalSeconds: 5,
    maxAllowedSampleGapSeconds: 15,
    longestSampleGapSeconds: 0,
    interruption: null as null | {
      afterSeconds: number;
      wallGapSeconds: number;
      monotonicGapSeconds: number;
    },
    verifiedThirtyMinutes: false,
    actionCounts: Object.fromEntries(
      ACTIONS.map((label) => [label, 0]),
    ) as Record<string, number>,
    samples,
    errors,
    consoleErrors,
    knownResourceErrors,
    resourceFailures,
    summary: {} as Record<string, unknown>,
    notes: [
      "Development Mock via visible controls exercises natural mode cycles, three slots, new/duplicate/burst/revoked events and offline recovery.",
      "Mock fixtures are confined to a fresh browser context and do not verify backend transport, public consent collection or domain-command eligibility.",
      "Production has no Mock entry; its readonly Adapter and anonymous boundaries are validated separately. This is not a production GPU performance claim.",
      "Browser RAF cadence is measured separately from the world renderer's own FPS.",
      "renderer.info records resource counts, not GPU allocation bytes.",
      "Physical 5–10m scan acceptance and unspecified office hardware are not verified here.",
    ],
  };
  async function save() {
    report.elapsedSeconds = (Date.now() - started) / 1000;
    await writeFile(output, JSON.stringify(report, null, 2));
    await writeFile(
      join(destination, "soak-latest.json"),
      JSON.stringify(
        {
          output,
          status: report.status,
          requestedMinutes: minutes,
          observedSeconds: report.observedSeconds,
          longestSampleGapSeconds: report.longestSampleGapSeconds,
          verifiedThirtyMinutes: report.verifiedThirtyMinutes,
        },
        null,
        2,
      ),
    );
  }
  function continuity(now: number, mono: number) {
    const wallGapSeconds = (now - lastWall) / 1000,
      monotonicGapSeconds = (mono - lastMono) / 1000;
    report.longestSampleGapSeconds = Math.max(
      report.longestSampleGapSeconds,
      wallGapSeconds,
      monotonicGapSeconds,
    );
    if (
      wallGapSeconds > 15 ||
      monotonicGapSeconds > 15 ||
      wallGapSeconds < 0 ||
      monotonicGapSeconds < 0
    ) {
      report.interruption = {
        afterSeconds: (lastMono - monotonicStart) / 1000,
        wallGapSeconds,
        monotonicGapSeconds,
      };
      throw new Error(
        `Continuous sampling interrupted (${wallGapSeconds.toFixed(2)}s wall / ${monotonicGapSeconds.toFixed(2)}s monotonic gap); sleep cannot count as a passing run.`,
      );
    }
  }
  try {
    await page.goto(`${base}${route}`);
    await page.locator(`${ROOT}[data-renderer="webgl"]`).waitFor();
    if (
      !(await page.getByTestId("world-debug").count()) ||
      (await page.locator(ROOT).getAttribute("data-source")) !== "mock"
    )
      throw new Error(
        "This stress test requires the development Mock route; never enable controls in production",
      );
    async function action(label: string) {
      const debug = page.getByTestId("world-debug");
      if ((await debug.getAttribute("open")) === null)
        await debug.locator("summary").click();
      await debug.getByRole("button", { name: label, exact: true }).click();
      await debug.locator("summary").click();
    }
    report.sceneId =
      (await page.locator(ROOT).getAttribute("data-scene-id")) || "";
    report.gpu = await page.evaluate(() => {
      const gl = document
        .querySelector<HTMLCanvasElement>('canvas[data-layer="destiny-world"]')!
        .getContext("webgl2")!;
      const extension = gl.getExtension("WEBGL_debug_renderer_info");
      return extension
        ? String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL))
        : "unavailable";
    });
    await installProbe(page);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable");
    started = lastWall = Date.now();
    monotonicStart = lastMono = performance.now();
    report.startedAt = new Date(started).toISOString();
    await save();
    let iteration = 0;
    while (report.observedSeconds < minutes * 60) {
      // The first two minutes cover the original ten fixtures, then inject one action every 20 seconds.
      if (iteration >= 24 && iteration % 4 === 0) {
        const label =
          ACTIONS[Math.floor((iteration - 24) / 4) % ACTIONS.length];
        await action(label);
        report.actionCounts[label]++;
      }
      if (iteration > 0 && iteration % 48 === 0) {
        await page.evaluate(() => {
          Object.defineProperty(document, "visibilityState", {
            configurable: true,
            value: "hidden",
          });
          document.dispatchEvent(new Event("visibilitychange"));
        });
        await delay(1000);
        await page.evaluate(() => {
          Object.defineProperty(document, "visibilityState", {
            configurable: true,
            value: "visible",
          });
          document.dispatchEvent(new Event("visibilitychange"));
        });
      }
      if (iteration > 0 && iteration % 72 === 0) {
        await page.emulateMedia({ reducedMotion: "reduce" });
        await delay(1000);
        await page.emulateMedia({ reducedMotion: "no-preference" });
      }
      await delay(5000);
      const metrics = await cdp.send("Performance.getMetrics");
      const visual = await page.evaluate(
        ({ root, businessKey, expected }) => {
          const host = document.querySelector<HTMLElement>(root)!;
          if (localStorage.getItem(businessKey) !== expected)
            throw new Error("Mock screen mutated isolated business storage");
          const probe = (window as ProbeWindow).__destinySoak;
          const values = [...(probe?.intervals || [])].sort((a, b) => a - b);
          const visible = [
            ...document.querySelectorAll<HTMLElement>(
              '[data-world-player][data-visible="true"]',
            ),
          ];
          const active = visible.filter(
            (el) => el.dataset.windowRole === "active",
          );
          const outgoing = visible.filter(
            (el) => el.dataset.windowRole === "outgoing",
          );
          const queueCounts: Record<string, number> = {};
          for (const el of active) {
            const key = el.dataset.queueKey || "missing";
            queueCounts[key] = (queueCounts[key] || 0) + 1;
          }
          return {
            world: { ...host.dataset },
            resources: JSON.parse(host.dataset.resources || "{}") as Record<
              string,
              number
            >,
            dom: document.querySelectorAll("*").length,
            canvases: document.querySelectorAll(
              'canvas[data-layer="destiny-world"]',
            ).length,
            visible: document.visibilityState,
            commits: Number(host.dataset.renderCommits || 0),
            playerNodes: document.querySelectorAll("[data-world-player]")
              .length,
            visiblePlayers: document.querySelectorAll(
              '[data-world-player][data-visible="true"]',
            ).length,
            activeWindowPlayers: active.length,
            outgoingPlayers: outgoing.length,
            queueCounts,
            unclassifiedVisiblePlayers: visible.filter(
              (el) => !active.includes(el) && !outgoing.includes(el),
            ).length,
            frameProbe: probe
              ? {
                  p50: values[Math.floor((values.length - 1) * 0.5)] || 0,
                  p95: values[Math.floor((values.length - 1) * 0.95)] || 0,
                  max: probe.maxGap,
                  frames: probe.frames,
                  longTasks: probe.longTasks,
                  longTaskMs: probe.longTaskMs,
                }
              : null,
          };
        },
        { root: ROOT, businessKey: BUSINESS_KEY, expected: expectedRaw },
      );
      const now = Date.now(),
        mono = performance.now();
      continuity(now, mono);
      lastWall = now;
      lastMono = mono;
      report.observedSeconds = (mono - monotonicStart) / 1000;
      samples.push({
        elapsedSeconds: report.observedSeconds,
        ...visual,
        metrics: Object.fromEntries(
          metrics.metrics
            .filter((m) =>
              [
                "JSHeapUsedSize",
                "JSHeapTotalSize",
                "Nodes",
                "Documents",
                "JSEventListeners",
              ].includes(m.name),
            )
            .map((m) => [m.name, m.value]),
        ),
      });
      const players = Number(visual.world.players);
      if (
        visual.world.renderer !== "webgl" ||
        visual.world.sceneId !== report.sceneId ||
        !Number.isFinite(players) ||
        players < 0 ||
        players > 60 ||
        visual.activeWindowPlayers >
          ({ CHOICE: 30, LIVE: 12, MEET: 6 }[visual.world.mode || ""] ?? 60) ||
        visual.visiblePlayers > 60 ||
        visual.outgoingPlayers > 30 ||
        visual.unclassifiedVisiblePlayers > 0 ||
        Object.entries(visual.queueCounts).some(
          ([key, count]) =>
            !key.startsWith(`${visual.world.mode}:`) ||
            count >
              (visual.world.mode === "CHOICE"
                ? 5
                : visual.world.mode === "LIVE"
                  ? 6
                  : 1),
        ) ||
        visual.playerNodes > 300 ||
        visual.canvases !== 1 ||
        Number(visual.world.particles) > 256 ||
        Number(visual.world.pairParticles) > 208 ||
        Number(visual.world.rendererPlayers) !== 0 ||
        Number(visual.world.paths) > 17 ||
        Number(visual.world.eventQueue) > 4 ||
        visual.resources.textures > 20 ||
        visual.resources.geometries > 32 ||
        visual.resources.programs > 16 ||
        !["CHOICE", "LIVE", "MEET"].includes(visual.world.mode || "")
      ) {
        const visibleDetails = await page
          .locator('[data-world-player][data-visible="true"]')
          .evaluateAll((nodes) =>
            nodes.map((node) => {
              const el = node as HTMLElement;
              const box = el.getBoundingClientRect();
              return {
                id: el.dataset.playerKey,
                role: el.dataset.windowRole,
                queue: el.dataset.queueKey,
                phase: el.dataset.queuePhase,
                opacity: getComputedStyle(el).opacity,
                x: box.x,
                y: box.y,
                width: box.width,
                height: box.height,
              };
            }),
          );
        throw new Error(
          `World invariant failed: ${JSON.stringify({
            world: visual.world,
            resources: visual.resources,
            playerNodes: visual.playerNodes,
            visiblePlayers: visual.visiblePlayers,
            activeWindowPlayers: visual.activeWindowPlayers,
            outgoingPlayers: visual.outgoingPlayers,
            queueCounts: visual.queueCounts,
            unclassifiedVisiblePlayers: visual.unclassifiedVisiblePlayers,
            visibleDetails,
          })}`,
        );
      }
      if (errors.length) throw new Error(errors.at(-1));
      if (consoleErrors.length) throw new Error(consoleErrors.at(-1));
      iteration++;
      if (iteration % 12 === 0 || report.observedSeconds >= minutes * 60) {
        await save();
        console.log(
          `Destiny Field soak ${Math.floor(report.observedSeconds / 60)} min; ${samples.length} samples; ${players} players; ${visual.world.fps || "?"} FPS`,
        );
      }
    }
    continuity(Date.now(), performance.now());
    report.sourceHashesAfter = await hashes(sourceFiles);
    if (
      JSON.stringify(report.sourceHashes) !==
      JSON.stringify(report.sourceHashesAfter)
    )
      throw new Error(
        "Source changed during verification; result does not describe a frozen build",
      );
    const heap = samples.map((s) => s.metrics.JSHeapUsedSize / 1048576);
    const frameRates = samples
      .filter((s) => s.visible === "visible")
      .map((s) => Number(s.world.fps));
    const resourceKeys = [
      ...new Set(samples.flatMap((s) => Object.keys(s.resources))),
    ];
    report.summary = {
      samples: samples.length,
      pairIdsObserved: [
        ...new Set(
          samples
            .flatMap((s) => (s.world.pairId || "").split(","))
            .filter(Boolean),
        ),
      ],
      pairPhasesObserved: [
        ...new Set(
          samples
            .filter((s) => s.world.mode === "MEET")
            .flatMap((s) => (s.world.pairPhase || "").split(",")),
        ),
      ],
      modeSamples: Object.fromEntries(
        ["CHOICE", "LIVE", "MEET"].map((mode) => [
          mode,
          samples.filter((s) => s.world.mode === mode).length,
        ]),
      ),
      intersectionSamples: samples.filter(
        (s) => s.world.intersection === "true",
      ).length,
      rendererFps: {
        min: quantile(frameRates, 0),
        p05: quantile(frameRates, 0.05),
        median: quantile(frameRates, 0.5),
      },
      jsHeapMiB: {
        min: quantile(heap, 0),
        median: quantile(heap, 0.5),
        max: quantile(heap, 1),
        firstThirdMedian: quantile(
          heap.slice(0, Math.ceil(heap.length / 3)),
          0.5,
        ),
        lastThirdMedian: quantile(heap.slice(-Math.ceil(heap.length / 3)), 0.5),
      },
      resources: Object.fromEntries(
        resourceKeys.map((key) => [
          key,
          {
            min: quantile(
              samples.map((s) => s.resources[key]),
              0,
            ),
            max: quantile(
              samples.map((s) => s.resources[key]),
              1,
            ),
            final: samples.at(-1)?.resources[key],
          },
        ]),
      ),
      dom: {
        min: quantile(
          samples.map((s) => s.dom),
          0,
        ),
        max: quantile(
          samples.map((s) => s.dom),
          1,
        ),
      },
      listeners: {
        min: quantile(
          samples.map((s) => s.metrics.JSEventListeners),
          0,
        ),
        max: quantile(
          samples.map((s) => s.metrics.JSEventListeners),
          1,
        ),
      },
      finalFrameProbe: samples.at(-1)?.frameProbe,
      consoleErrorsRequireReview: consoleErrors.length,
      resourceFailuresRequireReview: resourceFailures.length,
      limitation:
        "Passing records continuity and hard world bounds. Inspect heap/resource trends, frame cadence and any console/resource errors before accepting performance.",
    };
    if (minutes >= 30) {
      const modes = new Set(samples.map((s) => s.world.mode));
      const pairs = new Set(
        samples
          .flatMap((s) => (s.world.pairId || "").split(","))
          .filter(Boolean),
      );
      if (modes.size !== 3 || pairs.size < 10)
        throw new Error(
          "Continuous development run did not exercise all three modes and at least ten fixture pairs",
        );
    }
    report.status = "passed";
    report.verifiedThirtyMinutes = report.observedSeconds >= 1800;

    await page.screenshot({ path: join(destination, "soak-final.png") });
  } catch (error) {
    report.status = report.interruption ? "interrupted" : "failed";
    errors.push(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    await save();
    await browser.close();
    console.log(
      JSON.stringify({
        output,
        status: report.status,
        observedSeconds: report.observedSeconds,
        verifiedThirtyMinutes: report.verifiedThirtyMinutes,
      }),
    );
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
