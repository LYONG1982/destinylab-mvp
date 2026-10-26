import { test, expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import {
  mock,
  click,
  world,
  mode,
  qrImage,
  qrPixels,
  expectQrPixels,
  identities,
  expectIdentities,
  capture,
  BUSINESS_KEY,
  checkPlayerBounds,
} from "./world-test-helpers";
const OUT = "docs/verification/destiny-field-act3-v2";
const pairNodes = (page: Page) =>
  page.locator(
    '[data-world-player][data-window-role="active"][data-pair-member="true"]',
  );
const captions = (page: Page) =>
  page.locator("[data-pair-caption]:not([hidden])");
const slots = (page: Page) =>
  captions(page).evaluateAll((ns) =>
    ns.map((el) => {
      const n = el as HTMLElement;
      return {
        slot: n.dataset.pairCaption,
        id: n.dataset.pairId,
        token: n.dataset.token,
        age: Number(n.dataset.elapsedMs),
        phase: n.dataset.phase,
      };
    }),
  );
test.beforeAll(async () => {
  await mkdir(OUT, { recursive: true });
});
test("0-3 pair layouts scale at 1080P, 1440P and 4K with static decodable QR", async ({
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
    page.on("pageerror", (e) => errors.push(e.message));
    try {
      await mock(page);
      const qr = await qrPixels(qrImage(page));
      await identities(page);
      for (const n of [3, 2, 1, 0]) {
        await click(page, `${n} PAIRS`);
        await mode(page, "MEET");
        await expect(pairNodes(page)).toHaveCount(n * 2);
        const details = await pairNodes(page).evaluateAll((nodes) =>
          nodes.map((el) => {
            const node = el as HTMLElement,
              avatar = el.querySelector("img")!,
              name = el.querySelector(".destiny-player-nickname")!;
            return {
              id: node.dataset.playerKey,
              pair: node.dataset.pairId,
              gender: node.dataset.playerGender,
              avatar: avatar.getBoundingClientRect().toJSON(),
              name: name.getBoundingClientRect().toJSON(),
              font: parseFloat(getComputedStyle(name).fontSize),
              src: avatar.getAttribute("src"),
              text: name.textContent,
            };
          }),
        );
        expect(new Set(details.map((d) => d.id)).size).toBe(n * 2);
        for (const d of details) {
          expect(d.avatar.width).toBeCloseTo(
            ([0, 176, 168, 152][n] * width) / 1920,
            0,
          );
          expect(d.font).toBeCloseTo(([0, 34, 32, 30][n] * width) / 1920, 1);
          expect(d.name.top).toBeGreaterThan(d.avatar.bottom);
          expect(
            Math.abs(
              d.name.x + d.name.width / 2 - d.avatar.x - d.avatar.width / 2,
            ),
          ).toBeLessThan(0.1);
          expect(d.src).toMatch(/^\/assets\/avatars\/(male|female)\//);
          expect(d.text!.length).toBeGreaterThan(0);
          expect([...d.text!].length).toBeLessThanOrEqual(5);
        }
        for (const id of new Set(details.map((d) => d.pair)))
          expect(
            details.find((d) => d.pair === id && d.gender === "male")!.avatar.x,
          ).toBeLessThan(
            details.find((d) => d.pair === id && d.gender === "female")!.avatar
              .x,
          );
        await checkPlayerBounds(page, width, height);
        await expectQrPixels(qr, await qrPixels(qrImage(page)));
        await capture(page, `${OUT}/${width}-${n}-pairs.png`);
      }
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  }
});
test("three repeated LIVE-Pair-CHOICE handoffs preserve identities without portrait jumps or visible nickname overlap", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await mock(page);
  await identities(page);
  const frames: unknown[] = [];
  for (let run = 0; run < 3; run++) {
    await mode(page, "LIVE");
    // Install the observer before the actual debug interaction. Only reads DOM; it does not drive product animation.
    await page.evaluate(() => {
      type Row = {
        id: string;
        x: number;
        y: number;
        size: number;
        opacity: number;
        overlap: boolean;
        role: string;
      };
      const w = window as unknown as Window & {
        __pairTrace?: {
          frames: { mode: string; time: number; nodes: Row[] }[];
          raf: number;
          refs: Map<string, Element>;
        };
      };
      const refs = new Map(
        [...document.querySelectorAll<HTMLElement>("[data-world-player]")].map(
          (n) => [n.dataset.playerKey!, n],
        ),
      );
      const trace = {
        frames: [] as { mode: string; time: number; nodes: Row[] }[],
        raf: 0,
        refs,
      };
      w.__pairTrace = trace;
      function tick() {
        const host = document.querySelector<HTMLElement>(
          '[data-testid="destiny-world"]',
        )!;
        const nodes = [
          ...document.querySelectorAll<HTMLElement>(
            '[data-world-player][data-visible="true"]',
          ),
        ].map((n) => {
          const a = n.querySelector("img")!.getBoundingClientRect(),
            name = n.querySelector<HTMLElement>(".destiny-player-nickname")!,
            b = name.getBoundingClientRect(),
            opacity = Number(getComputedStyle(n).opacity),
            nameOpacity = Number(getComputedStyle(name).opacity) * opacity;
          return {
            id: n.dataset.playerKey!,
            x: a.x + a.width / 2,
            y: a.y + a.height / 2,
            size: a.width,
            opacity,
            role: n.dataset.windowRole!,
            overlap:
              nameOpacity > 0.12 &&
              a.left < b.right &&
              a.right > b.left &&
              a.top < b.bottom &&
              a.bottom > b.top,
          };
        });
        trace.frames.push({
          mode: host.dataset.mode!,
          time: performance.now(),
          nodes,
        });
        trace.raf = requestAnimationFrame(tick);
      }
      trace.raf = requestAnimationFrame(tick);
    });
    await click(page, "MEET");
    await page.waitForTimeout(6700);
    await click(page, "CHOICE");
    await page.waitForTimeout(2700);
    const trace = await page.evaluate(() => {
      const w = window as unknown as Window & {
        __pairTrace: {
          frames: {
            mode: string;
            time: number;
            nodes: {
              id: string;
              x: number;
              y: number;
              size: number;
              opacity: number;
              overlap: boolean;
              role: string;
            }[];
          }[];
          raf: number;
          refs: Map<string, Element>;
        };
      };
      const t = w.__pairTrace;
      cancelAnimationFrame(t.raf);
      return {
        frames: t.frames,
        replaced: [
          ...document.querySelectorAll<HTMLElement>("[data-world-player]"),
        ].filter(
          (n) =>
            t.refs.has(n.dataset.playerKey!) &&
            t.refs.get(n.dataset.playerKey!) !== n,
        ).length,
      };
    });
    expect(trace.replaced).toBe(0);
    expect(trace.frames.length).toBeGreaterThan(200);
    for (let i = 0; i < trace.frames.length; i++) {
      const f = trace.frames[i];
      expect(
        f.nodes.filter((n) => n.role === "active").length,
      ).toBeLessThanOrEqual(f.mode === "MEET" ? 6 : 30);
      expect(f.nodes.length).toBeLessThanOrEqual(60);
      expect(f.nodes.some((n) => n.overlap)).toBe(false);
      if (i) {
        const before = new Map(trace.frames[i - 1].nodes.map((n) => [n.id, n]));
        for (const n of f.nodes) {
          const old = before.get(n.id);
          if (
            old &&
            n.opacity > 0.12 &&
            old.opacity > 0.12 &&
            f.time - trace.frames[i - 1].time < 60
          )
            expect(Math.hypot(n.x - old.x, n.y - old.y)).toBeLessThan(60);
        }
      }
    }
    frames.push(trace);
    await expectIdentities(page);
  }
  await writeFile(`${OUT}/dom-pair-handoff-trace.json`, JSON.stringify(frames));
});
test("staggered collisions, safe oldest-slot replacement and anonymous event pause", async ({
  page,
}) => {
  test.setTimeout(60000);
  await mock(page);
  await identities(page);
  await click(page, "MEET");
  const scene = await world(page).getAttribute("data-scene-id");
  const start = await slots(page);
  await page.evaluate(() => {
    const w = window as unknown as {
      __pairCollisions: number[];
      __pairRAF: number;
    };
    w.__pairCollisions = [];
    const tick = () => {
      w.__pairCollisions.push(
        document.querySelectorAll(
          '[data-pair-caption][data-phase="collision"]:not([hidden])',
        ).length,
      );
      w.__pairRAF = requestAnimationFrame(tick);
    };
    tick();
  });
  await click(page, "TRIGGER NEW MEET");
  await expect(world(page)).toHaveAttribute("data-meetings", "29");
  await page.waitForTimeout(7000);
  expect((await slots(page)).map((s) => s.id)).toEqual(start.map((s) => s.id));
  const before = await slots(page);
  await expect(world(page)).toHaveAttribute("data-pair-id", /mock-meet-10/, {
    timeout: 5000,
  });
  const after = await slots(page);
  expect(after[0].id).toBe("mock-meet-10");
  for (const i of [1, 2]) {
    expect(after[i].token).toBe(before[i].token);
    expect(after[i].age).toBeGreaterThan(before[i].age);
  }
  const trace = await page.evaluate(() => {
    const w = window as unknown as {
      __pairCollisions: number[];
      __pairRAF: number;
    };
    cancelAnimationFrame(w.__pairRAF);
    return w.__pairCollisions;
  });
  expect(Math.max(...trace)).toBe(1);
  await writeFile(`${OUT}/collision-concurrency.json`, JSON.stringify(trace));
  await click(page, "双向确认");
  await expect(world(page)).toHaveAttribute("data-intersection", "true");
  const paused = await slots(page);
  await page.waitForTimeout(2000);
  const during = await slots(page);
  expect(during.map((s) => s.token)).toEqual(paused.map((s) => s.token));
  during.forEach((s, i) =>
    expect(Math.abs(s.age - paused[i].age)).toBeLessThan(70),
  );
  await expect(world(page)).toHaveAttribute("data-intersection", "false", {
    timeout: 7000,
  });
  await expect(world(page)).toHaveAttribute("data-scene-id", scene!);
  await expectIdentities(page);
  await click(page, "3 PAIRS");
  await page.waitForTimeout(6500);
  const qr = await qrPixels(qrImage(page));
  await click(page, "TRIGGER COLLISION");
  await page.waitForTimeout(150);
  await expectQrPixels(qr, await qrPixels(qrImage(page)));
  await capture(page, `${OUT}/three-pair-collision.png`);
});
test("connection upgrade preserves identity and meeting count; duplicate and shared-person events stay safe", async ({
  page,
}) => {
  test.setTimeout(45000);
  await mock(page);
  await click(page, "0 PAIRS");
  await mode(page, "MEET");
  await click(page, "NEW CONNECTION");
  await expect(pairNodes(page)).toHaveCount(2);
  await expect(captions(page)).toContainText("建立连接");
  await expect(world(page)).toHaveAttribute("data-meetings", "28");
  const before = await slots(page);
  await click(page, "CONFIRM CONNECTION MEET");
  await expect(captions(page)).toContainText("已确认见面");
  await expect(world(page)).toHaveAttribute("data-meetings", "29");
  const upgraded = await slots(page);
  expect(upgraded[0].id).toBe(before[0].id);
  expect(upgraded[0].token).toBe(before[0].token);
  await click(page, "DUPLICATE EVENT");
  await click(page, "CONFIRM CONNECTION MEET");
  await expect(world(page)).toHaveAttribute("data-meetings", "29");
  await expect(pairNodes(page)).toHaveCount(2);
  await click(page, "3 PAIRS");
  await page.waitForTimeout(7000);
  await click(page, "SHARED PARTICIPANT");
  for (let i = 0; i < 30; i++) {
    const ids = await pairNodes(page).evaluateAll((ns) =>
      ns.map((n) => (n as HTMLElement).dataset.playerKey),
    );
    expect(ids.length).toBeLessThanOrEqual(6);
    expect(new Set(ids).size).toBe(ids.length);
    await page.waitForTimeout(100);
  }
});
test("permission revocation, offline verification, unknown statistics and avatar failure are explicit", async ({
  page,
}) => {
  test.setTimeout(50000);
  await mock(page);
  await click(page, "3 PAIRS");
  await mode(page, "MEET");
  await page.waitForTimeout(4000);
  const before = await slots(page);
  await click(page, "TRIGGER COLLISION");
  await click(page, "REVOKE ONE");
  await expect(world(page)).toHaveAttribute("data-qualified-pairs", "2");
  await expect(
    page.locator(
      '[data-world-player][data-pair-id="mock-meet-0"][data-visible="true"]',
    ),
  ).toHaveCount(0);
  expect(
    (await slots(page)).every((s) =>
      before.some((b) => b.id === s.id && b.token === s.token),
    ),
  ).toBe(true);
  await click(page, "OFFLINE VERIFIED GRANTS");
  await expect(captions(page)).toHaveCount(2);
  await expect(page.locator('[role="status"]')).toContainText("数据连接中断");
  await click(page, "OFFLINE UNKNOWN GRANTS");
  await expect(pairNodes(page)).toHaveCount(0);
  await expect(captions(page)).toHaveCount(0);
  await click(page, "RECONNECT");
  await expect(pairNodes(page)).toHaveCount(4);
  expect(
    (await captions(page).allTextContents()).some((text) =>
      text.includes("刚刚"),
    ),
  ).toBe(false);
  await click(page, "AVATAR FAILURE");
  await expect(
    page.locator(
      '[data-world-player][data-window-role="active"] .destiny-player-avatar[data-failed="true"]',
    ),
  ).toHaveCount(1);
  const failed = page.locator(
    '[data-world-player][data-window-role="active"]:has(.destiny-player-avatar[data-failed="true"])',
  );
  await expect(failed.locator(".destiny-player-nickname")).not.toBeEmpty();
  await expect(failed.locator("img")).toBeHidden();
  await click(page, "UNKNOWN STATISTICS");
  await expect(
    page.locator('[data-world-copy="MEET"] .animated-counter'),
  ).toBeHidden();
  await capture(page, `${OUT}/offline-avatar-unknown-statistics.png`);
  await qrPixels(qrImage(page));
});
test("burst is bounded, historical playback does not increment statistics or write business storage", async ({
  page,
}) => {
  test.setTimeout(40000);
  const sentinel = "act3-v2-store-sentinel";
  await page.addInitScript(
    ({ key, sentinel }) => localStorage.setItem(key, sentinel),
    { key: BUSINESS_KEY, sentinel },
  );
  await mock(page);
  await mode(page, "MEET");
  await click(page, "BURST PAIRS");
  await expect(world(page)).toHaveAttribute("data-meetings", "48");
  await page.waitForTimeout(17000);
  await expect(world(page)).toHaveAttribute("data-meetings", "48");
  expect(
    await page.evaluate((key) => localStorage.getItem(key), BUSINESS_KEY),
  ).toBe(sentinel);
  expect(
    Number(await world(page).getAttribute("data-pair-particles")),
  ).toBeLessThanOrEqual(208);
  expect(
    Number(await world(page).getAttribute("data-particles")),
  ).toBeLessThanOrEqual(256);
  await expect(world(page)).toHaveAttribute("data-renderer-players", "0");
});
test("reduced motion, missing WebGL and context loss retain all three pairs and QR", async ({
  browser,
}) => {
  test.setTimeout(90000);
  for (const fallback of ["reduce", "missing", "loss"]) {
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      reducedMotion: fallback === "reduce" ? "reduce" : "no-preference",
    });
    const page = await context.newPage();
    try {
      if (fallback === "missing")
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
      await expect(world(page)).toHaveAttribute(
        "data-renderer",
        fallback === "missing" ? "fallback" : "webgl",
      );
      await click(page, "3 PAIRS");
      await mode(page, "MEET");
      await page.waitForTimeout(4000);
      const qr = await qrPixels(qrImage(page));
      if (fallback === "loss") {
        await page.evaluate(() => {
          document
            .querySelector<HTMLCanvasElement>(
              'canvas[data-layer="destiny-world"]',
            )!
            .getContext("webgl2")!
            .getExtension("WEBGL_lose_context")!
            .loseContext();
        });
        await expect(world(page)).toHaveAttribute("data-renderer", "fallback");
      }
      await expect(pairNodes(page)).toHaveCount(6);
      await expect(captions(page)).toHaveCount(3);
      if (fallback !== "reduce")
        expect(
          await page
            .locator("[data-pair-fallback-slot]")
            .evaluateAll(
              (ns) =>
                ns.filter((n) => (n as SVGElement).style.display !== "none")
                  .length,
            ),
        ).toBe(3);
      else
        expect(
          Number(await world(page).getAttribute("data-pair-particles")),
        ).toBeLessThanOrEqual(48);
      await expectQrPixels(qr, await qrPixels(qrImage(page)));
      await capture(page, `${OUT}/three-pairs-${fallback}.png`);
    } finally {
      await context.close();
    }
  }
});

