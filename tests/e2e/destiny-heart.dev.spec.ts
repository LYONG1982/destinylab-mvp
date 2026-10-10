import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import {
  mock,
  click,
  mode,
  world,
  qrPixels,
  qrImage,
  expectQrPixels,
  capture,
} from "./world-test-helpers";
const OUT = "docs/verification/destiny-field-act3-heart";
test.beforeAll(async () => {
  await mkdir(OUT, { recursive: true });
});

test("larger meeting statistic keeps responsive spacing, live counts and static QR at all three resolutions", async ({
  browser,
}) => {
  test.setTimeout(180000);
  const evidence = [];
  for (const width of [1920, 2560, 3840]) {
    const context = await browser.newContext({
        viewport: { width, height: (width * 9) / 16 },
      }),
      page = await context.newPage();
    try {
      await mock(page);
      const before = await qrPixels(qrImage(page));
      await click(page, "1 PAIRS");
      await mode(page, "MEET");
      const result = await page
        .locator('[data-world-copy="MEET"]')
        .evaluate((section) => {
          const div = section.querySelector('[class*="meetStatistic"]')!,
            number = div.querySelector('[class*="coreNumber"]')!,
            label = div.querySelector("div > span:last-child")!,
            caption = div.querySelector("p")!;
          const status = section.querySelector('[data-pair-caption="0"]')!,
            sub = section.querySelector("[data-meet-subtitle]")!;
          return {
            rect: div.getBoundingClientRect().toJSON(),
            numberFont: parseFloat(getComputedStyle(number).fontSize),
            labelFont: parseFloat(getComputedStyle(label).fontSize),
            captionFont: parseFloat(getComputedStyle(caption).fontSize),
            statusBottom: status.getBoundingClientRect().bottom,
            subtitleDuration: getComputedStyle(sub).animationDuration,
            number: number.textContent,
          };
        });
      expect(result.rect.y).toBeCloseTo((756 * width) / 1920, 0);
      expect(result.numberFont).toBeCloseTo((80 * width) / 1920, 0);
      expect(result.labelFont).toBeCloseTo((32 * width) / 1920, 0);
      expect(result.captionFont).toBeCloseTo((22 * width) / 1920, 0);
      expect(result.statusBottom).toBeLessThan(result.rect.y);
      expect(result.number).toBe("28");
      expect(result.subtitleDuration).toBe("10s");
      await expectQrPixels(before, await qrPixels(qrImage(page)));
      await capture(page, `${OUT}/statistic-${width}.png`);
      if (width === 1920) {
        await click(page, "TRIGGER NEW MEET");
        await expect(page.locator('[class*="coreNumber"]')).toHaveText("29");
        await click(page, "DUPLICATE EVENT");
        await page.waitForTimeout(600);
        await expect(page.locator('[class*="coreNumber"]')).toHaveText("29");
      }
      evidence.push({ width, ...result });
    } finally {
      await context.close();
    }
  }
  await writeFile(
    `${OUT}/statistic-layout.json`,
    JSON.stringify(evidence, null, 2),
  );
});

test("SVG heart survives missing WebGL, layout updates and withdrawal without overwriting its outline", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      ...args: unknown[]
    ) {
      if (type === "webgl2") return null;
      return Reflect.apply(original, this, [type, ...args]);
    } as typeof original;
  });
  await page.goto("/screen/demo");
  await expect(world(page)).toHaveAttribute("data-renderer", "fallback");
  await click(page, "3 PAIRS");
  await mode(page, "MEET");
  const heart = page.locator(
      '[data-pair-fallback-slot="0"] [data-pair-fallback-heart]',
    ),
    outline = await heart.getAttribute("d");
  expect(outline).toMatch(/^M.* Z$/);
  await expect(heart).toHaveAttribute("transform", /scale\(64\)/);
  await click(page, "1 PAIRS");
  await page.waitForTimeout(700);
  await expect(heart).toHaveAttribute("transform", /scale\(72\)/);
  await expect(heart).toHaveAttribute("d", outline!);
  const trails = page.locator(
    '[data-pair-fallback-slot="0"] [data-pair-fallback-trail]',
  );
  expect(await trails.first().getAttribute("d")).not.toBe(outline);
  await expect(trails).toHaveCount(2);
  await capture(page, `${OUT}/fallback-heart.png`);
  await click(page, "0 PAIRS");
  await expect(world(page)).toHaveAttribute("data-pair-count", "0");
  await expect(page.locator("[data-pair-fallback]")).toBeHidden();
});
