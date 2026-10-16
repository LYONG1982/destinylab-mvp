import { chromium, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
const dir = process.env.FIELD_UI_EVIDENCE;
if (!dir)
  throw Error(
    "FIELD_UI_EVIDENCE must point to protected synthetic test fixtures",
  );
const fixture = JSON.parse(await readFile(dir + "/fixture.json", "utf8")),
  login = JSON.parse(await readFile(dir + "/ui-login.json", "utf8"));
const base = process.env.FIELD_UI_ORIGIN || "http://127.0.0.1:3235",
  activity = fixture.activity;
if (new URL(base).hostname !== "127.0.0.1" || !activity.startsWith("field-"))
  throw Error("Synthetic loopback UAT only");
expect.configure({ timeout: 15000 });
const browser = await chromium.launch({ channel: "chrome", headless: true }),
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  }),
  page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const url = (p) => `${base}${p}?activity=${activity}`;
await page.goto(url("/admin/registrations"));
await page.getByLabel("运营账号").fill("uat-operator");
await page.getByLabel("密码", { exact: true }).fill(login.operator);
await page.getByRole("button", { name: "登录", exact: true }).click();
await expect(
  page.getByRole("heading", { name: "活动报名", exact: true }),
).toBeVisible();
await expect(page.getByText("测试清禾", { exact: true })).toBeVisible();
await expect(page.getByText("138****0018", { exact: true })).toBeVisible();
await expect(page.getByText("题目统计与相遇点配置")).toHaveCount(0);
const widths = [];
for (const width of [1440, 1280, 1024, 768]) {
  await page.setViewportSize({ width, height: 900 });
  await page.screenshot({
    path: dir + `/registrations-${width}.png`,
    fullPage: true,
  });
  widths.push({
    width,
    ...(await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: innerWidth,
      listY:
        document.querySelector(".reg-admin table")?.getBoundingClientRect()
          .top ?? null,
    }))),
  });
}
await page.setViewportSize({ width: 1440, height: 1000 });
await page.route("**/api/registration/records?**", (r) =>
  r.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ error: "UAT模拟读取失败，请重试" }),
  }),
);
await page.getByRole("button", { name: "刷新", exact: true }).click();
await expect(page.getByText("UAT模拟读取失败，请重试")).toBeVisible();
await page.screenshot({ path: dir + "/registrations-error.png" });
await page.unroute("**/api/registration/records?**");
await page.getByRole("button", { name: "重试", exact: true }).click();
await expect(page.getByText("UAT模拟读取失败，请重试")).toHaveCount(0);
await page.goto(url("/admin/participants"));
await expect(
  page.getByRole("checkbox", { name: "选择本页全部参与者" }),
).toBeVisible();
await page.getByRole("checkbox", { name: "选择本页全部参与者" }).check();
await page.getByRole("button", { name: "标记离场", exact: true }).click();
await expect(page.getByRole("dialog")).toBeVisible();
await page.screenshot({ path: dir + "/leave-preview.png" });
await page
  .getByRole("dialog")
  .getByRole("button", { name: /^确认(离场|恢复|移除|清零)$/ })
  .click();
await expect(page.getByRole("dialog")).toHaveCount(0);
await expect(page.locator("tbody tr").first()).toContainText("已离场");
await page.getByRole("checkbox", { name: "选择本页全部参与者" }).check();
await page.getByRole("button", { name: "恢复入场", exact: true }).click();
await page
  .getByRole("dialog")
  .getByRole("button", { name: /^确认(离场|恢复|移除|清零)$/ })
  .click();
await expect(page.locator("tbody tr").first()).toContainText("在场");
const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  }),
  mobile = await mobileContext.newPage();
await mobile.goto(url("/mobile/01-start"));
await expect(mobile.getByText("轻松聊聊", { exact: true })).toBeVisible();
await mobile.getByText("轻松聊聊", { exact: true }).click();
await page.reload();
await expect(page.locator("tbody tr")).toHaveCount(2);
await page.getByRole("checkbox", { name: "选择本页全部参与者" }).check();
await page.getByRole("button", { name: "标记离场", exact: true }).click();
await page
  .getByRole("dialog")
  .getByRole("button", { name: /^确认(离场|恢复|移除|清零)$/ })
  .click();
await expect(mobile.getByText("你已离场", { exact: false })).toBeVisible();
await mobile.reload();
await expect(mobile.getByText("你已离场", { exact: false })).toBeVisible();
await page.getByRole("checkbox", { name: "选择本页全部参与者" }).check();
await page.getByRole("button", { name: "恢复入场", exact: true }).click();
await page
  .getByRole("dialog")
  .getByRole("button", { name: /^确认(离场|恢复|移除|清零)$/ })
  .click();
await expect(mobile.getByText("你已离场", { exact: false })).toHaveCount(0);
await page.goto(url("/admin/activities"));
await expect(page.getByRole("heading", { name: "现场控制" })).toBeVisible();
await page.screenshot({ path: dir + "/activities.png", fullPage: true });
const images = await page
  .locator(".entry-cards img")
  .evaluateAll((imgs) => imgs.map((i) => ({ alt: i.alt, src: i.src })));
