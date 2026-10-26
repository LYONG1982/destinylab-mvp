import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { createSeed } from "../../src/data/seed";
import {
  EVIDENCE,
  BUSINESS_KEY,
  world,
  debug,
  qrImage,
  player,
  visiblePlayers,
  mock,
  click,
  capture,
  mode,
  qrPixels,
  expectQrPixels,
  identities,
  expectIdentities,
  checkPlayerBounds,
} from "./world-test-helpers";
test.beforeAll(async () => {
  await mkdir(EVIDENCE, { recursive: true });
});
test("three resolutions preserve a persistent world, generic three modes and static decodable QR", async ({
  browser,
}) => {
  test.setTimeout(180000);
  for (const [width, height] of [
    [1920, 1080],
    [2560, 1440],
    [3840, 2160],
  ]) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await mock(page);
      await mode(page, "CHOICE");
      expect(await visiblePlayers(page).count()).toBeGreaterThan(0);
      expect(await visiblePlayers(page).count()).toBeLessThanOrEqual(30);
      await identities(page);
      const qr = await qrPixels(qrImage(page));
      expect(qr.box!.width / width).toBeGreaterThanOrEqual(0.099);
      expect(qr.box!.width / width).toBeLessThanOrEqual(0.141);
      for (const state of ["CHOICE", "LIVE", "MEET"] as const) {
        await mode(page, state);
        await expectIdentities(page);
        await expect(
          page.locator('canvas[data-layer="destiny-world"]'),
        ).toHaveCount(1);
        const copy = page.getByTestId("world-mode-copy");
        await expect(copy).toContainText(
          state === "CHOICE"
            ? "今天，想怎样遇见？"
            : state === "LIVE"
              ? "正在等一次自然的靠近。"
              : "次相遇",
        );
        if (state === "MEET") await expect(copy).toContainText("已确认见面");
        const text = await page.locator("body").innerText();
        expect(text).not.toMatch(
          /银川|鼓楼|文化城|万人相亲大会|主办方|承办方|让一座城更温柔/,
        );
        const backgrounds = await page.evaluate(() =>
          [...document.querySelectorAll("*")]
            .flatMap((el) => [
              getComputedStyle(el).backgroundImage,
              getComputedStyle(el, "::before").backgroundImage,
              getComputedStyle(el, "::after").backgroundImage,
            ])
            .join("\n"),
        );
        expect(backgrounds).not.toMatch(/gulou|city-background|autumn\.png/i);
        const after = await qrPixels(qrImage(page));
        expect(after.box).toEqual(qr.box);
        await expectQrPixels(qr, after);
        const rectangles = await visiblePlayers(page).evaluateAll((nodes) =>
          nodes.map((el) => {
            const box = el.getBoundingClientRect();
            return {
              left: box.left,
              top: box.top,
              right: box.right,
              bottom: box.bottom,
            };
          }),
        );
        for (const box of rectangles) {
          expect(box.left).toBeGreaterThanOrEqual(0);
          expect(box.top).toBeGreaterThanOrEqual(0);
          expect(box.right).toBeLessThanOrEqual(width + 1);
          expect(box.bottom).toBeLessThanOrEqual(height + 1);
          const q = (await page.getByTestId("world-qr").boundingBox())!;
          expect(
            box.right <= q.x ||
              box.left >= q.x + q.width ||
              box.bottom <= q.y ||
              box.top >= q.y + q.height,
          ).toBe(true);
        }
        await capture(page, `${EVIDENCE}/${width}-${state.toLowerCase()}.png`);
      }
      await click(page, "双向确认");
      await expect(world(page)).toHaveAttribute("data-intersection", "true");
      await page.waitForTimeout(2800);
      const eventQr = await qrPixels(qrImage(page));
      expect(eventQr.box).toEqual(qr.box);
      await expectQrPixels(qr, eventQr);
      await capture(page, `${EVIDENCE}/${width}-intersection.png`);
      await expect(world(page)).toHaveAttribute("data-intersection", "false", {
        timeout: 9000,
      });
      await expectIdentities(page);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  }
});

