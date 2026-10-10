import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { createSeed } from "../../src/data/seed";
import {
  EVIDENCE,
  BUSINESS_KEY,
  world,
  debug,
  qrImage,
  visiblePlayers,
  capture,
  qrPixels,
  expectQrPixels,
  checkPlayerBounds,
} from "./world-test-helpers";
test.beforeAll(async () => {
  await mkdir(EVIDENCE, { recursive: true });
});
test("real data initial snapshots and refreshes do not replay historic intersections or write business state", async ({
  page,
}) => {
  const saved = JSON.stringify(createSeed("broadcast"));
  await page.addInitScript(
    ({ key, raw }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, raw);
    },
    { key: BUSINESS_KEY, raw: saved },
  );
  await page.goto("/screen");
  await expect(world(page)).toHaveAttribute("data-renderer", "webgl");
  await expect(debug(page)).toHaveCount(0);
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(900);
    await expect(world(page)).toHaveAttribute("data-intersection", "false");
  }
  await page.reload();
  await expect(world(page)).toHaveAttribute("data-renderer", "webgl");
  await expect(world(page)).toHaveAttribute("data-intersection", "false");
  expect(
    await page.evaluate((key) => localStorage.getItem(key), BUSINESS_KEY),
  ).toBe(saved);
});

test("corrupt initial or live business storage stays untouched and recovery starts a fresh event baseline", async ({
  page,
}) => {
  const corrupt = JSON.stringify({
    schema: 1,
    epoch: "broken",
    participants: [],
    commands: [],
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(
    ({ key, raw }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, raw);
    },
    { key: BUSINESS_KEY, raw: corrupt },
  );
  const unavailable = page
    .getByRole("status")
    .filter({ hasText: "现场数据暂不可用，请在演示入口恢复本地数据。" });
  const publish = (raw: string) =>
    page.evaluate(
      ({ key, raw }) => {
        localStorage.setItem(key, raw);
        dispatchEvent(new StorageEvent("storage", { key }));
      },
      { key: BUSINESS_KEY, raw },
    );
  await page.goto("/screen");
  await expect(unavailable).toBeVisible();
  await expect(world(page)).toHaveCount(0);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), BUSINESS_KEY),
  ).toBe(corrupt);
  await capture(page, `${EVIDENCE}/unavailable.png`);
  const initial = createSeed("waiting");
  await publish(JSON.stringify(initial));
  await expect(world(page)).toHaveAttribute("data-renderer", "webgl");
  await expect(world(page)).toHaveAttribute("data-intersection", "false");
  const liveCorrupt = "{invalid-json";
  await publish(liveCorrupt);
  await expect(unavailable).toBeVisible();
  await expect(world(page)).toHaveCount(0);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), BUSINESS_KEY),
  ).toBe(liveCorrupt);
  const restored = createSeed("broadcast", initial.epoch);
  restored.revision = initial.revision + 1;
  const restoredRaw = JSON.stringify(restored);
  await publish(restoredRaw);
  await expect(unavailable).toHaveCount(0);
  await expect(world(page)).toHaveAttribute("data-renderer", "webgl");
  for (let n = 0; n < 5; n++) {
    await page.waitForTimeout(250);
    await expect(world(page)).toHaveAttribute("data-intersection", "false");
  }
  await expect(world(page)).toHaveAttribute("data-meetings", "28");
  expect(
    await page.evaluate((key) => localStorage.getItem(key), BUSINESS_KEY),
  ).toBe(restoredRaw);
  expect(errors).toEqual([]);
});

