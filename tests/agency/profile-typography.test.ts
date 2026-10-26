import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect, type Page } from "@playwright/test";

const origin = process.env.DESTINY_PUBLIC_URL!;
if (
  origin !== "http://127.0.0.1:3217" ||
  new URL(process.env.DATABASE_URL!).pathname !==
    "/destiny_agency_20261011_test"
)
  throw Error("Isolated typography environment required");
const manifest = JSON.parse(
  readFileSync(
    "docs/verification/uat-women-20261011/test-manifest.json",
    "utf8",
  ),
);
const sample = manifest.records[0];
const out = "docs/verification/profile-typography-v11";
const widths = [320, 360, 375, 390, 430, 768, 1024, 1440];

async function layout(page: Page) {
  return page.evaluate<{
    overflow: boolean;
    fields: {
      label: string;
      value: string;
      vertical: boolean;
      inside: boolean;
      font: number;
      contrast: number;
    }[];
    columns: number;
    nameSize: string;
    numberSize: string;
    proseContrast: number;
    nameWidth: number;
    sectionWidth: number;
    proseWidth: number;
  }>(String.raw`(() => {
    const article = document.querySelector("[data-profile-page]");
    const facts = [...article.querySelectorAll("dl > div")];
    const rgb = (color) =>
      color
        .match(/[\d.]+/g)
        .slice(0, 3)
        .map(Number);
    const luminance = (color) =>
      color
        .map((v) => {
          const x = v / 255;
          return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
        })
        .reduce((total, v, i) => total + v * [0.2126, 0.7152, 0.0722][i], 0);
    const contrast = (el) => {
      let bg = el;
      while (
        bg &&
        ["rgba(0, 0, 0, 0)", "transparent"].includes(
          getComputedStyle(bg).backgroundColor,
        )
      )
        bg = bg.parentElement;
      const a = luminance(rgb(getComputedStyle(el).color));
      const b = luminance(
        rgb(bg ? getComputedStyle(bg).backgroundColor : "rgb(255,255,255)"),
      );
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    return {
      overflow: document.documentElement.scrollWidth > innerWidth,
      fields: facts.map((f) => {
        const label = f.querySelector("dt"),
          value = f.querySelector("dd");
        const l = label.getBoundingClientRect(),
          v = value.getBoundingClientRect();
        return {
          label: label.textContent,
          value: value.textContent,
          vertical: v.top >= l.bottom,
          inside: v.right <= f.getBoundingClientRect().right + 1,
          font: parseFloat(getComputedStyle(label).fontSize),
          contrast: contrast(label),
        };
      }),
      columns: getComputedStyle(
        article.querySelector("dl"),
      ).gridTemplateColumns.split(" ").length,
      nameSize: getComputedStyle(article.querySelector("h1")).fontSize,
      numberSize: getComputedStyle(article.querySelector("section h2 > span"))
        .fontSize,
      proseContrast: contrast(article.querySelector('[class*="prose"]')),
      nameWidth: article
        .querySelector("h1")
        .parentElement.getBoundingClientRect().width,
      sectionWidth: article.querySelector("section").getBoundingClientRect()
        .width,
      proseWidth: article
        .querySelector('[class*="prose"]')
        .getBoundingClientRect().width,
    };
  })()`);
}

