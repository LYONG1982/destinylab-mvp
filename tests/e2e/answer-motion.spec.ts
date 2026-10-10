import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import type { DemoState } from "../../src/domain/types";

const KEY = "destinylab:v1.1:state";
const evidence =
  "docs/verification/destiny-field-act3-v2/regression/answer-motion";
test.use({ reducedMotion: "no-preference" });
async function scenario(page: Page, name = "discover") {
  await page.goto("/demo");
  await page.getByTestId(`scenario-${name}`).click();
  await page.getByRole("button", { name: "确认载入", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
const saved = (page: Page): Promise<DemoState> =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), KEY);
async function question(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await scenario(page);
  await page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key)!) as DemoState;
    state.participants[0].answers = { q1: "一起逛逛" };
    localStorage.setItem(key, JSON.stringify(state));
  }, KEY);
  await page.goto("/mobile/04-question?actor=p-shanfeng");
  await expect(page.locator(".question-progress strong")).toHaveText("02");
}
async function record(name: string, data: unknown) {
  await mkdir(evidence, { recursive: true });
  await writeFile(`${evidence}/${name}.json`, JSON.stringify(data, null, 2));
}

test("single choice saves once, failed answers stay selected and rapid retry cannot skip a question", async ({
  page,
}) => {
  await question(page);
  const before = await saved(page);
  await page.evaluate(() =>
    sessionStorage.setItem("destinylab:fail-next", "yes"),
  );
  await page.getByRole("button", { name: "热闹街区", exact: true }).click();
  await expect(
    page.getByText("模拟连接中断，本次操作未提交，请重试。", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".question-progress strong")).toHaveText("02");
  await expect(
    page.getByRole("button", { name: "热闹街区", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect((await saved(page)).participants[0].answers.q2).toBeUndefined();
  await page.locator(".answer-card").evaluateAll((buttons) => {
    (buttons[0] as HTMLButtonElement).click();
    (buttons[1] as HTMLButtonElement).click();
    (buttons[0] as HTMLButtonElement).click();
  });
  await expect(page.locator(".question-progress strong")).toHaveText("03");
  await expect(page.locator(".question-transition")).toHaveAttribute(
    "data-phase",
    "idle",
  );
  const after = await saved(page);
  expect(after.participants[0].answers.q2).toBe("热闹街区");
  expect(after.participants[0].answers.q3).toBeUndefined();
  expect(
    after.events.filter((event) => event.type === "ANSWER").length -
      before.events.filter((event) => event.type === "ANSWER").length,
  ).toBe(1);
  await expect(
    page.getByRole("button", { name: "下一题", exact: true }),
  ).toHaveCount(0);
});

test("first answer has no preset or extra submit; readiness stays in two equal columns at five widths", async ({
  page,
}) => {
  await scenario(page, "fresh");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/mobile/01-start");
  await expect(page.locator(".intent-card.selected")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "开始今天的遇见" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /一起逛逛/ }).click();
  await expect(page).toHaveURL(/02-result/);
  await page.getByRole("button", { name: "看看现场还有谁和我一样" }).click();
  await expect(page.locator(".readiness button")).toHaveCount(2);
  const measurements = [];
  for (const width of [320, 360, 390, 393, 430]) {
    await page.setViewportSize({ width, height: 844 });
    const boxes = await page.locator(".readiness button").evaluateAll((nodes) =>
      nodes.map((node) => {
        const { x, y, width, height, right } = node.getBoundingClientRect();
        return {
          x,
          y,
          width,
          height,
          right,
          overflow: node.scrollWidth > node.clientWidth,
        };
      }),
    );
    expect(boxes).toHaveLength(2);
    expect(boxes[0].y).toBe(boxes[1].y);
    expect(boxes[0].height).toBe(boxes[1].height);
    expect(boxes[0].width).toBeCloseTo(boxes[1].width, 1);
    expect(boxes[0].height).toBeGreaterThanOrEqual(44);
    expect(boxes[0].right).toBeLessThan(boxes[1].x);
    expect(boxes[1].right).toBeLessThanOrEqual(width);
    expect(boxes.some((box) => box.overflow)).toBe(false);
    measurements.push({ width, boxes });
    if (width === 320 || width === 390)
      await page.screenshot({
        path: `${evidence}/readiness-${width}.png`,
        fullPage: true,
      });
  }
  await record("readiness-widths", measurements);
});

test("mobile frame trace has one question, monotonic entry, stable x and scroll through forward and back", async ({
  page,
}) => {
  await question(page);
  const capture = (page: Page) =>
    page.evaluate(
      () =>
        new Promise<
          Array<{
            q: string;
            opacity: number;
            x: number;
            y: number;
            height: number;
            scroll: number;
            headings: number;
            copies: number;
          }>
        >((resolve) => {
          const frames: Array<{
            q: string;
            opacity: number;
            x: number;
            y: number;
            height: number;
            scroll: number;
            headings: number;
            copies: number;
          }> = [];
          const start = performance.now();
          function tick() {
            const el = document.querySelector<HTMLElement>(
              ".question-transition",
            )!;
            const box = el.getBoundingClientRect();
            frames.push({
              q: el.dataset.question!,
              opacity: Number(getComputedStyle(el).opacity),
              x: box.x,
              y: box.y,
              height: box.height,
              scroll: scrollY,
              headings: el.querySelectorAll("h1").length,
              copies: document.querySelectorAll(".question-outgoing").length,
            });
            if (performance.now() - start < 1000) requestAnimationFrame(tick);
            else resolve(frames);
          }
          requestAnimationFrame(tick);
        }),
    );
  for (const direction of ["forward", "back"] as const) {
    const pending = capture(page);
    await page
      .getByRole("button", {
        name: direction === "forward" ? "热闹街区" : "返回上一题",
        exact: true,
      })
      .click();
    const frames = await pending;
    await record(`mobile-${direction}-frames`, frames);
    const target = direction === "forward" ? "q3" : "q2";
    const entry = frames.filter((frame) => frame.q === target);
    expect(entry.length).toBeGreaterThan(5);
    expect(entry[0].opacity).toBeLessThan(0.8);
    expect(entry.at(-1)!.opacity).toBe(1);
    expect(
      frames.every((frame) => frame.headings === 1 && frame.copies === 0),
    ).toBe(true);
    expect(
      Math.max(...frames.map((f) => f.x)) - Math.min(...frames.map((f) => f.x)),
    ).toBeLessThan(0.1);
    expect(
      Math.max(...frames.map((f) => f.scroll)) -
        Math.min(...frames.map((f) => f.scroll)),
    ).toBe(0);
    expect(
      Math.max(...frames.map((f) => f.height)) -
        Math.min(...frames.map((f) => f.height)),
    ).toBeLessThan(2);
    for (let i = 1; i < entry.length; i++)
      expect(entry[i].opacity + 0.001).toBeGreaterThanOrEqual(
        entry[i - 1].opacity,
      );
  }
});

test("slow answers lock controls; hidden completion and epoch reset cannot advance an old task", async ({
  page,
  context,
}) => {
  await question(page);
  await page.evaluate(() => sessionStorage.setItem("destinylab:delay", "1600"));
  await page.getByRole("button", { name: "热闹街区", exact: true }).click();
  await expect(page.locator(".back-link")).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "安静咖啡馆", exact: true }),
  ).toBeDisabled();
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect
    .poll(async () => (await saved(page)).participants[0].answers.q2)
    .toBe("热闹街区");
  await expect(page.locator(".question-progress strong")).toHaveText("02");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(
    page.getByRole("button", { name: "热闹街区", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "热闹街区", exact: true }).click();
  const hub = await context.newPage();
  await scenario(hub, "fresh");
  await page.waitForTimeout(1800);
  expect((await saved(page)).participants[0].answers).toEqual({});
  await expect(page).toHaveURL(/01-start/);
  await hub.close();
});

