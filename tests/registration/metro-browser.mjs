import {
  chromium,
  request as playwrightRequest,
  expect,
} from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
const root = process.env.REGISTRATION_TEST_DIR,
  base = "http://127.0.0.1:3241";
if (!root || process.env.DESTINY_PUBLIC_URL !== base)
  throw Error("Dedicated test environment required");
const { activity } = JSON.parse(
  fs.readFileSync(root + "/fixture.json", "utf8"),
);
const auth = JSON.parse(fs.readFileSync(root + "/auth.json", "utf8"));
const out = "docs/verification/registration/encounter-pass-v13";
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const phone = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
const page = await phone.newPage();
page.on("dialog", (d) => d.accept());
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const api = (p) =>
  `${base}/api/registration/${p}${p.includes("?") ? "&" : "?"}activity=${activity}`;
const current = async () =>
  (await (await phone.request.get(api("me"))).json()).record;
const post = async (input) =>
  phone.request.post(api("profile"), {
    headers: { origin: base, "Idempotency-Key": randomUUID() },
    data: input,
  });
const op = await playwrightRequest.newContext({
  baseURL: base,
  extraHTTPHeaders: { origin: base },
});
const anon = await playwrightRequest.newContext({ baseURL: base });
const checks = [];
const capture = async (name) => {
  await page.screenshot({
    path: `${out}/${name}.png`,
    fullPage: true,
    animations: "disabled",
  });
};
async function waitSaved() {
  await expect(page.locator(".reg-profile-editor")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.locator(".reg-profile-editor")).toHaveAttribute(
    "data-save-state",
    "saved",
  );
}
try {
  assert.equal(
    (
      await anon.post(api("profile"), { headers: { origin: base }, data: {} })
    ).status(),
    401,
  );
  await page.goto(`${base}/mobile/register?activity=${activity}`);
  await page.getByRole("button", { name: "我要报名", exact: true }).click();
  await page.getByPlaceholder("希望大家怎样称呼你").fill("予安");
  await page.getByRole("button", { name: "♀ 女生", exact: true }).click();
  await page.getByLabel("出生年份", { exact: true }).selectOption("1997");
  await page.getByPlaceholder("如 银川").fill("银川");
  await page
    .getByPlaceholder("用于活动联系，不会公开")
    .fill("139" + String(Date.now()).slice(-8));
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "确认报名", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "我的遇见邀请函", exact: true }),
  ).toBeVisible();
  const receipt = (await current()).receipt;
  assert.match(receipt, /^[1-9][0-9]{5}$/);
  await expect(page.locator(".reg-receipt strong")).toHaveText(
    receipt.slice(0, 3) + " " + receipt.slice(3),
  );
  await capture("01-first-ticket");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "我的遇见邀请函", exact: true }),
  ).toBeVisible();
  assert.equal(await page.locator(".reg-pass-first").count(), 0);
  await capture("02-return-ticket");
  await page.getByRole("button", { name: "刷新签到状态", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("状态未变化");
  await page.route("**/api/registration/me?*", (r) => r.abort());
  await page.getByRole("button", { name: "刷新签到状态", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "刷新签到状态", exact: true }),
  ).toContainText("待签到");
  await page.unroute("**/api/registration/me?*");
  checks.push(
    "first-only animation, repeat visit, six-digit ticket and refresh failure",
  );
  await page.getByRole("button", { name: /查看我的遇见档案/ }).click();
  await expect(
    page.getByRole("navigation", { name: "遇见档案填写进度" }),
  ).toBeVisible();
  await page.getByLabel("身高（cm）").fill("999");
  await page
    .getByRole("button", { name: "保存并前往下一站", exact: true })
    .click();
  await expect(page.locator("main").getByRole("alert")).toContainText("身高");
  assert.ok(page.url().includes("step=life"));
  await page.route("**/api/registration/profile?*", (route) => route.abort());
  await page.getByLabel("身高（cm）").fill("168");
  await page
    .getByRole("button", { name: "保存并前往下一站", exact: true })
    .click();
  await expect(page.locator(".reg-save-state")).toHaveText(
    "保存未完成，输入已保留",
  );
  await expect(page.getByLabel("身高（cm）")).toHaveValue("168");
  await page.unroute("**/api/registration/profile?*");
  await page
    .getByRole("button", { name: "保存并前往下一站", exact: true })
    .click();
  await expect(page.getByLabel("家庭简述")).toBeVisible();
  await page.getByRole("button", { name: /第1站 生活/ }).click();

  await page.getByLabel("婚姻状况").selectOption("未婚");
  await page.getByLabel("学历", { exact: true }).selectOption("本科");
  await page.getByLabel("职业/行业", { exact: true }).fill("视觉设计师");
  await waitSaved();
  await capture("03-life");
  await page
    .getByRole("button", { name: "保存并前往下一站", exact: true })
    .click();
  await page
    .getByPlaceholder("你最期待的相处方式是什么？")
    .fill("真诚地分享生活，也尊重彼此的空间。");
  await page.getByLabel("家庭简述").fill("温暖、彼此尊重。");
  await waitSaved();
  await capture("04-expectation");
  await page
    .getByRole("button", { name: "保存并前往下一站", exact: true })
    .click();
  const photo = await sharp("public/assets/registration/city-dusk.png")
    .resize(300)
    .jpeg()
    .toBuffer();
  await page
    .locator("input[type=file]")
    .setInputFiles({ name: "生活.jpg", mimeType: "image/jpeg", buffer: photo });
  await expect(page.getByAltText("我的生活照片")).toHaveCount(1);
  let r = await current();
  assert.equal((await anon.get(base + r.photos[0].url)).status(), 401);
  await page.getByRole("checkbox").check();
  await waitSaved();
  await capture("05-album");
  await page.route("**/api/registration/profile?*", (route) => route.abort());
  await page
    .getByRole("button", { name: "完成填写，预览档案", exact: true })
    .click();
  await expect(page.locator(".reg-save-state")).toHaveText(
    "保存未完成，输入已保留",
  );
  await expect(page.getByRole("checkbox")).toBeChecked();
  await expect(page.locator(".reg-preview-card")).toHaveCount(0);
  await page.unroute("**/api/registration/profile?*");

  await page
    .getByRole("button", { name: "完成填写，预览档案", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "这就是，独一无二的你。", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".reg-preview-card")).toHaveCount(3);
  await expect(page.locator(".reg-preview-card").first()).toContainText(
    "视觉设计师",
  );
  await capture("06-preview");
  await page.getByRole("button", { name: "编辑生活情况", exact: true }).click();
  await page.getByLabel("职业/行业", { exact: true }).fill("品牌设计师");
  await page
    .getByRole("button", { name: "保存并返回预览", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "这就是，独一无二的你。", exact: true }),
  ).toBeVisible();
  r = await current();
  assert.equal(r.fields.occupation, "品牌设计师");
  assert.equal(r.fields.expectations, "真诚地分享生活，也尊重彼此的空间。");
  assert.equal(r.photos.length, 1);
  await expect(page.locator(".reg-save-state")).toHaveText("✓ 已保存");
  assert.equal((await current()).profileConfirmedAt, null);
  await expect(page.locator(".reg-bottom button")).toHaveCount(1);
  await expect(page.locator(".reg-bottom .reg-primary")).toHaveText(
    "返回报名凭证",
  );
  await expect(
    page.getByText("你的遇见档案已保存，随时可以回来完善", { exact: true }),
  ).toBeVisible();
  checks.push(
    "third station persisted all data; fourth has one return button and no confirmation",
  );
  // Repeated preview reads and receipt navigation must never write profile data.
  const writes = [];
  const observeWrite = (req) => {
    if (
      req.method() === "POST" &&
      /\/api\/registration\/(profile|save|upload|delete-photo)[?]/.test(
        req.url(),
      )
    )
      writes.push(req.url());
  };
  page.on("request", observeWrite);
  const previewVersion = (await current()).version;
  await page.reload();
  await expect(page.locator(".reg-save-state")).toHaveText("✓ 已保存");
  await page
    .locator("#registration-profile")
    .evaluate((el) => el.requestSubmit());
  await page.getByRole("button", { name: /第4站 完成/ }).click();
  await page.getByRole("button", { name: "返回报名凭证", exact: true }).click();
  await expect(page.locator(".reg-receipt strong")).toHaveText(
    receipt.slice(0, 3) + " " + receipt.slice(3),
  );
  await page.getByRole("button", { name: /查看我的遇见档案/ }).click();
  await expect(page.locator(".reg-save-state")).toHaveText("✓ 已保存");
  await page.goBack();
  await expect(page.locator(".reg-receipt strong")).toHaveText(
    receipt.slice(0, 3) + " " + receipt.slice(3),
  );
  await page.goForward();
  await expect(page.locator(".reg-save-state")).toHaveText("✓ 已保存");
  assert.equal((await current()).version, previewVersion);
  assert.deepEqual(writes, []);
  page.off("request", observeWrite);
  checks.push(
    "reload, repeated entry, history, Enter and return receipt: zero writes and unchanged version",
  );
  // Server changes appear on reentry; local cached text must never appear in saved cards.
  r = await current();
  assert.equal(
    (
      await post({
        section: "life",
        intent: "save",
        next: "preview",
        fields: { occupation: "服务器最新职业" },
        version: r.version,
      })
    ).status(),
    200,
  );
  await page.evaluate(
    ({ activity, r }) =>
      sessionStorage.setItem(
        `dl-profile-draft:${activity}:${r.id}`,
        JSON.stringify({
          base: r.fields,
          agencyBase: r.agencyAllowed,
          draft: {
            fields: { ...r.fields, height: "172", occupation: "冲突草稿职业" },
            agency: r.agencyAllowed,
          },
        }),
      ),
    { activity, r },
  );
  await page.reload();
  await expect(page.locator(".reg-preview-card").first()).toContainText(
    "服务器最新职业",
  );
  await expect(page.locator(".reg-preview-card").first()).toContainText(
    "168 cm",
  );
  await expect(page.locator(".reg-save-state")).toContainText("仍有未同步内容");
  await page.getByRole("button", { name: /第1站 生活/ }).click();
  await expect(page.getByLabel("身高（cm）")).toHaveValue("172");
  await expect(page.getByRole("region", { name: "资料冲突" })).toBeVisible();
  await page
    .getByRole("button", { name: "使用服务器最新内容", exact: true })
    .click();
  await page
    .getByRole("button", { name: "保存并返回预览", exact: true })
    .click();
  await expect(page.locator(".reg-save-state")).toHaveText("✓ 已保存");
  await expect(page.locator(".reg-preview-card").first()).toContainText(
    "172 cm",
  );
  checks.push(
    "preview shows fresh server snapshot while retaining unsaved draft; top navigation edit returns directly",
  );
  // A read failure after a successful write retries GET only.
  await page.getByRole("button", { name: "编辑择偶期待", exact: true }).click();
  await page.getByLabel("方便联系时段").fill("工作日晚上");
  await waitSaved();
  await page.route("**/api/registration/me?*", (route) => route.abort());
  await page
    .getByRole("button", { name: "保存并返回预览", exact: true })
    .click();
  await expect(page.locator(".reg-save-state")).toHaveText("档案读取未完成");
  await expect(page.locator(".reg-preview-card")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "重试保存", exact: true }),
  ).toHaveCount(0);
  const readFailureVersion = (await current()).version;
  page.on("request", observeWrite);
  await capture("09-preview-read-error");
  await page.unroute("**/api/registration/me?*");
  await page.getByRole("button", { name: "重试读取", exact: true }).click();
  await expect(page.locator(".reg-save-state")).toHaveText("✓ 已保存");
  assert.equal((await current()).version, readFailureVersion);
  assert.deepEqual(writes, []);
  page.off("request", observeWrite);
  checks.push(
    "successful save followed by failed read: retry GET only, no false saved state",
  );
  await page.getByRole("button", { name: "编辑择偶期待", exact: true }).click();
  await page.route("**/api/registration/profile?*", (r) => r.abort());
  await page.getByLabel("方便联系时段").fill("周末下午");
  await page
    .getByRole("button", { name: "保存并返回预览", exact: true })
    .click();
  await expect(page.locator(".reg-save-state")).toHaveText(
    "保存未完成，输入已保留",
  );
  await expect(page.getByLabel("方便联系时段")).toHaveValue("周末下午");
  await expect(page.locator("main").getByRole("alert")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("方便联系时段")).toHaveValue("周末下午");
  await page.unroute("**/api/registration/profile?*");
  // Restore draft retry after the failed save, even when the page is reloaded.
  await page.getByRole("button", { name: /保存并/ }).click();
  await expect
    .poll(async () => (await current()).fields.contactTime)
    .toBe("周末下午");
  checks.push("offline draft restored after reload, successful retry");
  await page.getByRole("button", { name: /第1站 生活/ }).click();
  await expect(page.getByLabel("职业/行业", { exact: true })).toBeVisible();
  await waitSaved();
  r = await current();
  const remote = await post({
    section: "life",
    intent: "save",
    next: "life",
    fields: { occupation: "远端职业" },
    version: r.version,
  });
  assert.equal(remote.status(), 200);
  await page.getByLabel("职业/行业", { exact: true }).fill("我的新职业");
  await expect(page.getByRole("region", { name: "资料冲突" })).toBeVisible();
  await expect(page.getByRole("region", { name: "资料冲突" })).toContainText(
    "远端职业",
  );
  await capture("07-conflict");
  await page.getByRole("button", { name: "保留我的草稿", exact: true }).click();
  await waitSaved();
  assert.equal((await current()).fields.occupation, "我的新职业");
  // Lost response after a committed write: same idempotency key must recover it.
  let lost = false,
    committedVersion;
  await page.route("**/api/registration/profile?*", async (route) => {
    if (!lost) {
      lost = true;
      const response = await route.fetch();
      committedVersion = (await response.json()).version;
      await route.abort();
    } else await route.continue();
  });
  await page.getByLabel("职业/行业", { exact: true }).fill("空间设计师");
  await expect(page.locator("main").getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "重试保存", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "上一项操作已确认",
  );
  assert.equal((await current()).version, committedVersion);
  await page.getByRole("button", { name: "重试保存", exact: true }).click();
  await expect(page.locator(".reg-save-state")).toHaveText("✓ 已保存");
  await page.getByRole("button", { name: /第1站 生活/ }).click();
  await waitSaved();
  await page.unroute("**/api/registration/profile?*");
  // A non-overlapping remote edit is merged without asking the user to discard either side.
  r = await current();
  assert.equal(
    (
      await post({
        section: "expectation",
        intent: "save",
        next: "expectation",
        fields: { family: "远端家庭更新" },
        version: r.version,
      })
    ).status(),
    200,
  );
  await page.getByLabel("身高（cm）").fill("170");
  await waitSaved();
  r = await current();
  assert.equal(r.fields.height, "170");
  assert.equal(r.fields.family, "远端家庭更新");
  checks.push(
    "overlapping conflict choices, non-overlap merge and committed-response-loss idempotency",
  );
  await page.getByRole("button", { name: /第3站 相册/ }).click();
  await page.getByRole("button", { name: "删除照片", exact: true }).click();
  await expect(page.getByAltText("我的生活照片")).toHaveCount(0);
  await page.getByRole("button", { name: /第4站 完成/ }).click();
  await expect(page.locator(".reg-preview-card").last()).toContainText(
    "暂未添加照片",
  );
  await page.getByRole("button", { name: "编辑个人相册", exact: true }).click();
  await page
    .getByRole("button", { name: "保存并返回预览", exact: true })
    .click();
  await expect(page.locator(".reg-save-state")).toHaveText("✓ 已保存");
  for (const station of [/第2站 期待/, /第3站 相册/]) {
    await page.getByRole("button", { name: station }).click();
    await page
      .getByRole("button", { name: "保存并返回预览", exact: true })
      .click();
    await expect(page.locator(".reg-save-state")).toHaveText("✓ 已保存");
  }
  checks.push(
    "all three card editors and top station editors save directly back to preview; failures in each first-three station stay with retry",
  );
  for (const width of [320, 375, 390, 430, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `overflow ${width}`,
    );
    const shell = await page.locator(".reg-shell").boundingBox();
    assert.ok(shell.width <= 440);
    await capture(`08-preview-${width}`);
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await page
      .locator(".reg-station-content")
      .evaluate((el) => getComputedStyle(el).animationName),
    "none",
  );
  await page.getByRole("button", { name: /第1站 生活/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("身高（cm）")).toBeVisible();
  await page.getByRole("button", { name: /第4站 完成/ }).click();
  await expect(page.locator(".reg-save-state")).toHaveText("✓ 已保存");
  await page.getByRole("button", { name: "返回报名凭证", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "我的遇见邀请函", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "查看报名详情", exact: true }).click();
  await expect(page.getByPlaceholder("希望大家怎样称呼你")).toHaveValue("予安");
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "我的遇见邀请函", exact: true }),
  ).toBeVisible();
  assert.equal(
    (
      await op.post(`/api/live/login?activity=${activity}`, { data: auth })
    ).status(),
    200,
  );
  r = await current();
  assert.equal(
    (
      await op.post(api("manage"), {
        headers: { "Idempotency-Key": randomUUID() },
        data: {
          action: "checkin",
          id: r.id,
          version: r.version,
          receipt: r.receipt,
        },
      })
    ).status(),
    200,
  );
  await page.getByRole("button", { name: "刷新签到状态", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "进入活动", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "进入活动", exact: true }).click();
  await page.waitForURL(/mobile\/01-start/);
  checks.push(
    "photo deletion, mobile widths, keyboard, reduced motion, basic edit, check-in and entry",
  );
  // Every optional field may remain empty, and every station fits the narrowest viewport.
  const emptyContext = await browser.newContext({
    viewport: { width: 320, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const headers = { origin: base, "Idempotency-Key": randomUUID() };
  await emptyContext.request.post(api("session"), { headers, data: {} });
  const blank = Object.fromEntries(Object.keys(r.fields).map((k) => [k, ""]));
  Object.assign(blank, {
    gender: "男",
    birthYear: "1995",
    city: "银川",
    phone: "138" + String(Date.now()).slice(-8),
  });
  const created = await emptyContext.request.post(api("save"), {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: {
      nickname: "清远",
      fields: blank,
      version: 0,
      consent: "registration-2026-10-12-v1",
      agencyAllowed: false,
    },
  });
  assert.equal(created.status(), 200);
  const ep = await emptyContext.newPage();
  await ep.goto(`${base}/mobile/register?activity=${activity}&view=details`);
  for (const label of [
    "保存并前往下一站",
    "保存并前往下一站",
    "完成填写，预览档案",
  ]) {
    assert.ok(
      await ep.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await ep.getByRole("button", { name: label, exact: true }).click();
  }
  await expect(ep.locator(".reg-save-state")).toHaveText("✓ 已保存");
  await ep.getByRole("button", { name: "编辑生活情况", exact: true }).click();
  await expect(
    ep.getByRole("button", { name: "保存并返回预览", exact: true }),
  ).toBeVisible();
  await ep.reload();
  await expect(
    ep.getByRole("button", { name: "保存并返回预览", exact: true }),
  ).toBeVisible();
  await ep.getByText("更多个人信息 · 选填", { exact: true }).click();
  await ep.getByLabel("民族", { exact: true }).scrollIntoViewIfNeeded();
  const fieldBox = await ep.getByLabel("民族", { exact: true }).boundingBox(),
    footerBox = await ep.locator(".reg-bottom").boundingBox();
  assert.ok(
    fieldBox.y + fieldBox.height <= footerBox.y,
    "last field remains above sticky footer",
  );
  await ep.getByRole("button", { name: "保存并返回预览", exact: true }).click();
  await expect(
    ep.getByRole("heading", { name: "这就是，独一无二的你。", exact: true }),
  ).toBeVisible();
  await ep.goBack();
  await expect(
    ep.getByRole("button", { name: "保存并返回预览", exact: true }),
  ).toBeVisible();
  await ep.getByRole("button", { name: /第3站 相册/ }).click();
  await ep.locator("input[type=file]").setInputFiles({
    name: "invalid.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("not-an-image"),
  });
  await expect(ep.locator("main").getByRole("alert")).toContainText("静态照片");
  await ep.locator("input[type=file]").setInputFiles({
    name: "valid.jpg",
    mimeType: "image/jpeg",
    buffer: photo,
  });
  await expect(ep.getByAltText("我的生活照片")).toHaveCount(1);
  const contrast = await ep.evaluate(() => {
    function rgba(s) {
      return s.match(/[\d.]+/g)?.map(Number) || [0, 0, 0, 0];
    }
    function lum(rgb) {
      return rgb
        .slice(0, 3)
        .map((v) => {
          v /= 255;
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        })
        .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
    }
    return [
      ...document.querySelectorAll(
        ".reg-profile-heading p,.reg-profile-heading h1,.reg-section-note,.reg-section-note>span,.reg-privacy,.reg-upload,.reg-service>p,.reg-service small,.reg-check,.reg-bottom-hint,.reg-metro button",
      ),
    ].map((el) => {
      const fg = rgba(getComputedStyle(el).color);
      let node = el,
        bg = [255, 255, 255];
      while (node) {
        const c = rgba(getComputedStyle(node).backgroundColor);
        if (c.length === 3 || c[3] === 1) {
          bg = c;
          break;
        }
        node = node.parentElement;
      }
      const a = lum(fg),
        b = lum(bg);
      return {
        selector: el.className || el.tagName,
        ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
      };
    });
  });
  assert.ok(
    contrast.every((c) => c.ratio >= 4.5),
    JSON.stringify(contrast),
  );
  fs.writeFileSync(out + "/contrast.json", JSON.stringify(contrast, null, 2));
  const emptyRecord = (await (await emptyContext.request.get(api("me"))).json())
    .record;
  assert.equal(
    (
      await op.post(api("manage"), {
        headers: { "Idempotency-Key": randomUUID() },
        data: {
          action: "cancel",
          id: emptyRecord.id,
          version: emptyRecord.version,
        },
      })
    ).status(),
    200,
  );
  await ep.getByRole("button", { name: "保存并返回预览", exact: true }).click();
  await expect(
    ep.getByRole("heading", { name: "报名已取消", exact: true }),
  ).toBeVisible();
  checks.push(
    "operator cancellation during editing returns to the cancelled ticket",
  );
  await emptyContext.close();
  checks.push(
    "all optional fields empty, browser back, edit refresh, bottom field visibility, invalid image recovery, text contrast >=4.5",
  );
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    out + "/browser-result.json",
    JSON.stringify(
      {
        passed: true,
        at: new Date().toISOString(),
        checks,
        realWeChatPending: true,
      },
      null,
      2,
    ),
  );
  console.log("Metro V1.2 browser flow passed", checks);
} catch (e) {
  await page.screenshot({
    path: out + "/failure.png",
    fullPage: true,
    animations: "disabled",
  });
  throw e;
} finally {
  await phone.close();
  await browser.close();
  await op.dispose();
  await anon.dispose();
}
