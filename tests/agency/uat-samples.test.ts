import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { chromium, expect } from "@playwright/test";

const origin = process.env.DESTINY_PUBLIC_URL;
const target =
  origin === "http://127.0.0.1:3217"
    ? "test"
    : origin === "http://192.168.43.70:3216"
      ? "uat"
      : "";
if (!target) throw Error("Only local sample verification is allowed");
const out = "docs/verification/uat-women-20261011";
const manifest = JSON.parse(
  readFileSync(`${out}/${target}-manifest.json`, "utf8"),
);
test("four fictional public profiles: unique links, privacy, eight photos and responsive layouts", async () => {
  assert.equal(manifest.records.length, 4);
  assert.equal(
    new Set(manifest.records.map((r: { url: string }) => r.url)).size,
    4,
  );
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const errors: string[] = [];
  try {
    const page = await browser.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    for (const record of manifest.records) {
      assert.equal(new URL(record.url).origin, origin);
      const slug = record.url.split("/").at(-1);
      const response = await page.request.get(
        `${origin}/api/tongzhou-public/${slug}`,
      );
      assert.equal(response.status(), 200);
      const profile = await response.json();
      assert.equal(profile.title, record.nickname);
      assert.deepEqual(profile.photos, record.photoIds);
      assert.equal(profile.photos.length, 2);
      assert.ok(profile.intro.includes("AI 生成"));
      assert.ok(
        profile.items.every(
          (i: { key: string }) => !["realName", "phone"].includes(i.key),
        ),
      );
      for (const id of record.photoIds) {
        const photo = await page.request.get(
          `${origin}/api/tongzhou-public/${slug}?image=${id}`,
        );
        assert.equal(photo.status(), 200);
        assert.equal(photo.headers()["content-type"], "image/webp");
        assert.ok((await photo.body()).length > 1000);
      }
      for (const width of [320, 390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert.equal((await page.goto(record.url))?.status(), 200);
        await expect(page.locator("h1")).toHaveText(record.nickname);
        await expect(page.locator("body")).not.toContainText(record.code);
        await expect(page.locator("body")).not.toContainText("NO.");
        await page.evaluate(() =>
          window.scrollTo(0, document.body.scrollHeight),
        );
        await expect(
          page.getByAltText("生活照片 2", { exact: true }),
        ).toBeVisible();
        await page.waitForFunction(() =>
          [...document.querySelectorAll("[data-profile-page] img")].every(
            (im) =>
              (im as HTMLImageElement).complete &&
              (im as HTMLImageElement).naturalWidth > 0,
          ),
        );
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({
          path: `${out}/${target}-${record.actor}-${width}.png`,
          fullPage: true,
        });
      }
      await page
        .getByRole("button", { name: "查看生活照片 2", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(page.getByAltText("完整照片 2")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).not.toBeVisible();
    }
    assert.deepEqual(errors, []);
    writeFileSync(
      `${out}/${target}-browser.json`,
      JSON.stringify(
        {
          profiles: 4,
          photos: 8,
          widths: [320, 390, 1440],
          privacy: true,
          codesHidden: true,
          imagesLoaded: true,
          consoleErrors: errors,
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    await browser.close();
  }
});
