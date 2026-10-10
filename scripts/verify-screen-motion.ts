import { chromium } from "@playwright/test";
import { writeFile, mkdir } from "node:fs/promises";
async function main() {
  const directory = "docs/verification/screen-motion";
  await mkdir(directory, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });
  const screen = await context.newPage();
  const errors: string[] = [];
  screen.on("pageerror", (e) => errors.push(e.message));
  try {
    await screen.goto("http://localhost:3210/demo");
    await screen.getByTestId("scenario-discover").click();
    await screen.getByRole("button", { name: "确认载入", exact: true }).click();
    await screen.getByRole("dialog").waitFor({ state: "detached" });
    await screen.evaluate(() => {
      const key = "destinylab:v1.1:state",
        state = JSON.parse(localStorage.getItem(key)!);
      for (let i = state.participants.length; i < 200; i++)
        state.participants.push({
          ...state.participants[i % 100],
          id: `soak-${i}`,
          name: "测试",
          answers: { ...state.participants[i % 100].answers },
          currentId: null,
        });
      state.participants.forEach(
        (p: { present: boolean }) => (p.present = true),
      );
      state.revision++;
      localStorage.setItem(key, JSON.stringify(state));
    });
    const driver = await context.newPage();
    await driver.goto("http://localhost:3210/demo");
    await screen.goto("http://localhost:3210/screen");
    await screen.locator(".screen-qr img").waitFor();
    const cdp = await context.newCDPSession(screen);
    const samples: unknown[] = [];
    const start = Date.now();
    let iteration = 0,
      nextSample = 0;
    while (Date.now() - start <= 605000) {
      if (iteration < 120)
        await driver.evaluate((iteration) => {
          const key = "destinylab:v1.1:state",
            state = JSON.parse(localStorage.getItem(key)!);
          const p = state.participants[iteration % state.participants.length];
          const answer = ["轻松聊聊", "一起逛逛", "认真认识"][iteration % 3];
          p.answers.q1 = answer;
          state.responses[p.id] = answer;
          state.revision++;
          localStorage.setItem(key, JSON.stringify(state));
        }, iteration);
      if (Date.now() - start >= nextSample) {
        await cdp.send("HeapProfiler.collectGarbage");
        const heap = await cdp.send("Runtime.getHeapUsage");
        const sample = await screen.evaluate(() => ({
          nodes: document.querySelectorAll("*").length,
          motion: {
            ...document.querySelector<HTMLElement>(
              '[data-testid="screen-motion"]',
            )!.dataset,
          },
          canvases: document.querySelectorAll("canvas").length,
          animations: document.getAnimations().length,
          qrCount: document.querySelectorAll(".screen-qr img").length,
        }));
        samples.push({
          seconds: Math.round((Date.now() - start) / 1000),
          ...sample,
          heap,
        });
        await writeFile(
          `${directory}/soak-progress.json`,
          JSON.stringify({ samples, errors }, null, 2),
        );
        console.log(
          `Sample ${samples.length}: ${Math.round((Date.now() - start) / 1000)} seconds, heap ${heap.usedSize}, physics ${sample.motion.nodes}, canvas ${sample.canvases}`,
        );
        nextSample += 60000;
      }
      iteration++;
      await screen.waitForTimeout(2000);
    }
    await screen.screenshot({ path: `${directory}/soak-final.png` });
    await writeFile(
      `${directory}/soak-result.json`,
      JSON.stringify(
        {
          durationSeconds: Math.round((Date.now() - start) / 1000),
          simulatedSnapshots: Math.min(iteration, 120),
          participants: 200,
          samples,
          errors,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