test("three full World cycles preserve Scene and Player identities without replaying stable counters", async ({
  page,
}) => {
  test.setTimeout(135000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await scenario(page);
  await page.goto("/screen");
  await expect(page.getByTestId("destiny-world")).toHaveAttribute(
    "data-renderer",
    "webgl",
  );
  await expect(page.getByTestId("world-qr").locator("img")).toBeVisible();
  const result = await page.evaluate(
    () =>
      new Promise<{
        modes: string[];
        violations: string[];
        samples: unknown[];
      }>((resolve) => {
        const host = document.querySelector<HTMLElement>(
          '[data-testid="destiny-world"]',
        )!;
        const canvas = host.querySelector('canvas[data-layer="destiny-world"]');
        const names = new Map(
          [
            ...host.querySelectorAll<HTMLElement>(
              "[data-world-player]:has(img)",
            ),
          ].map((el) => [el.dataset.playerKey, el]),
        );
        const qr = host.querySelector<HTMLImageElement>(
          '[data-testid="world-qr"] img',
        )!;
        const source = qr.src,
          box = JSON.stringify(qr.getBoundingClientRect());
        const modes: string[] = [],
          violations: string[] = [],
          samples: unknown[] = [];
        let previous = "";
        const start = performance.now();
        const issue = (text: string) => {
          if (!violations.includes(text)) violations.push(text);
        };
        const tick = (at: number) => {
          const mode = host.dataset.mode!;
          if (mode !== previous) {
            previous = mode;
            modes.push(mode);
            samples.push({ ms: Math.round(at - start), mode });
          }
          if (
            canvas !== host.querySelector('canvas[data-layer="destiny-world"]')
          )
            issue("Canvas replaced");
          if (
            document.querySelectorAll('[data-testid="destiny-world"]')
              .length !== 1
          )
            issue("duplicate World");
          if (document.querySelector(".screen-scene-outgoing"))
            issue("obsolete outgoing page exists");
          for (const el of host.querySelectorAll<HTMLElement>(
            "[data-world-player]:has(img)",
          )) {
            if (
              names.has(el.dataset.playerKey) &&
              names.get(el.dataset.playerKey) !== el
            )
              issue("Player instance replaced");
            names.set(el.dataset.playerKey, el);
          }
          if (at - start > 1500)
            for (const counter of host.querySelectorAll<HTMLElement>(
              ".animated-counter",
            ))
              if (counter.textContent !== counter.getAttribute("aria-label"))
                issue("stable counter replayed");
          if (
            qr.src !== source ||
            JSON.stringify(qr.getBoundingClientRect()) !== box ||
            getComputedStyle(qr).opacity !== "1" ||
            getComputedStyle(qr).transform !== "none"
          )
            issue("QR changed");
          if (at - start < 115000) requestAnimationFrame(tick);
          else resolve({ modes, violations, samples });
        };
        requestAnimationFrame(tick);
      }),
  );
  await mkdir("docs/verification/destiny-field-act3-v2", { recursive: true });
  await writeFile(
    "docs/verification/destiny-field-act3-v2/three-world-cycles.json",
    JSON.stringify(result, null, 2),
  );
  expect(result.modes).toEqual([
    "CHOICE",
    "LIVE",
    "MEET",
    "CHOICE",
    "LIVE",
    "MEET",
    "CHOICE",
    "LIVE",
    "MEET",
    "CHOICE",
  ]);
  expect(result.violations).toEqual([]);
});

test("changing motion preference during question exit completes once and keeps controls usable", async ({
  page,
}) => {
  await question(page);
  await page.evaluate(() => {
    const original = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      const animation = original.apply(this, args);
      if (
        this.matches(".question-transition") &&
        (this as HTMLElement).dataset.phase === "leaving"
      )
        animation.updatePlaybackRate(0.1);
      return animation;
    };
  });
  await page.getByRole("button", { name: "热闹街区", exact: true }).click();
  await expect(page.locator(".question-transition")).toHaveAttribute(
    "data-phase",
    "leaving",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".question-progress strong")).toHaveText("03");
  await expect(
    page.getByRole("button", { name: "美食与探店", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".question-transition")).toHaveJSProperty(
    "inert",
    false,
  );
  expect((await saved(page)).participants[0].answers.q3).toBeUndefined();
});