const { PNG } = await import("pngjs"),
  { default: jsQR } = await import("jsqr");
const qr = images.map((i) => {
  const p = PNG.sync.read(Buffer.from(i.src.split(",")[1], "base64"));
  const decoded = jsQR(new Uint8ClampedArray(p.data), p.width, p.height)?.data;
  if (!decoded?.endsWith("activity=" + activity)) throw Error("QR mismatch");
  return { alt: i.alt, url: decoded, width: p.width };
});
page.on("dialog", (d) => d.accept());
await page.getByRole("button", { name: "关闭现场", exact: true }).click();
await expect(
  page.getByRole("button", { name: "开放现场", exact: true }),
).toBeVisible();
await page
  .getByRole("button", { name: "结束本轮并清零现场", exact: true })
  .click();
await expect(page.getByRole("dialog")).toBeVisible();
await page.getByLabel("确认活动标识").fill(activity);
await page
  .getByRole("checkbox", { name: "已确认现场所有遇见地点空闲" })
  .check();
await page.screenshot({ path: dir + "/reset-preview.png" });
await page
  .getByRole("dialog")
  .getByRole("button", { name: /^确认(离场|恢复|移除|清零)$/ })
  .click();
await expect(page.getByRole("dialog")).toHaveCount(0);
await expect(
  mobile.getByText("本轮参与已结束", { exact: false }),
).toBeVisible();
await page.getByRole("button", { name: "开放现场", exact: true }).click();
await expect(
  page.getByRole("button", { name: "关闭现场", exact: true }),
).toBeVisible();
await page.goto(url("/admin/participants"));
await expect(page.locator("tbody tr")).toHaveCount(0);
await mobile.reload();
await expect(
  mobile.getByRole("button", { name: "重新进入现场" }),
).toBeVisible();
await page.reload();
await expect(page.locator("tbody tr")).toHaveCount(0);
await mobile.getByRole("button", { name: "重新进入现场" }).click();
await expect(mobile.getByText("轻松聊聊", { exact: true })).toBeVisible();
await page.reload();
await expect(page.locator("tbody tr")).toHaveCount(1);
await page.getByRole("checkbox", { name: "选择本页全部参与者" }).check();
await page.getByRole("button", { name: "从本场移除", exact: true }).click();
await page
  .getByRole("dialog")
  .getByRole("button", { name: /^确认(离场|恢复|移除|清零)$/ })
  .click();
await expect(page.locator("tbody tr")).toHaveCount(0);
await mobile.reload();
await expect(
  mobile.getByText("你已从本场移除", { exact: false }),
).toBeVisible();
await page.goto(url("/admin/registrations"));
await expect(page.getByText("测试清禾", { exact: true })).toBeVisible();
const agency = await context.newPage();
await agency.goto(url("/agency/tongzhou"));
await agency.getByLabel("账号", { exact: true }).fill("uat-agency");
await agency.getByLabel("密码", { exact: true }).fill(login.agency);
await agency.getByRole("button", { name: "登录", exact: true }).click();
await agency.getByRole("button", { name: "合成测试用户", exact: true }).click();
await expect(agency.getByLabel("工作人员备注")).toHaveValue("清零后仍需跟进");
await agency.getByRole("tab", { name: "用户照片" }).click();
await expect(agency.locator('[role="tabpanel"] img').first()).toBeVisible();
await agency.screenshot({ path: dir + "/agency-retained.png", fullPage: true });
const publicPage = await context.newPage();
await publicPage.goto(base + "/tongzhou/p/" + fixture.slug);
await expect(
  publicPage.getByText("清禾", { exact: true }).first(),
).toBeVisible();
await publicPage.screenshot({
  path: dir + "/public-retained.png",
  fullPage: true,
});
await agency.getByLabel("关闭详情").click();
await agency.getByLabel("切换活动").selectOption(fixture.other);
await agency.waitForURL("**activity=" + fixture.other);
await expect(
  agency.getByRole("button", { name: "合成测试用户", exact: true }),
).toHaveCount(0);
await page.goto(url("/admin/activities"));
await page.getByLabel("切换活动").selectOption(fixture.other);
await page.waitForURL("**activity=" + fixture.other);
await expect(
  page.getByRole("button", { name: "关闭现场", exact: true }),
).toBeVisible();
if (widths.some((w) => w.scroll > w.width))
  throw Error("Page horizontal overflow");
if (errors.length) throw Error(errors.join(";"));
await writeFile(
  dir + "/ui-results.json",
  JSON.stringify(
    {
      activity,
      widths,
      errors,
      qr,
      passed: [
        "list",
        "masking",
        "error-retry",
        "leave-restore",
        "reset",
        "no-auto-rejoin",
        "explicit-rejoin",
        "removal",
        "agency-preservation",
        "public-page",
        "activity-scope",
      ],
    },
    null,
    2,
  ),
);
console.log("Playwright field UAT passed");
await writeFile(
  dir + "/ui-initial-results.json",
  JSON.stringify({ activity, widths, errors }, null, 2),
);
await browser.close();