test("member typography: field preservation, eight viewports, contrast, long text and local fonts", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    const fonts: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (r.resourceType() === "font") fonts.push(r.url());
    });
    const profile = await (
      await page.request.get(
        origin + "/api/tongzhou-public/" + sample.url.split("/").at(-1),
      )
    ).json();
    const results = [];
    for (const width of widths) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(sample.url);
      await expect(
        page.getByRole("button", { name: "查看封面照片", exact: true }),
      ).toBeEnabled();
      await expect(page.locator("h1")).toHaveText(profile.title);
      for (const item of profile.items)
        await expect(page.locator("[data-profile-page]")).toContainText(
          item.value,
        );
      const m = await layout(page);
      assert.equal(m.overflow, false);
      assert.equal(m.columns, width === 320 ? 1 : 2);
      assert.ok(
        m.fields.every(
          (f) => f.vertical && f.inside && f.font >= 13 && f.contrast >= 4.5,
        ),
      );
      assert.ok(m.proseContrast >= 4.5);
      assert.equal(m.nameSize, width < 768 ? "28px" : "36px");
      assert.equal(m.numberSize, "26px");
      assert.ok(
        m.nameWidth <= 820 && m.sectionWidth <= 820 && m.proseWidth <= 720,
      );
      if (width === 390 || width === 1440) {
        await expect(page.getByAltText("封面照片", { exact: true })).toHaveCSS(
          "opacity",
          "1",
        );
        await page.evaluate(() =>
          window.scrollTo(0, document.body.scrollHeight),
        );
        await page.waitForFunction(() =>
          [...document.images].every((i) => i.complete),
        );
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({
          path: `${out}/after-${width}.png`,
          fullPage: true,
        });
      }
      results.push({ width, ...m });
      // Browser-only stress values; no mutation of the stored member or publication.
      await page.evaluate(() => {
        document.querySelector("h1")!.textContent = "林间".repeat(20);
        document.querySelector("dd")!.textContent =
          "CreativeArchitecture".repeat(8);
        const p = document.querySelector('[class*="prose"]')!;
        p.textContent = "保留换行的长段自述。\n".repeat(30);
      });
      assert.equal((await layout(page)).overflow, false);
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(fonts, []);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    const { root } = await cdp.send("DOM.getDocument");
    const { nodeId } = await cdp.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector: "h1",
    });
    const actualFonts = await cdp.send("CSS.getPlatformFontsForNode", {
      nodeId,
    });
    writeFileSync(
      out + "/typography-result.json",
      JSON.stringify(
        {
          results,
          actualFonts,
          externalFontRequests: fonts,
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

test("actual Chromium tab zoom at 200 percent reflows without overflow", async () => {
  const extension = mkdtempSync(join(tmpdir(), "destiny-zoom-extension-"));
  const userData = mkdtempSync(join(tmpdir(), "destiny-zoom-browser-"));
  writeFileSync(
    join(extension, "manifest.json"),
    JSON.stringify({
      manifest_version: 3,
      name: "Local UAT zoom verification",
      version: "1.0",
      permissions: ["tabs"],
      background: { service_worker: "worker.js" },
    }),
  );
  writeFileSync(
    join(extension, "worker.js"),
    "chrome.runtime.onInstalled.addListener(() => {});",
  );
  const context = await chromium.launchPersistentContext(userData, {
    ...(process.env.DESTINY_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.DESTINY_CHROMIUM_EXECUTABLE }
      : { channel: "chromium" }),
    headless: true,
    viewport: null,
    args: [
      "--window-size=1440,1000",
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
  try {
    const worker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent("serviceworker"));
    const page = await context.newPage();
    await page.goto(sample.url);
    const cdp = await context.newCDPSession(page);
    const { windowId } = await cdp.send("Browser.getWindowForTarget");
    const results = [];
    for (const width of [1440, 768]) {
      await worker.evaluate(
        "(async () => { const tab=(await chrome.tabs.query({})).find(t=>t.url.includes('/tongzhou/p/')); await chrome.tabs.setZoom(tab.id,1); })()",
      );
      await cdp.send("Browser.setWindowBounds", {
        windowId,
        bounds: { width, height: 1000 },
      });
      await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width);
      const before = await page.evaluate(() => innerWidth);
      const zoom = await worker.evaluate(
        "(async () => { const tab=(await chrome.tabs.query({})).find(t=>t.url.includes('/tongzhou/p/')); await chrome.tabs.setZoom(tab.id,2); return chrome.tabs.getZoom(tab.id); })()",
      );
      assert.equal(zoom, 2);
      await expect.poll(() => page.evaluate(() => innerWidth)).toBe(before / 2);
      const m = await layout(page);
      assert.equal(m.overflow, false);
      assert.ok(m.fields.every((f) => f.vertical && f.inside));
      await page.screenshot({
        path: `${out}/zoom-200-${width}.png`,
        fullPage: true,
      });
      results.push({
        windowWidth: width,
        zoom,
        cssViewport: await page.evaluate(() => innerWidth),
        overflow: m.overflow,
      });
    }
    writeFileSync(
      out + "/zoom-result.json",
      JSON.stringify(
        {
          method:
            "chrome.tabs.setZoom: browser tab zoom, not deviceScaleFactor or pinch zoom",
          results,
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    await context.close();
    rmSync(extension, { recursive: true, force: true });
    rmSync(userData, { recursive: true, force: true });
  }
});