test("intersection interrupts the current mode clock, then resumes its remaining time", async ({
  page,
}) => {
  test.setTimeout(65000);
  await mock(page);
  await click(page, "正常轮播");
  await expect(world(page)).toHaveAttribute("data-mode", "CHOICE");
  await page.waitForTimeout(4200);
  const remaining = Number(
    await world(page).getAttribute("data-mode-remaining-ms"),
  );
  expect(remaining).toBeGreaterThan(4000);
  expect(remaining).toBeLessThan(10000);
  await identities(page);
  await click(page, "双向确认");
  await expect(world(page)).toHaveAttribute("data-intersection", "true");
  await expect(world(page)).toHaveAttribute("data-mode", "CHOICE");
  await page.waitForTimeout(2500);
  const during = Number(
    await world(page).getAttribute("data-mode-remaining-ms"),
  );
  expect(Math.abs(during - remaining)).toBeLessThan(1100);
  await expect(world(page)).toHaveAttribute("data-intersection", "false", {
    timeout: 8000,
  });
  await expect(world(page)).toHaveAttribute("data-mode", "CHOICE");
  const resumed = Number(
    await world(page).getAttribute("data-mode-remaining-ms"),
  );
  expect(Math.abs(resumed - remaining)).toBeLessThan(1200);
  await expectIdentities(page);
  await expect(world(page)).toHaveAttribute("data-mode", "LIVE", {
    timeout: remaining + 2500,
  });
  await expect(world(page)).toHaveAttribute("data-mode", "MEET", {
    timeout: 10000,
  });
  await expect(world(page)).toHaveAttribute("data-mode", "CHOICE", {
    timeout: 20000,
  });
  await expectIdentities(page);
});

test("seven mock actions stay isolated from saved business state and obey density bounds", async ({
  page,
}) => {
  const saved = JSON.stringify(createSeed("discover"));
  await page.addInitScript(({ key, raw }) => localStorage.setItem(key, raw), {
    key: BUSINESS_KEY,
    raw: saved,
  });
  await mock(page);
  await expect(debug(page)).toContainText(/虚构|Mock/i);
  for (const label of [
    "加入",
    "完成问题",
    "切换选择",
    "开放认识",
    "取消开放",
    "双向确认",
    "确认见面",
  ]) {
    await click(page, label);
    if (label === "加入") {
      await expect(
        page.locator(
          '[data-world-player][data-player-field="neutral"][data-visible="true"]',
        ),
      ).toHaveCount(0);
      await expect(world(page)).toHaveAttribute("data-current", "38");
      await expect(world(page)).toHaveAttribute("data-total", "143");
    }
    if (label === "完成问题") {
      await expect(world(page)).toHaveAttribute("data-total", "144");
    }
    await expect
      .poll(() =>
        page.evaluate((key) => localStorage.getItem(key), BUSINESS_KEY),
      )
      .toBe(saved);
  }
  await click(page, "143人在场");
  await expect
    .poll(async () => Number(await world(page).getAttribute("data-players")))
    .toBeGreaterThan(0);
  expect(
    Number(await world(page).getAttribute("data-players")),
  ).toBeLessThanOrEqual(30);
  await click(page, "重置演示");
  await mode(page, "LIVE");
  await expect(page.getByTestId("world-mode-copy")).not.toContainText(
    /0\s*人.*认识|暂无.*认识/,
  );
  const availableCopy = page.locator("[data-available-copy]");
  await expect
    .poll(() =>
      availableCopy.evaluate((el) => Number(getComputedStyle(el).opacity)),
    )
    .toBe(0);
  await click(page, "开放认识");
  await expect(page.getByTestId("world-mode-copy")).toContainText(
    "有人，愿意先靠近一步。",
  );
  await expect
    .poll(() =>
      availableCopy.evaluate((el) => Number(getComputedStyle(el).opacity)),
    )
    .toBeGreaterThan(0);
  await click(page, "取消开放");
  await expect
    .poll(() =>
      availableCopy.evaluate((el) => Number(getComputedStyle(el).opacity)),
    )
    .toBe(0);
  await expect(page.getByTestId("world-mode-copy")).not.toContainText(
    /0\s*人.*认识|暂无.*认识/,
  );
  await click(page, "清空世界");
  await expect(world(page)).toHaveAttribute("data-players", "0");
  await expect(page.getByTestId("world-mode-copy")).toContainText(
    "正在等一次自然的靠近。",
  );
  await qrPixels(qrImage(page));
  expect(
    await page.evaluate((key) => localStorage.getItem(key), BUSINESS_KEY),
  ).toBe(saved);
  await capture(page, `${EVIDENCE}/empty.png`);
});

