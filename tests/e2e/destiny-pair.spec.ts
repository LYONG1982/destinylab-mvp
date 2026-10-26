import { test, expect } from "@playwright/test";
import { createSeed } from "../../src/data/seed";
import {
  world,
  debug,
  qrImage,
  qrPixels,
  expectQrPixels,
  BUSINESS_KEY,
  capture,
} from "./world-test-helpers";
test("production real meet remains anonymous without pair permission, including history reload and zero", async ({
  page,
}) => {
  const fixture = createSeed("broadcast");
  const raw = JSON.stringify(fixture);
  await page.addInitScript(({ key, raw }) => localStorage.setItem(key, raw), {
    key: BUSINESS_KEY,
    raw,
  });
  await page.goto("/screen/real-meet");
  await expect(world(page)).toHaveAttribute("data-renderer", "webgl");
  await expect(world(page)).toHaveAttribute("data-qualified-pairs", "0");
  await expect(world(page)).toHaveAttribute("data-meetings", "28");
  await page.waitForTimeout(2800);
  await expect(
    page.locator('[data-world-player][data-visible="true"]'),
  ).toHaveCount(0);
  await expect(page.getByTestId("world-mode-copy")).toContainText(
    "有些靠近，真的发生了。",
  );
  await expect(debug(page)).toHaveCount(0);
  const qr = await qrPixels(qrImage(page));
  await page.reload();
  await expect(world(page)).toHaveAttribute("data-pair-id", "");
  await expectQrPixels(qr, await qrPixels(qrImage(page)));
  expect(
    await page.evaluate((key) => localStorage.getItem(key), BUSINESS_KEY),
  ).toBe(raw);
  fixture.invitations = [];
  fixture.revision++;
  const empty = JSON.stringify(fixture);
  await page.evaluate(
    ({ key, value }) => {
      localStorage.setItem(key, value);
      dispatchEvent(new StorageEvent("storage", { key }));
    },
    { key: BUSINESS_KEY, value: empty },
  );
  await expect(world(page)).toHaveAttribute("data-meetings", "0");
  await expect(page.getByTestId("world-mode-copy")).toContainText(
    "每一次靠近，都从一个勇敢的选择开始。",
  );
  await expect(world(page)).toHaveAttribute("data-pair-id", "");
  await capture(
    page,
    "docs/verification/destiny-field-act3-v2/production-anonymous-empty.png",
  );
});
test("production demo route redirects to business screen without exposing fictional pairs or debug controls", async ({
  page,
}) => {
  const raw = JSON.stringify(createSeed("broadcast"));
  await page.addInitScript(({ key, raw }) => localStorage.setItem(key, raw), {
    key: BUSINESS_KEY,
    raw,
  });
  await page.goto("/screen/demo");
  await expect(page).toHaveURL(/\/screen$/);
  await expect(world(page)).toHaveAttribute("data-source", "business");
  await expect(world(page)).toHaveAttribute("data-qualified-pairs", "0");
  await expect(debug(page)).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("虚构演示");
  expect(
    await page.evaluate((key) => localStorage.getItem(key), BUSINESS_KEY),
  ).toBe(raw);
});