test("production has no development controls; three resolutions retain the approved HUD and large DOM portraits", async ({
  browser,
}) => {
  test.setTimeout(120000);
  for (const [width, height] of [
    [1920, 1080],
    [2560, 1440],
    [3840, 2160],
  ]) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    const raw = JSON.stringify(createSeed("discover"));
    await page.addInitScript(
      ({ key, value }) => localStorage.setItem(key, value),
      { key: BUSINESS_KEY, value: raw },
    );
    try {
      let first: Awaited<ReturnType<typeof qrPixels>> | undefined;
      for (const [route, state, cap, diameter, fontSize] of [
        ["question", "CHOICE", 30, 80, 24],
        ["presence", "LIVE", 12, 96, 28],
        ["real-meet", "MEET", 0, 0, 0],
      ] as const) {
        await page.goto(`/screen/${route}`);
        await expect(world(page)).toHaveAttribute("data-mode", state);
        await expect(world(page)).toHaveAttribute("data-renderer", "webgl");
        await expect(debug(page)).toHaveCount(0);
        await page.waitForTimeout(2700);
        if (state !== "MEET")
          expect(await visiblePlayers(page).count()).toBeGreaterThan(0);
        else {
          await expect(world(page)).toHaveAttribute(
            "data-qualified-pairs",
            "0",
          );
          await expect(world(page)).toHaveAttribute("data-pair-id", "");
        }
        expect(await visiblePlayers(page).count()).toBeLessThanOrEqual(cap);
        if (state !== "MEET") {
          const pictures = visiblePlayers(page).locator("img");
          expect(await pictures.count()).toBe(
            await visiblePlayers(page).count(),
          );
          const dimensions = await visiblePlayers(page).evaluateAll((nodes) =>
            nodes.map((el) => {
              const img = el.querySelector("img")!;
              const name = el.querySelector("span")!;
              return {
                width: img.getBoundingClientRect().width,
                height: img.getBoundingClientRect().height,
                font: parseFloat(getComputedStyle(name).fontSize),
                ready: img.complete && img.naturalWidth > 0,
                nickname: name.textContent || "",
              };
            }),
          );
          for (const entry of dimensions) {
            expect(entry.ready).toBe(true);
            expect(
              Math.abs(entry.width - (diameter * width) / 1920),
            ).toBeLessThan(2);
            expect(
              Math.abs(entry.height - (diameter * width) / 1920),
            ).toBeLessThan(2);
            expect(
              Math.abs(entry.font - (fontSize * width) / 1920),
            ).toBeLessThan(1);
            expect([...entry.nickname].length).toBeLessThanOrEqual(5);
          }
        }
        const code = await qrPixels(qrImage(page));
        if (first) {
          expect(code.box).toEqual(first.box);
          await expectQrPixels(first, code);
        } else first = code;
        const hud = await page.getByTestId("world-qr").evaluate((el) => {
          const box = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return {
            width: box.width,
            right: box.right,
            bottom: box.bottom,
            borderLeft: parseFloat(style.borderLeftWidth),
            borderRight: parseFloat(style.borderRightWidth),
          };
        });
        // The frozen HUD is 14%; its image excludes the two 1px borders.
        // Fractional CSS layout rounds to 1/64px, independently of viewport size.
        expect(Math.abs(hud.width - width * 0.14)).toBeLessThan(0.02);
        expect(Math.abs(hud.right - width * 0.98)).toBeLessThan(0.02);
        expect(Math.abs(hud.bottom - height * 0.965)).toBeLessThan(0.02);
        expect(hud.borderLeft).toBe(1);
        expect(hud.borderRight).toBe(1);
        expect(
          Math.abs(
            code.box!.width - (hud.width - hud.borderLeft - hud.borderRight),
          ),
        ).toBeLessThan(0.02);
        await checkPlayerBounds(page, width, height);
        const text = await page.locator("body").innerText();
        expect(text).not.toMatch(
          /银川|鼓楼|文化城|万人相亲大会|主办方|承办方|让一座城更温柔|\d{1,2}:\d{2}/,
        );
        if (state === "LIVE") {
          const copy = page.locator('[data-world-copy="LIVE"]');
          await expect(copy).toContainText("正在等一次自然的靠近。");
          expect(text).not.toMatch(
            /轻松聊聊|一起逛逛|认真认识|\d+\s*%|\d+\s*人.*(可以认识|愿意认识)/,
          );
        }
        await capture(
          page,
          `${EVIDENCE}/production-${width}-${state.toLowerCase()}.png`,
        );
      }
      await page.goto("/screen/demo");
      await expect(world(page)).toHaveAttribute("data-source", "business");
      await expect(debug(page)).toHaveCount(0);
      await expect(page).toHaveURL(/\/screen$/);
      await expect(page.locator("body")).not.toContainText("虚构演示");
      expect(
        await page.evaluate((key) => localStorage.getItem(key), BUSINESS_KEY),
      ).toBe(raw);
    } finally {
      await context.close();
    }
  }
});