test("reduced motion retains live data and QR without an ongoing world frame loop", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mock(page);
  await click(page, "清空世界");
  await mode(page, "CHOICE");
  const start = Number(await world(page).getAttribute("data-frames"));
  await page.waitForTimeout(1600);
  const end = Number(await world(page).getAttribute("data-frames"));
  expect(end - start).toBeLessThanOrEqual(3);
  const before = Number(await world(page).getAttribute("data-current"));
  await click(page, "加入");
  await expect(world(page)).toHaveAttribute("data-current", String(before + 1));
  await expect(visiblePlayers(page)).toHaveCount(0);
  await expect(world(page)).toHaveAttribute("data-total", "0");
  await click(page, "完成问题");
  await expect(visiblePlayers(page)).toHaveCount(1);
  await expect(visiblePlayers(page)).toHaveAttribute(
    "data-player-field",
    /^q1:[0-2]$/,
  );
  const positions = await visiblePlayers(page).evaluateAll((nodes) =>
    Object.fromEntries(
      nodes.map((el) => {
        const node = el as HTMLElement;
        return [
          node.dataset.playerKey!,
          {
            field: node.dataset.playerField,
            x: node.getBoundingClientRect().x,
            y: node.getBoundingClientRect().y,
          },
        ];
      }),
    ),
  );
  await click(page, "切换选择");
  await expect
    .poll(() =>
      player(page).evaluateAll(
        (nodes, previous) =>
          nodes.some((el) => {
            const node = el as HTMLElement,
              before = previous[node.dataset.playerKey!];
            return (
              before &&
              before.field !== node.dataset.playerField &&
              Math.abs(node.getBoundingClientRect().x - before.x) > 100
            );
          }),
        positions,
      ),
    )
    .toBe(true);
  await click(page, "双向确认");
  await expect(page.getByText(/又一次交汇|愿意认识彼此/).first()).toBeVisible();
  await qrPixels(qrImage(page));
  await capture(page, `${EVIDENCE}/reduced.png`);
});

test("unavailable WebGL and actual context loss retain a generic same-data fallback and QR", async ({
  browser,
}) => {
  test.setTimeout(60000);
  for (const unavailable of [true, false]) {
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
    });
    const page = await context.newPage();
    try {
      if (unavailable)
        await page.addInitScript(() => {
          const original = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function (
            this: HTMLCanvasElement,
            type: string,
            ...args: unknown[]
          ) {
            if (
              type === "webgl" ||
              type === "webgl2" ||
              type === "experimental-webgl"
            )
              return null;
            return Reflect.apply(original, this, [type, ...args]);
          } as typeof original;
        });
      await page.goto("/screen/demo");
      if (!unavailable) {
        await expect(world(page)).toHaveAttribute("data-renderer", "webgl");
        const lost = await page.evaluate(() => {
          const canvas = document.querySelector<HTMLCanvasElement>(
            'canvas[data-layer="destiny-world"]',
          )!;
          const extension = canvas
            .getContext("webgl2")
            ?.getExtension("WEBGL_lose_context");
          extension?.loseContext();
          return !!extension;
        });
        expect(lost).toBe(true);
      }
      await expect(world(page)).toHaveAttribute("data-renderer", "fallback");
      await expect(page.getByTestId("world-mode-copy")).toContainText(
        "今天，想怎样遇见？",
      );
      expect(await player(page).count()).toBeGreaterThan(0);
      await qrPixels(qrImage(page));
      for (const state of ["CHOICE", "LIVE", "MEET"] as const) {
        await mode(page, state);
        const bounds = await visiblePlayers(page).evaluateAll((nodes) =>
          nodes.map((el) => {
            const rect = el.getBoundingClientRect();
            return {
              x: rect.x,
              y: rect.y,
              right: rect.right,
              bottom: rect.bottom,
            };
          }),
        );
        const hud = (await page.getByTestId("world-qr").boundingBox())!;
        for (const box of bounds) {
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.y).toBeGreaterThanOrEqual(0);
          expect(box.right).toBeLessThanOrEqual(1921);
          expect(box.bottom).toBeLessThanOrEqual(1081);
          expect(
            box.right <= hud.x ||
              box.x >= hud.x + hud.width ||
              box.bottom <= hud.y ||
              box.y >= hud.y + hud.height,
          ).toBe(true);
        }
      }
      await capture(
        page,
        `${EVIDENCE}/fallback-${unavailable ? "unavailable" : "context-lost"}.png`,
      );
    } finally {
      await context.close();
    }
  }
});