test("a real second confirmation animates 28 to 29 without zero or overshoot", async ({
  page,
  context,
}) => {
  await scenario(page, "one-confirm");
  const screen = await context.newPage();
  await screen.setViewportSize({ width: 1920, height: 1080 });
  await screen.goto("/screen/real-meet");
  await expect(
    screen.locator('[data-world-copy="MEET"] .animated-counter'),
  ).toHaveText("28");
  await page.goto("/mobile/09-meet?actor=p-shanfeng");
  const samples = screen.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        const values: number[] = [],
          start = performance.now();
        function tick(now: number) {
          values.push(
            Number(
              document.querySelector(
                '[data-world-copy="MEET"] .animated-counter',
              )!.textContent,
            ),
          );
          if (now - start < 2000) requestAnimationFrame(tick);
          else resolve(values);
        }
        requestAnimationFrame(tick);
      }),
  );
  await page
    .getByRole("button", { name: "我已经见到 TA", exact: true })
    .click();
  const values = await samples;
  await record("real-meet-28-29", values);
  expect(values[0]).toBe(28);
  expect(values.at(-1)).toBe(29);
  expect(
    values.every(
      (value, index) =>
        value >= 28 && value <= 29 && (!index || value >= values[index - 1]),
    ),
  ).toBe(true);
  await screen.close();
});

