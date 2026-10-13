import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { chromium, expect } from "@playwright/test";

const origin = process.env.DESTINY_PUBLIC_URL!;
const directory = process.env.DESTINY_AGENCY_TEST_CREDENTIALS!;
if (
  origin !== "http://127.0.0.1:3217" ||
  !directory ||
  new URL(process.env.DATABASE_URL!).pathname !==
    "/destiny_agency_20261011_test"
)
  throw Error("Isolated portrait test environment required");
const manifest = JSON.parse(
  readFileSync(
    "docs/verification/uat-women-20261011/test-manifest.json",
    "utf8",
  ),
);
const sample = manifest.records[0];
const fixture = JSON.parse(readFileSync(directory + "/fixture.json", "utf8"));
const out = "docs/verification/portrait-cover";
mkdirSync(out, { recursive: true });

test("portrait layering, image shapes, viewports, slow/failing loads, keyboard and reduced motion", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const errors: string[] = [];
  try {
    const auth = await browser.newContext();
    const login = await auth.request.post(
      origin + "/api/tongzhou/login?activity=" + fixture.activity,
      {
        headers: { Origin: origin },
        data: JSON.parse(readFileSync(directory + "/agency.json", "utf8")),
      },
    );
    assert.equal(login.status(), 200);
    const detail = await (
      await auth.request.get(
        origin +
          "/api/tongzhou/records?activity=" +
          fixture.activity +
          "&id=fixture-1",
      )
    ).json();
    const square = detail.gallery.photos.find(
      (p: { width: number; height: number }) => p.width === p.height,
    );
    assert.ok(square, "existing isolated square image fixture");
    const squareImage = await auth.request.get(origin + square.url);
    assert.equal(squareImage.status(), 200);
    const shapes = [
      {
        name: "portrait",
        bytes: readFileSync(
          "assets/uat/tongzhou-20261011/linjian-portrait.png",
        ),
        type: "image/png",
      },
      {
        name: "landscape",
        bytes: readFileSync("assets/uat/tongzhou-20261011/linjian-life.png"),
        type: "image/png",
      },
      { name: "square", bytes: await squareImage.body(), type: "image/webp" },
    ];
    const imagePath = "**/api/tongzhou-public/*?image=" + sample.photoIds[0];
    for (const shape of shapes) {
      const page = await browser.newPage();
      page.setDefaultTimeout(10000);
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route(imagePath, (route) =>
        route.fulfill({ body: shape.bytes, contentType: shape.type }),
      );
      for (const width of [320, 375, 390, 430, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.goto(sample.url);
        const cover = page.getByRole("button", {
          name: "查看封面照片",
          exact: true,
        });
        await expect(cover).toHaveAttribute("data-portrait-state", "ready");
        await expect(cover).toBeEnabled();
        const properties = await cover.evaluate((button) => {
          const img = button.querySelector("img")!;
          const bg = button.querySelector('[class*="coverBackdrop"]')!;
          const hint = button.querySelector('[class*="coverHint"]')!;
          return {
            fit: getComputedStyle(img).objectFit,
            filter: getComputedStyle(img).filter,
            image: img.currentSrc,
            background: getComputedStyle(bg).backgroundImage,
            hintHeight: hint.getBoundingClientRect().height,
            height: button.getBoundingClientRect().height,
            overflow: document.documentElement.scrollWidth > innerWidth,
          };
        });
        assert.equal(properties.fit, "contain");
        assert.equal(properties.filter, "none");
        assert.ok(
          properties.background.includes(new URL(properties.image).pathname),
        );
        assert.ok(properties.hintHeight >= 44);
        assert.equal(
          properties.height,
          width === 320 ? 230 : width < 768 ? 280 : 340,
        );
        assert.equal(properties.overflow, false);
        await expect(page.locator("body")).not.toContainText(sample.code);
        if ([390, 1440].includes(width)) {
          await expect(cover.locator("img")).toHaveCSS("opacity", "1");
          await page.screenshot({ path: `${out}/${shape.name}-${width}.png` });
        }
      }
      const cover = page.getByRole("button", {
        name: "查看封面照片",
        exact: true,
      });
      await cover.focus();
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("dialog", { name: "生活照片查看器" }),
      ).toBeVisible();
      await page.keyboard.press("ArrowRight");
      await expect(page.getByAltText("完整照片 2")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(cover).toBeFocused();
      await page.keyboard.press("Space");
      await expect(
        page.getByRole("dialog", { name: "生活照片查看器" }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await page.close();
    }
    // Finish the image before hydration, as on a warm image cache.
    const earlyImage = await browser.newPage();
    earlyImage.setDefaultTimeout(10000);
    let hydrate!: () => void;
    const hydrationGate = new Promise<void>((resolve) => {
      hydrate = resolve;
    });
    await earlyImage.route("**/_next/static/**/*.js", async (route) => {
      await hydrationGate;
      await route.continue();
    });
    await earlyImage.goto(sample.url, { waitUntil: "commit" });
    await earlyImage.waitForFunction(() => {
      const image = document.querySelector(
        'img[alt="封面照片"]',
      ) as HTMLImageElement | null;
      return image?.complete && image.naturalWidth > 0;
    });
    const earlyCover = earlyImage.getByRole("button", {
      name: "查看封面照片",
      exact: true,
    });
    await expect(earlyCover).toBeDisabled();
    await expect(earlyCover.locator('[class*="coverBackdrop"]')).toHaveCount(0);
    hydrate();
    await expect(earlyCover).toHaveAttribute("data-portrait-state", "ready");
    await expect(earlyCover).toBeEnabled();
    await earlyImage.close();
    const slow = await browser.newPage();
    slow.setDefaultTimeout(10000);
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    await slow.route(imagePath, async (route) => {
      await gate;
      await route.continue();
    });
    await slow.goto(sample.url, { waitUntil: "domcontentloaded" });
    const cover = slow.getByRole("button", {
      name: "查看封面照片",
      exact: true,
    });
    await expect(cover).toHaveAttribute("data-portrait-state", "loading");
    await expect(cover).toBeDisabled();
    await expect(cover.locator('[class*="coverBackdrop"]')).toHaveCount(0);
    await expect(cover).toContainText("照片加载中");
    const heightBefore = (await cover.boundingBox())!.height;
    release();
    await expect(cover).toHaveAttribute("data-portrait-state", "ready");
    assert.equal((await cover.boundingBox())!.height, heightBefore);
    await slow.unroute(imagePath);
    await slow.reload();
    await expect(cover).toBeEnabled();
    await slow.emulateMedia({ reducedMotion: "reduce" });
    await expect(cover.locator("img")).toHaveCSS("transition-duration", "0s");
    await expect(cover.locator('[class*="coverAtmosphere"]')).toHaveCSS(
      "animation-name",
      "none",
    );
    await slow.route(imagePath, (route) =>
      route.fulfill({ status: 404, body: "missing" }),
    );
    await slow.reload();
    await expect(cover).toHaveAttribute("data-portrait-state", "failed");
    await expect(cover).toBeDisabled();
    await expect(cover).toContainText("照片暂不可用");
    await expect(cover.locator('[class*="coverBackdrop"]')).toHaveCount(0);
    await expect(cover.locator("img")).toHaveCount(0);
    await slow.screenshot({ path: out + "/failed.png" });
    await slow.close();

    // Preview-only edits exercise new/failed URLs without saving or republishing records.
    assert.equal(
      (
        await auth.request.post(
          origin + "/api/tongzhou/login?activity=" + manifest.activity,
          {
            headers: { Origin: origin },
            data: JSON.parse(readFileSync(directory + "/agency.json", "utf8")),
          },
        )
      ).status(),
      200,
    );
    const page = await auth.newPage();
    page.setDefaultTimeout(10000);
    await page.goto(origin + "/agency/tongzhou?activity=" + manifest.activity);
    await page.getByLabel("搜索用户").fill("林间");
    await page
      .getByRole("button", { name: "林间（UAT虚构）", exact: true })
      .click();
    const drawer = page.getByRole("dialog");
    await drawer.getByRole("tab", { name: "宣传设置" }).click();
    const fullPhotos = "**/api/tongzhou/gallery-photo?**";
    let failFirst = true;
    await page.route(fullPhotos, (route) => {
      const url = new URL(route.request().url());
      return failFirst &&
        !url.searchParams.has("thumb") &&
        url.searchParams.get("photo") === sample.photoIds[0]
        ? route.fulfill({ status: 404, body: "missing" })
        : route.continue();
    });
    await drawer.getByRole("button", { name: "预览", exact: true }).click();
    const previewCover = drawer
      .locator("[data-profile-page]")
      .getByRole("button", { name: "查看封面照片", exact: true });
    await expect(previewCover).toHaveAttribute("data-portrait-state", "failed");
    await drawer.getByRole("button", { name: "设为封面", exact: true }).click();
    await drawer.getByRole("button", { name: "预览", exact: true }).click();
    await expect(previewCover).toHaveAttribute("data-portrait-state", "ready");
    await expect(previewCover.locator("img")).toHaveAttribute(
      "src",
      new RegExp(sample.photoIds[1]),
    );
    await expect(previewCover.locator('[class*="coverBackdrop"]')).toHaveCount(
      1,
    );
    failFirst = false;
    await drawer.getByRole("button", { name: "设为封面", exact: true }).click();
    await drawer.getByRole("button", { name: "预览", exact: true }).click();
    await expect(previewCover).toBeEnabled();
    await expect(previewCover.locator("img")).toHaveAttribute(
      "src",
      new RegExp(sample.photoIds[0]),
    );
    await drawer
      .getByRole("checkbox", { name: "本人照片", exact: true })
      .uncheck();
    await drawer.getByRole("button", { name: "预览", exact: true }).click();
    await expect(previewCover).toHaveCount(0);
    await expect(drawer.locator("[data-profile-page]")).toContainText(
      "个人介绍",
    );
    assert.deepEqual(errors, []);
    writeFileSync(
      out + "/test-result.json",
      JSON.stringify(
        {
          widths: [320, 375, 390, 430, 768, 1440],
          shapes: ["portrait", "landscape", "square"],
          slowLoad: true,
          failedLoad: true,
          cacheReload: true,
          imageCompletedBeforeHydration: true,
          previewUrlSwitch: true,
          noPhoto: true,
          keyboard: true,
          reducedMotion: true,
          pageErrors: errors,
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    await browser.close();
  }
});