test("six targeted arrivals use the selected gender and choice; sparse queues remain stationary", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await mock(page);
  await click(page, "清空世界");
  await mode(page, "CHOICE");
  const labels = ["CHAT", "WALK", "SERIOUS"];
  for (let field = 0; field < 3; field++)
    for (const gender of ["male", "female"]) {
      await click(page, `ADD ${gender.toUpperCase()} TO ${labels[field]}`);
      const item = page.locator(
        `[data-world-player][data-player-field="q1:${field}"][data-player-gender="${gender}"]`,
      );
      await expect(item).toHaveCount(1);
      await expect(item).toBeVisible();
      await expect(item).toHaveAttribute("data-visible", "true");
      await expect(item.locator("img")).toHaveAttribute(
        "src",
        new RegExp(`/${gender}/${gender}_\\d+\\.png$`),
      );
    }
  await expect(world(page)).toHaveAttribute("data-total", "6");
  await expect(world(page)).toHaveAttribute("data-current", "6");
  await page.waitForTimeout(5000);
  const before = await visiblePlayers(page).evaluateAll((nodes) =>
    Object.fromEntries(
      nodes.map((el) => [
        (el as HTMLElement).dataset.playerKey,
        JSON.stringify(el.getBoundingClientRect()),
      ]),
    ),
  );
  await page.waitForTimeout(4500);
  const after = await visiblePlayers(page).evaluateAll((nodes) =>
    Object.fromEntries(
      nodes.map((el) => [
        (el as HTMLElement).dataset.playerKey,
        JSON.stringify(el.getBoundingClientRect()),
      ]),
    ),
  );
  expect(after).toEqual(before);
  const positions = await visiblePlayers(page).evaluateAll((nodes) =>
    nodes.map((el) => ({
      field: (el as HTMLElement).dataset.playerField,
      gender: (el as HTMLElement).dataset.playerGender,
      x: el.getBoundingClientRect().x,
    })),
  );
  for (let field = 0; field < 3; field++)
    expect(
      positions.find((p) => p.field === `q1:${field}` && p.gender === "male")!
        .x,
    ).toBeLessThan(
      positions.find((p) => p.field === `q1:${field}` && p.gender === "female")!
        .x,
    );
  await checkPlayerBounds(page, 1920, 1080);
});

