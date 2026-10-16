import { chromium, expect } from "@playwright/test";
import fs from "node:fs";
import assert from "node:assert/strict";
const base = "http://127.0.0.1:3241";
if (
  process.env.DESTINY_PUBLIC_URL !== base ||
  !process.env.REGISTRATION_TEST_DIR
)
  throw Error("Isolated test environment required");
const out = "docs/verification/registration/encounter-pass-v13";
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
// Display boundary fixtures never mutate the real activity or registration database.
const initial = {
  config: {
    title: "爱在凤城 · 初冬有约",
    date: "2026年11月6日 — 11月8日",
    location: "银川市兴庆区鼓楼步行街",
    headline: "认真遇见一个人",
    description: "",
    open: true,
  },
  record: {
    id: "display-fixture",
    nickname: "予安",
    receipt: "012345",
    effectiveStatus: "registered",
    status: "registered",
    version: 1,
    fields: {},
    photos: [],
    agencyAllowed: false,
    profileProgress: {
      current: "preview",
      saved: ["life", "expectation", "album"],
      visited: [],
    },
    profileConfirmedAt: null,
    entered: false,
  },
};
let fixture = structuredClone(initial),
  refreshMode = "ok",
  releaseSession;
await page.route("**/api/registration/session?*", async (route) => {
  if (releaseSession) await releaseSession;
  await route.fulfill({ json: fixture });
});
await page.route("**/api/registration/me?*", async (route) => {
  if (refreshMode === "error")
    return route.fulfill({
      status: 503,
      json: { error: "签到状态读取失败，请重试。" },
    });
  await route.fulfill({ json: fixture });
});
const capture = async (name) =>
  page.screenshot({
    path: `${out}/${name}.png`,
    fullPage: true,
    animations: "disabled",
  });
