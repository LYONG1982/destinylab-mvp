/** Real wall-clock soak. Run with: npx tsx scripts/verify-relationship-soak.ts */
import { chromium } from "@playwright/test";
import { createSeed } from "../src/data/seed";
import { applyCommand } from "../src/domain/commands";
import { QUESTIONS } from "../src/data/questions";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import { setTimeout as delay } from "node:timers/promises";
async function main() {
  const base = process.env.DESTINY_SOAK_URL || "http://localhost:3210";
  const minutes = Number(process.env.DESTINY_SOAK_MINUTES || 240);
  if (!Number.isFinite(minutes) || minutes < 1)
    throw new Error("Invalid soak duration");
  const destination =
    process.env.DESTINY_SOAK_OUTPUT_DIR ||
    "docs/verification/screen-relationship";
  await mkdir(destination, { recursive: true });
  let started = Date.now();
  const stamp = new Date(started).toISOString().replaceAll(":", "-");
  const output = `${destination}/soak-${stamp}.json`;
  const sources = [
    "src/components/motion/screen/relationship/DestinyWorld.ts",
    "src/components/motion/screen/relationship/layout.ts",
    "src/components/motion/screen/relationship/RelationshipStage.tsx",
    "src/components/motion/screen/controller.ts",
    "src/components/motion/screen/ScreenMotion.tsx",
    "src/components/motion/screen/frame-loop.ts",
    "src/components/motion/screen/model.ts",
    "src/features/screen/ScreenApp.tsx",
    "src/app/globals.css",
    "scripts/verify-relationship-soak.ts",
  ];
  const sourceHashes = Object.fromEntries(
    await Promise.all(
      sources.map(async (file) => [
        file,
        createHash("sha256")
          .update(await readFile(file))
          .digest("hex"),
      ]),
    ),
  );
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
  let state = createSeed("discover");
  state.participants = state.participants.map((p) => ({ ...p, present: true }));
  const errors: string[] = [],
    knownResourceErrors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") {
      if (m.text().includes("404")) knownResourceErrors.push(m.text());
      else errors.push(m.text());
    }
  });
  await page.addInitScript(
    (s) => localStorage.setItem("destinylab:v1.1:state", JSON.stringify(s)),
    state,
  );
  await page.goto(`${base}/screen`);
  await page.locator('.relationship-stage[data-renderer="webgl"]').waitFor();
  started = Date.now(); // Measure the full duration after the WebGL stage is ready.
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  const gpu = await page.evaluate(() => {
    const gl = document
      .querySelector<HTMLCanvasElement>('[data-layer="destiny-world"]')!
      .getContext("webgl2")!;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unavailable";
  });
  const samples: unknown[] = [];
  const report = {
    status: "running",
    requestedMinutes: minutes,
    startedAt: new Date(started).toISOString(),
    elapsedSeconds: 0,
    browser: browser.version(),
    host: {
      platform: os.platform(),
      arch: os.arch(),
      cpu: os.cpus()[0]?.model,
    },
    gpu,
    sourceHashes,
    samples,
    errors,
    knownResourceErrors,
    sampleIntervalSeconds: 5,
    maxAllowedSampleGapSeconds: 15,
    longestSampleGapSeconds: 0,
    observedSeconds: 0,
    interruption: null as null | {
      afterSeconds: number;
      gapSeconds: number;
    },
    verifiedFourHours: false,
  };
  let lastSampleAt = started;
  const checkContinuity = (now: number) => {
    const gapSeconds = (now - lastSampleAt) / 1000;
    report.longestSampleGapSeconds = Math.max(
      report.longestSampleGapSeconds,
      gapSeconds,
    );
    if (gapSeconds > report.maxAllowedSampleGapSeconds || gapSeconds < 0) {
      report.interruption = {
        afterSeconds: (lastSampleAt - started) / 1000,
        gapSeconds,
      };
      throw new Error(
        `Continuous run interrupted: ${gapSeconds.toFixed(3)}s sampling gap. Sleep, clock changes, or process suspension cannot count as running time.`,
      );
    }
  };
  let iteration = 0;
  try {
    while (Date.now() - started < minutes * 60000) {
      // Exercise real domain transitions against an isolated browser's fictional state.
      for (let i = 0; i < 8; i++) {
        const actor =
          state.participants[(iteration * 7 + i) % state.participants.length]
            .id;
        state = applyCommand(
          state,
          {
            actor,
            epoch: state.epoch,
            id: `soak-${iteration}-${i}`,
            command: {
              type: "answer",
              questionId: "q1",
              value: QUESTIONS[0].options[(iteration + i) % 3],
            },
          },
          state.now,
        );
      }
      if (iteration > 0 && iteration % 60 === 0) {
        state = createSeed("discover");
        state.participants = state.participants.map((p) => ({
          ...p,
          present: true,
        }));
      }
      await page.evaluate((s) => {
        localStorage.setItem("destinylab:v1.1:state", JSON.stringify(s));
        dispatchEvent(
          new StorageEvent("storage", { key: "destinylab:v1.1:state" }),
        );
      }, state);
      if (iteration > 0 && iteration % 15 === 0) {
        await page.evaluate(() => {
          Object.defineProperty(document, "visibilityState", {
            configurable: true,
            value: "hidden",
          });
          document.dispatchEvent(new Event("visibilitychange"));
        });
        await delay(1500);
        await page.evaluate(() => {
          Object.defineProperty(document, "visibilityState", {
            configurable: true,
            value: "visible",
          });
          document.dispatchEvent(new Event("visibilitychange"));
        });
      }
      if (iteration > 0 && iteration % 30 === 0) {
        await page.emulateMedia({ reducedMotion: "reduce" });
        await delay(1500);
        await page.emulateMedia({ reducedMotion: "no-preference" });
      }
      // Sample one full natural rotation: includes both Three.js and existing Canvas 2D.
      for (
        let second = 0;
        second < 60 && Date.now() - started < minutes * 60000;
        second += 5
      ) {
        await delay(5000);
        const metrics = await cdp.send("Performance.getMetrics");
        const visual = await page.evaluate(() => {
          const stage = document.querySelector<HTMLElement>(
            ".relationship-stage",
          )!;
          const motion = document.querySelector<HTMLElement>(
            '[data-testid="screen-motion"]',
          )!;
          return {
            scene: document.querySelector<HTMLElement>("[data-scene-current]")
              ?.dataset.sceneCurrent,
            world: { ...stage.dataset },
            canvas: { ...motion.dataset },
            dom: document.querySelectorAll("*").length,
            canvases: document.querySelectorAll("canvas").length,
            visible: document.visibilityState,
          };
        });
        const sample = {
          elapsedSeconds: (Date.now() - started) / 1000,
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
        };
        samples.push(sample);
        const sampledAt = Date.now();
        checkContinuity(sampledAt);
        lastSampleAt = sampledAt;
        report.observedSeconds = (sampledAt - started) / 1000;
        if (
          visual.world.renderer !== "webgl" ||
          Number(visual.world.queue) > 32 ||
          Number(visual.world.nodes) > 36 ||
          Number(visual.world.paths) > 5 ||
          visual.canvases !== 4
        )
          throw new Error(`Visual bound failed: ${JSON.stringify(visual)}`);
        if (errors.length) throw new Error(errors.at(-1));
      }
      iteration++;
      report.elapsedSeconds = (Date.now() - started) / 1000;
      await writeFile(output, JSON.stringify(report, null, 2));
      await writeFile(
        `${destination}/soak-latest.json`,
        JSON.stringify(
          {
            output,
            elapsedSeconds: report.elapsedSeconds,
            status: report.status,
            iterations: iteration,
          },
          null,
          2,
        ),
      );
      if (iteration % 5 === 0)
        console.log(
          `Soak ${Math.floor(report.elapsedSeconds / 60)} min; ${samples.length} samples; no bound violations`,
        );
    }
    checkContinuity(Date.now());
    if (report.observedSeconds < minutes * 60)
      throw new Error("Observed sample duration did not reach the target");
    report.status = "passed";
    report.elapsedSeconds = (Date.now() - started) / 1000;
    report.verifiedFourHours = report.observedSeconds >= 14400;
    await page.screenshot({ path: `${destination}/soak-final.png` });
  } catch (error) {
    report.status = report.interruption ? "interrupted" : "failed";
    errors.push(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    report.elapsedSeconds = (Date.now() - started) / 1000;
    await writeFile(output, JSON.stringify(report, null, 2));
    await writeFile(
      `${destination}/soak-latest.json`,
      JSON.stringify(
        {
          output,
          elapsedSeconds: report.elapsedSeconds,
          status: report.status,
          verifiedFourHours: report.verifiedFourHours,
        },
        null,
        2,
      ),
    );
    await browser.close();
    console.log(
      JSON.stringify({
        output,
        status: report.status,
        elapsedSeconds: report.elapsedSeconds,
        verifiedFourHours: report.verifiedFourHours,
      }),
    );
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