test("overflow queues preserve every participant with five Choice or six Live slots and no duplicate or QR overlap", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await mock(page);
  await click(page, "清空世界");
  await mode(page, "CHOICE");
  for (let count = 1; count <= 11; count++) {
    await click(page, "ADD MALE TO CHAT");
    if ([1, 5, 6, 10, 11].includes(count)) {
      await expect(world(page)).toHaveAttribute("data-total", String(count));
      await page.waitForTimeout(3200);
      await expect(visiblePlayers(page)).toHaveCount(Math.min(count, 5));
    }
  }
  await identities(page);
  const samples: Array<{ keys: string[]; ys: number[] }> = [];
  const qr = await qrPixels(qrImage(page));
  for (let n = 0; n < 50; n++) {
    const rows = await visiblePlayers(page).evaluateAll((nodes) =>
      nodes.map((el) => ({
        key: (el as HTMLElement).dataset.playerKey!,
        y: el.getBoundingClientRect().y,
        field: (el as HTMLElement).dataset.playerField,
        gender: (el as HTMLElement).dataset.playerGender,
      })),
    );
    expect(rows.length).toBeLessThanOrEqual(5);
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
    expect(
      rows.every((row) => row.field === "q1:0" && row.gender === "male"),
    ).toBe(true);
    samples.push({
      keys: rows.map((row) => row.key),
      ys: rows.map((row) => row.y),
    });
    await page.waitForTimeout(200);
  }
  expect(new Set(samples.flatMap((s) => s.keys)).size).toBeGreaterThan(5);
  expect(
    samples.some(
      (s, i) => i > 0 && JSON.stringify(s) === JSON.stringify(samples[i - 1]),
    ),
  ).toBe(true);
  await expectIdentities(page);
  await expectQrPixels(qr, await qrPixels(qrImage(page)));
  // A global event pauses the independently cycling queue as well as the mode clock.
  await click(page, "双向确认");
  await expect(world(page)).toHaveAttribute("data-intersection", "true");
  await page.waitForTimeout(200);
  const paused = await visiblePlayers(page).evaluateAll((nodes) =>
    nodes.map((el) => ({
      key: (el as HTMLElement).dataset.playerKey,
      x: (el as HTMLElement).dataset.x,
      y: (el as HTMLElement).dataset.y,
      slot: (el as HTMLElement).dataset.slot,
    })),
  );
  await page.waitForTimeout(1800);
  const stillPaused = await visiblePlayers(page).evaluateAll((nodes) =>
    nodes.map((el) => ({
      key: (el as HTMLElement).dataset.playerKey,
      x: (el as HTMLElement).dataset.x,
      y: (el as HTMLElement).dataset.y,
      slot: (el as HTMLElement).dataset.slot,
    })),
  );
  expect(stillPaused).toEqual(paused);
  await expect(world(page)).toHaveAttribute("data-intersection", "false", {
    timeout: 8000,
  });
  await mode(page, "LIVE");
  await expect(visiblePlayers(page)).toHaveCount(6);
  await expectIdentities(page);
  await checkPlayerBounds(page, 1920, 1080);
  await expect(world(page)).toHaveAttribute("data-current", "11");
  await capture(page, `${EVIDENCE}/queue-overflow-live.png`);
});

test("five and twenty simultaneous arrivals aggregate feedback without losing facts or exposing production controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const sentinel = JSON.stringify({ isolated: true });
  await page.addInitScript(
    ({ key, value }) => localStorage.setItem(key, value),
    { key: BUSINESS_KEY, value: sentinel },
  );
  await mock(page);
  await click(page, "清空世界");
  await mode(page, "CHOICE");
  const qr = await qrPixels(qrImage(page));
  await click(page, "BURST ADD 5");
  await expect(world(page)).toHaveAttribute("data-total", "5");
  await click(page, "BURST ADD 20");
  await expect(world(page)).toHaveAttribute("data-total", "25");
  await expect(world(page)).toHaveAttribute("data-current", "25");
  const cues = page.locator('[data-event-target^="CHOICE:"]');
  await expect
    .poll(() =>
      cues.evaluateAll((nodes) =>
        nodes.reduce(
          (sum, el) => sum + Number(el.textContent?.replace("+", "")),
          0,
        ),
      ),
    )
    .toBe(25);
  expect(await cues.count()).toBeLessThanOrEqual(3);
  for (let field = 0; field < 3; field++) {
    const cueCount = Number(
      await page.locator(`[data-event-target="CHOICE:${field}"]`).textContent(),
    );
    const fieldCount = Number(
      await page
        .locator(`[data-field-id="q1:${field}"] p .animated-counter`)
        .getAttribute("aria-label"),
    );
    expect(cueCount).toBe(fieldCount);
  }
  for (let n = 0; n < 16; n++) {
    const members = await visiblePlayers(page).evaluateAll((nodes) =>
      nodes.map((el) => ({
        key: (el as HTMLElement).dataset.playerKey,
        queue: (el as HTMLElement).dataset.queueKey,
      })),
    );
    expect(members.length).toBeLessThanOrEqual(30);
    expect(new Set(members.map((p) => p.key)).size).toBe(members.length);
    for (const queue of new Set(members.map((p) => p.queue)))
      expect(
        members.filter((p) => p.queue === queue).length,
      ).toBeLessThanOrEqual(5);
    await page.waitForTimeout(250);
  }
  await click(page, "双向确认");
  await expect(world(page)).toHaveAttribute("data-intersection", "true");
  await page.waitForTimeout(2700);
  await expectQrPixels(qr, await qrPixels(qrImage(page)));
  expect(
    await page.evaluate((key) => localStorage.getItem(key), BUSINESS_KEY),
  ).toBe(sentinel);
  await expect(world(page)).toHaveAttribute("data-intersection", "false", {
    timeout: 9000,
  });
  await expect(world(page)).toHaveAttribute("data-total", "25");
  await expect(world(page)).toHaveAttribute("data-meetings", "0");
  await checkPlayerBounds(page, 1920, 1080);
  await capture(page, `${EVIDENCE}/burst-25-after-intersection.png`);
});

