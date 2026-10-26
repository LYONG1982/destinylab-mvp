import { test, expect, type Locator, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import jsQR from "jsqr";
import { PNG } from "pngjs";

export const EVIDENCE = "docs/verification/destiny-field-act3-v2";
export const BUSINESS_KEY = "destinylab:v1.1:state";
export const QR_URL = "http://localhost:3210/mobile/01-start";
export const world = (page: Page) => page.getByTestId("destiny-world");
export const debug = (page: Page) => page.getByTestId("world-debug");
export const qrImage = (page: Page) =>
  page
    .locator('[data-testid="world-qr"] img, img[data-testid="world-qr"]')
    .first();
export const player = (page: Page) => page.locator("[data-world-player]");

export async function mock(page: Page) {
  await page.goto("/screen/demo");
  await expect(world(page)).toHaveAttribute("data-renderer", "webgl");
  await expect(debug(page)).toBeVisible();
  if ((await debug(page).getAttribute("open")) === null)
    await debug(page).locator("summary").click();
}
export async function click(page: Page, label: string) {
  if ((await debug(page).getAttribute("open")) === null)
    await debug(page).locator("summary").click();
  await debug(page).getByRole("button", { name: label, exact: true }).click();
}
export async function capture(page: Page, path: string) {
  if (
    (await debug(page).count()) &&
    (await debug(page).getAttribute("open")) !== null
  )
    await debug(page).locator("summary").click();
  await page.screenshot({ path });
}
export async function mode(page: Page, value: "CHOICE" | "LIVE" | "MEET") {
  await click(page, value);
  await expect(world(page)).toHaveAttribute("data-mode", value);
  // World transitions have settled; a screenshot never proves their continuity alone.
  await page.waitForTimeout(2600);
}
export async function qrPixels(code: Locator) {
  await expect(code).toBeVisible();
  const bytes = await code.screenshot();
  const png = PNG.sync.read(bytes);
  expect(
    jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data,
  ).toBe(QR_URL);
  return {
    bytes,
    pixelsHash: createHash("sha256").update(png.data).digest("hex"),
    box: await code.boundingBox(),
  };
}
export async function expectQrPixels(
  before: Awaited<ReturnType<typeof qrPixels>>,
  after: Awaited<ReturnType<typeof qrPixels>>,
) {
  if (before.pixelsHash !== after.pixelsHash) {
    await test
      .info()
      .attach("qr-before", { body: before.bytes, contentType: "image/png" });
    await test
      .info()
      .attach("qr-after", { body: after.bytes, contentType: "image/png" });
  }
  expect(after.pixelsHash).toBe(before.pixelsHash);
}
export async function identities(page: Page) {
  await page.evaluate(() => {
    const target = window as Window & {
      __worldIdentity?: {
        canvas: Element | null;
        players: Map<string, Element>;
      };
    };
    target.__worldIdentity = {
      canvas: document.querySelector('canvas[data-layer="destiny-world"]'),
      players: new Map(
        [
          ...document.querySelectorAll<HTMLElement>(
            "[data-world-player]:has(img)",
          ),
        ].map((el) => [el.dataset.playerKey || "", el]),
      ),
    };
  });
}
export async function expectIdentities(page: Page) {
  const result = await page.evaluate(() => {
    const old = (
      window as Window & {
        __worldIdentity?: {
          canvas: Element | null;
          players: Map<string, Element>;
        };
      }
    ).__worldIdentity!;
    const current = [
      ...document.querySelectorAll<HTMLElement>("[data-world-player]:has(img)"),
    ];
    return {
      canvas:
        old.canvas ===
        document.querySelector('canvas[data-layer="destiny-world"]'),
      count: current.length,
      same: current
        .filter((el) => old.players.has(el.dataset.playerKey || ""))
        .every((el) => old.players.get(el.dataset.playerKey || "") === el),
      common: current.filter((el) =>
        old.players.has(el.dataset.playerKey || ""),
      ).length,
      previousCount: old.players.size,
    };
  });
  expect(result.canvas).toBe(true);
  expect(result.count).toBeGreaterThan(0);
  expect(result.same).toBe(true);
  expect(result.common).toBeGreaterThan(0);
}

export const visiblePlayers = (page: Page) =>
  page.locator('[data-world-player][data-visible="true"]');

export async function checkPlayerBounds(
  page: Page,
  width: number,
  height: number,
) {
  const hud = (await page.getByTestId("world-qr").boundingBox())!;
  const boxes = await visiblePlayers(page).evaluateAll((nodes) =>
    nodes.map((el) => {
      const b = el.getBoundingClientRect();
      return { x: b.x, y: b.y, right: b.right, bottom: b.bottom };
    }),
  );
  for (const box of boxes) {
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.y).toBeGreaterThanOrEqual(-1);
    expect(box.right).toBeLessThanOrEqual(width + 1);
    expect(box.bottom).toBeLessThanOrEqual(height + 1);
    expect(
      box.right <= hud.x ||
        box.x >= hud.x + hud.width ||
        box.bottom <= hud.y ||
        box.y >= hud.y + hud.height,
    ).toBe(true);
  }
}