const open = async () => {
  await page.goto(`${base}/mobile/register?activity=pass-visual&view=success`);
  await expect(
    page.getByRole("heading", {
      name:
        fixture.record.status === "cancelled" ? "报名已取消" : "我的遇见邀请函",
      exact: true,
    }),
  ).toBeVisible();
};
const checks = [];
try {
  await open();
  await expect(page.locator(".reg-pass-date")).toHaveText(
    "2026年11月6日 — 2026年11月8日",
  );
  await expect(page.locator(".reg-receipt strong")).toHaveText("012 345");
  assert.equal(
    await page.locator(".reg-receipt strong").getAttribute("aria-label"),
    "专属遇见码 012345",
  );
  await page.getByRole("button", { name: "复制遇见码", exact: true }).click();
  await expect(page.locator(".reg-message[role=status]")).toContainText(
    "遇见码已复制",
  );
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    "012345",
  );
  await open();
  for (const group of await page.locator(".reg-pass-meta > div").all()) {
    assert.equal(
      await group.evaluate((el) => getComputedStyle(el).display),
      "block",
    );
    const label = await group.locator(".reg-pass-meta-label").boundingBox();
    const value = await group.locator("p").first().boundingBox();
    assert.ok(
      value.y >= label.y + label.height - 1,
      "date and location labels stay above their content",
    );
  }
  for (const width of [320, 375, 390, 430, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    assert.ok((await page.locator(".reg-shell").boundingBox()).width <= 440);
    for (const selector of [
      ".reg-pass-status",
      ".reg-nav button",
      ".reg-pass-actions .reg-primary",
      ".reg-pass-secondary button",
      ".reg-copy",
    ]) {
      const box = await page.locator(selector).first().boundingBox();
      assert.ok(box.height >= 44, selector);
    }
    await capture(`pass-${width}`);
  }
  checks.push(
    "five widths, 44px touch heights, raw six-digit clipboard value and accessible code",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  fixture.record.effectiveStatus = "checked_in";
  fixture.record.status = "checked_in";
  await page.getByRole("button", { name: "刷新签到状态", exact: true }).click();
  await expect(page.locator(".reg-pass-status")).toContainText("已签到");
  await expect(page.getByRole("button", { name: /进入活动/ })).toBeVisible();
  await capture("pass-checked-in");
  refreshMode = "error";
  await page.getByRole("button", { name: "刷新签到状态", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "签到状态读取失败",
  );
  await expect(page.locator(".reg-pass-status")).toContainText("已签到");
  refreshMode = "ok";
  fixture.record.effectiveStatus = "registered";
  await page.getByRole("button", { name: "刷新签到状态", exact: true }).click();
  await expect(page.locator(".reg-pass-status")).toContainText("待签到");
  await expect(page.getByRole("button", { name: /进入活动/ })).toHaveCount(0);
  checks.push(
    "refresh success/failure and effective status after reset; refresh does not fabricate check-in",
  );
  fixture.config.title =
    "银川城市青年相遇活动暨初冬有约生活分享与城市漫步特别邀请专场";
  fixture.config.location =
    "宁夏回族自治区银川市兴庆区鼓楼步行街城市相遇活动服务中心东侧二楼多功能厅（从南侧无障碍入口进入）";
  fixture.config.date = "2026-12-31 — 2027-01-02";
  fixture.record.receipt = "TZ-172BFE5B528E-000000000011";
  fixture.record.nickname = "很长的昵称用来验证换行以及完整可访问名称";
  await page.setViewportSize({ width: 320, height: 844 });
  await open();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await expect(page.locator(".reg-pass-edition")).toContainText("2026 / 2027");
  await expect(page.locator(".reg-receipt strong")).toHaveText(
    fixture.record.receipt,
  );
  await page.getByRole("button", { name: "复制遇见码", exact: true }).click();
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    fixture.record.receipt,
  );
  await capture("pass-long-content");
  fixture.config.date = "每周六下午，具体时间待通知";
  fixture.record.nickname = "";
  await open();
  await expect(page.locator(".reg-pass-edition")).toHaveCount(0);
  await expect(page.locator(".reg-pass-date-accent")).toHaveCount(0);
  await expect(page.locator(".reg-pass-date")).toHaveText(fixture.config.date);
  fixture.config.date = "";
  fixture.config.location = "";
  await open();
  await expect(page.locator(".reg-pass-date")).toHaveText("活动时间待公布");
  await expect(page.locator(".reg-pass-location")).toHaveText("活动地点待公布");
  checks.push(
    "long title/address/nickname/legacy code, cross-year date, free text and missing values",
  );
  fixture = structuredClone(initial);
  fixture.record.status = "cancelled";
  fixture.record.effectiveStatus = "cancelled";
  await open();
  await expect(page.locator(".reg-pass-actions .reg-primary")).toHaveCount(0);
  await expect(page.locator(".reg-pass-code")).toContainText(
    "此凭证不可用于签到",
  );
  await capture("pass-cancelled");
  fixture = structuredClone(initial);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open();
  assert.equal(
    await page
      .locator(".reg-pass-ticket")
      .evaluate((el) => getComputedStyle(el).animationName),
    "none",
  );
  await page.getByRole("button", { name: "刷新签到状态", exact: true }).focus();
  assert.ok(
    await page
      .locator(".reg-pass-status")
      .evaluate((el) => getComputedStyle(el).outlineStyle !== "none"),
  );
  await page.keyboard.press("Enter");
  await expect(page.locator(".reg-message[role=status]")).toContainText(
    "状态未变化",
  );
  const contrast = await page.evaluate(() => {
    const rgb = (s) => s.match(/[\d.]+/g).map(Number);
    const lum = (c) =>
      c
        .slice(0, 3)
        .map((x) => {
          x /= 255;
          return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
        })
        .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
    const nodes = [
      ...document.querySelectorAll(
        ".reg-pass-heading p,.reg-pass-heading h1,.reg-pass-edition,.reg-pass-event-heading h2,.reg-pass-meta-label,.reg-pass-meta p,.reg-pass-code small,.reg-pass-code strong,.reg-pass-code p,.reg-pass-nickname,.reg-pass-footer,.reg-pass-status",
      ),
    ];
    return nodes.map((el) => {
      const fg = lum(rgb(getComputedStyle(el).color));
      let bg = el.closest(".reg-pass-ticket")
        ? [241, 232, 223]
        : [250, 247, 242];
      if (el.classList.contains("reg-pass-status"))
        bg = rgb(getComputedStyle(el).backgroundColor);
      const b = lum(bg);
      return {
        selector: el.className,
        ratio: (Math.max(fg, b) + 0.05) / (Math.min(fg, b) + 0.05),
      };
    });
  });
  assert.ok(
    contrast.every((x) => x.ratio >= 4.5),
    JSON.stringify(contrast),
  );
  fs.writeFileSync(
    `${out}/pass-contrast.json`,
    JSON.stringify(contrast, null, 2),
  );
  let release;
  releaseSession = new Promise((r) => (release = r));
  await page.goto(`${base}/mobile/register?activity=pass-visual&view=success`);
  await expect(page.locator(".reg-pass-skeleton")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /查看我的遇见档案/ }),
  ).toHaveCount(0);
  release();
  releaseSession = null;
  await expect(page.locator(".reg-pass-ticket")).toBeVisible();
  checks.push(
    "cancelled state, reduced motion, keyboard focus, text contrast >=4.5 and loading skeleton",
  );
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    `${out}/pass-browser-result.json`,
    JSON.stringify(
      {
        passed: true,
        at: new Date().toISOString(),
        checks,
        displayFixtures: true,
        realWeChatPending: true,
      },
      null,
      2,
    ),
  );
  console.log("Invitation boundary checks passed", checks);
} finally {
  await context.close();
  await browser.close();
}