test("Choice to Live keeps female DOM identities, separates names from portraits, and fades the outgoing window", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await mock(page);
  await click(page, "清空世界");
  await mode(page, "CHOICE");
  await click(page, "BURST ADD 20");
  await expect(visiblePlayers(page)).toHaveCount(20);
  await page.waitForTimeout(3000);
  await identities(page);
  const trace = page.evaluate(
    () =>
      new Promise<{
        samples: Array<{ ms: number; visible: number; exiting: number }>;
        collisions: Array<{
          ms: number;
          id: string;
          overlap: number;
          opacity: number;
        }>;
        replaced: string[];
        commonFemale: number;
        reversedFemale: number;
        exits: Array<{
          id: string;
          opacitySamples: number[];
          lastVisible: number;
          firstHidden: number | null;
        }>;
      }>((resolve) => {
        const host = document.querySelector<HTMLElement>(
          '[data-testid="destiny-world"]',
        )!;
        const before = new Map(
          [
            ...host.querySelectorAll<HTMLElement>(
              '[data-world-player][data-visible="true"]:has(img)',
            ),
          ].map((el) => [el.dataset.playerKey!, el]),
        );
        const samples: Array<{ ms: number; visible: number; exiting: number }> =
          [];
        const collisions: Array<{
          ms: number;
          id: string;
          overlap: number;
          opacity: number;
        }> = [];
        const replaced = new Set<string>();
        const exits = new Map<
          string,
          {
            id: string;
            opacitySamples: number[];
            lastVisible: number;
            firstHidden: number | null;
          }
        >();
        let started = 0;
        const frame = (now: number) => {
          if (host.dataset.mode !== "LIVE") {
            requestAnimationFrame(frame);
            return;
          }
          if (!started) started = now;
          const ms = now - started;
          const nodes = [
            ...host.querySelectorAll<HTMLElement>(
              "[data-world-player]:has(img)",
            ),
          ];
          for (const node of nodes) {
            const id = node.dataset.playerKey!;
            if (before.has(id) && before.get(id) !== node) replaced.add(id);
            const opacity = node.hidden
              ? 0
              : Number(getComputedStyle(node).opacity);
            if (
              ms < 450 &&
              before.has(id) &&
              node.dataset.queuePhase === "exit" &&
              node.dataset.queueKey?.startsWith("CHOICE:")
            ) {
              if (!exits.has(id))
                exits.set(id, {
                  id,
                  opacitySamples: [],
                  lastVisible: 0,
                  firstHidden: null,
                });
            }
            const exit = exits.get(id);
            if (exit && ms < 1200) {
              if (node.hidden && exit.firstHidden === null)
                exit.firstHidden = ms;
              if (!node.hidden && exit.firstHidden === null) {
                exit.lastVisible = ms;
                exit.opacitySamples.push(opacity);
              }
            }
            if (node.dataset.playerGender !== "female" || opacity <= 0.1)
              continue;
            const name = node.querySelector<HTMLElement>(
              ".destiny-player-nickname",
            )!;
            const avatar = node.querySelector<HTMLElement>(
              ".destiny-player-avatar",
            )!;
            const nameOpacity =
              Number(getComputedStyle(name).opacity) * opacity;
            if (nameOpacity <= 0.1) continue;
            const n = name.getBoundingClientRect(),
              a = avatar.getBoundingClientRect();
            const overlapX =
              Math.min(n.right, a.right) - Math.max(n.left, a.left);
            const overlapY =
              Math.min(n.bottom, a.bottom) - Math.max(n.top, a.top);
            if (overlapX > 0.5 && overlapY > 0.5)
              collisions.push({
                ms,
                id,
                overlap: overlapX * overlapY,
                opacity: nameOpacity,
              });
          }
          samples.push({
            ms,
            visible: nodes.filter((el) => el.dataset.visible === "true").length,
            exiting: nodes.filter(
              (el) =>
                !el.hidden &&
                el.dataset.queuePhase === "exit" &&
                el.dataset.queueKey?.startsWith("CHOICE:"),
            ).length,
          });
          if (ms < 3400) {
            requestAnimationFrame(frame);
            return;
          }
          const commonFemale = nodes.filter(
            (el) =>
              before.has(el.dataset.playerKey!) &&
              el.dataset.playerGender === "female" &&
              el.dataset.visible === "true",
          );
          const reversedFemale = commonFemale.filter((el) => {
            const n = el
              .querySelector(".destiny-player-nickname")!
              .getBoundingClientRect();
            const a = el
              .querySelector(".destiny-player-avatar")!
              .getBoundingClientRect();
            return n.right <= a.left;
          });
          resolve({
            samples,
            collisions,
            replaced: [...replaced],
            commonFemale: commonFemale.length,
            reversedFemale: reversedFemale.length,
            exits: [...exits.values()],
          });
        };
        requestAnimationFrame(frame);
      }),
  );
  await click(page, "LIVE");
  const result = await trace;
  await writeFile(
    `${EVIDENCE}/choice-live-frame-trace.json`,
    JSON.stringify(result, null, 2),
  );
  expect(result.samples.length).toBeGreaterThan(20);
  expect(result.collisions).toEqual([]);
  expect(result.replaced).toEqual([]);
  expect(result.commonFemale).toBeGreaterThan(0);
  expect(result.reversedFemale).toBe(result.commonFemale);
  expect(result.exits.length).toBeGreaterThan(0);
  for (const exit of result.exits) {
    expect(exit.firstHidden).not.toBeNull();
    expect(exit.firstHidden!).toBeGreaterThan(500);
    expect(exit.firstHidden!).toBeLessThan(900);
    expect(exit.lastVisible).toBeGreaterThan(450);
    expect(
      exit.opacitySamples.some((opacity) => opacity > 0.1 && opacity < 0.9),
    ).toBe(true);
    for (let n = 1; n < exit.opacitySamples.length; n++)
      expect(exit.opacitySamples[n]).toBeLessThanOrEqual(
        exit.opacitySamples[n - 1] + 0.001,
      );
  }
  await expect(visiblePlayers(page)).toHaveCount(12);
  await checkPlayerBounds(page, 1920, 1080);
  await capture(page, `${EVIDENCE}/choice-live-stable-window.png`);
  // Recently hidden Choice nodes must repaint their opacity when returning from Live.
  await mode(page, "CHOICE");
  await expect(visiblePlayers(page)).toHaveCount(20);
  const restoredOpacity = await visiblePlayers(page).evaluateAll((nodes) =>
    nodes.map((el) => Number(getComputedStyle(el).opacity)),
  );
  expect(restoredOpacity.every((opacity) => opacity >= 0.99)).toBe(true);
  await expectIdentities(page);
  await capture(page, `${EVIDENCE}/choice-returned-opaque.png`);
});

// MEET now uses DOM Pair identities. Its full handoff trace lives in destiny-pair.dev.spec.ts.