test("actual failed avatar requests retain selected identity; hidden world pauses all three slots", async ({
  page,
}) => {
  await page.route("**/assets/avatars/male/*.png", (route) =>
    route.abort("failed"),
  );
  await mock(page);
  await click(page, "3 PAIRS");
  await mode(page, "MEET");
  await page.waitForTimeout(4000);
  const failed = page.locator(
    '[data-world-player][data-window-role="active"][data-player-gender="male"]',
  );
  await expect(failed).toHaveCount(3);
  for (const node of await failed.all()) {
    await expect(node.locator("img")).toBeHidden();
    await expect(node.locator(".destiny-player-nickname")).not.toBeEmpty();
    await expect(node.locator(".destiny-player-avatar")).toHaveAttribute(
      "data-failed",
      "true",
    );
    expect(await node.locator("img").getAttribute("src")).toMatch(
      /^\/assets\/avatars\/male\//,
    );
  }
  const qr = await qrPixels(qrImage(page));
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const before = await slots(page);
  await page.waitForTimeout(1500);
  const after = await slots(page);
  expect(after).toEqual(before);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(200);
  const resumed = await slots(page);
  expect(resumed.map((s) => s.token)).toEqual(before.map((s) => s.token));
  resumed.forEach((s, i) => expect(s.age - before[i].age).toBeLessThan(500));
  await expectQrPixels(qr, await qrPixels(qrImage(page)));
  await capture(page, `${OUT}/real-avatar-request-failure.png`);
});