test("rapid statistical updates continue from painted values; reduce and hidden settle on latest values", async ({
  page,
}) => {
  await scenario(page);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/screen/question");
  const row = page.locator("[data-field-id]").filter({ hasText: "轻松聊聊" });
  await expect(row.locator(":scope > span")).toHaveText("33%");
  const samples = await page.evaluate(async (key) => {
    const row = [...document.querySelectorAll("[data-field-id]")].find((el) =>
      el.textContent!.includes("轻松聊聊"),
    )!;
    const number = row.querySelector<HTMLElement>(
      ":scope > span [data-number]",
    )!;
    const values: Array<{ time: number; percentage: number; number: number }> =
      [];
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      values.push({
        time: now - start,
        percentage: Number(number.textContent),
        number: Number(number.textContent),
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    // Isolated test fixture updates use the same storage notification as another tab.
    function setPercentage(percentage: number) {
      const state = JSON.parse(localStorage.getItem(key)!) as DemoState;
      state.responses = Object.fromEntries(
        Array.from({ length: 100 }, (_, i) => [
          `fixture-${i}`,
          i < percentage ? "轻松聊聊" : "一起逛逛",
        ]),
      );
      state.revision++;
      localStorage.setItem(key, JSON.stringify(state));
      dispatchEvent(new StorageEvent("storage", { key }));
    }
    setPercentage(80);
    await new Promise((resolve) => setTimeout(resolve, 80));
    setPercentage(10);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    cancelAnimationFrame(frame);
    return values;
  }, KEY);
  await record("rapid-stat-updates", samples);
  expect(samples.at(-1)!.number).toBe(10);
  expect(Math.max(...samples.map((sample) => sample.percentage))).toBeLessThan(
    65,
  );
  for (let i = 1; i < samples.length; i++) {
    // Bound visual speed by elapsed time, allowing a frame to be delayed by the host.
    expect(
      Math.abs(samples[i].percentage - samples[i - 1].percentage),
    ).toBeLessThan((samples[i].time - samples[i - 1].time) * 0.35 + 1);
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(row.locator(":scope > span")).toHaveText("10%");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByTestId("destiny-world")).toHaveAttribute(
    "data-running",
    "false",
  );
  await expect(page.locator(".screen-scene-outgoing")).toHaveCount(0);
});

test("legacy broadcast metadata cannot trigger Intersection or restart the World mode clock", async ({
  page,
}) => {
  test.setTimeout(25000);
  await scenario(page, "broadcast");
  await page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key)!) as DemoState;
    state.broadcastConsumed = state.invitations.map((i) => i.id);
    localStorage.setItem(key, JSON.stringify(state));
  }, KEY);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/screen");
  const world = page.getByTestId("destiny-world");
  await expect(world).toHaveAttribute("data-renderer", "webgl");
  await expect(world).toHaveAttribute("data-mode", "CHOICE");
  await page.waitForTimeout(7000);
  await page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key)!) as DemoState;
    state.broadcastConsumed = [];
    state.revision++;
    localStorage.setItem(key, JSON.stringify(state));
    dispatchEvent(new StorageEvent("storage", { key }));
  }, KEY);
  await expect(world).toHaveAttribute("data-intersection", "false");
  await expect(world).toHaveAttribute("data-mode", "LIVE", { timeout: 6500 });
  expect((await saved(page)).broadcastConsumed).toEqual([]);
  await expect(world).toHaveAttribute("data-intersection", "false");
});
