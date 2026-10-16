import { chromium, expect as baseExpect } from "@playwright/test";
import { isIP } from "node:net";
import { readFile, writeFile } from "node:fs/promises";

const dir = process.env.ADMIN_VISUAL_EVIDENCE;
const origin = process.env.ADMIN_VISUAL_ORIGIN || "http://127.0.0.1:3235";
const target = new URL(origin);
const ip = target.hostname.split(".").map(Number);
const privateIPv4 =
  isIP(target.hostname) === 4 &&
  (ip[0] === 10 ||
    (ip[0] === 172 && ip[1] >= 16 && ip[1] <= 31) ||
    (ip[0] === 192 && ip[1] === 168));
if (
  !dir ||
  !process.env.ADMIN_VISUAL_LOGIN ||
  target.protocol !== "http:" ||
  target.port !== "3235" ||
  target.username ||
  target.password ||
  target.pathname !== "/" ||
  target.search ||
  target.hash ||
  !(target.hostname === "127.0.0.1" || privateIPv4)
)
  throw Error(
    "Protected synthetic fixtures on local HTTP test port 3235 required",
  );
const fixture = JSON.parse(await readFile(dir + "/fixture.json", "utf8"));
const login = JSON.parse(
  await readFile(process.env.ADMIN_VISUAL_LOGIN, "utf8"),
);
if (!/^visual-[a-f0-9]{8}$/.test(fixture.activity))
  throw Error("Synthetic activity only");
const expect = baseExpect.configure({ timeout: 12000 });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
let browserCapabilities;
const actionRequests = [];
page.on("request", (request) => {
  if (
    new URL(request.url()).pathname === "/api/field/action" &&
    request.method() === "POST"
  ) {
    actionRequests.push({
      action: request.postDataJSON().action,
      id: request.headers()["idempotency-key"],
    });
  }
});
const errors = [],
  widths = [],
  contrasts = [];
page.on("pageerror", (error) => errors.push(error.message));
const url = (path) => origin + path + "?activity=" + fixture.activity;
const rows = () => page.locator(".admin-roster tbody tr");
async function keyboardContained(dialog) {
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press("Tab");
    expect(
      await dialog.evaluate(
        (d) =>
          d.contains(document.activeElement) ||
          (document.activeElement === document.body &&
            !d.classList.contains("admin-dialog")),
      ),
    ).toBe(true);
  }
}
async function layout(kind) {
  for (const width of [1440, 1280, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    const region = page.locator(".admin-roster-scroll");
    for (const end of [false, true]) {
      await region.evaluate(async (e, end) => {
        e.scrollLeft = end ? e.scrollWidth : 0;
        await new Promise(requestAnimationFrame);
      }, end);
      const metrics = await page.evaluate(() => {
        const region = document
          .querySelector(".admin-roster-scroll")
          .getBoundingClientRect();
        const row = document.querySelector(".admin-roster tbody tr");
        const identity = row
          .querySelector(".roster-identity")
          .getBoundingClientRect();
        const action = row
          .querySelector(".roster-actions")
          .getBoundingClientRect();
        return {
          scroll: document.documentElement.scrollWidth,
          viewport: innerWidth,
          left: region.left,
          right: region.right,
          identityRight: identity.right,
          actionLeft: action.left,
          actionRight: action.right,
        };
      });
      expect(metrics.scroll).toBeLessThanOrEqual(width);
      expect(metrics.actionLeft).toBeGreaterThanOrEqual(metrics.left);
      expect(metrics.actionRight).toBeLessThanOrEqual(metrics.right + 1);
      if (width >= 768)
        expect(metrics.identityRight).toBeLessThanOrEqual(metrics.actionLeft);
      widths.push({ kind, width, end, ...metrics });
    }
    await region.evaluate((e) => {
      e.scrollLeft = 0;
    });
    await page.screenshot({
      path: `${dir}/${kind}-${width}.png`,
      fullPage: true,
    });
    await rows()
      .first()
      .getByRole("button", { name: "查看详情", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    if (width === 768) await keyboardContained(dialog);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}
try {
  await page.goto(url("/admin/registrations"));
  browserCapabilities = await page.evaluate(() => ({
    secureContext: window.isSecureContext,
    randomUUID: typeof crypto.randomUUID,
    getRandomValues: typeof crypto.getRandomValues,
  }));
  expect(browserCapabilities.getRandomValues).toBe("function");
  if (privateIPv4) {
    expect(browserCapabilities.secureContext).toBe(false);
    expect(browserCapabilities.randomUUID).toBe("undefined");
  }
  await page.getByLabel("运营账号").fill("uat-operator");
  await page.getByLabel("密码", { exact: true }).fill(login.operator);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(rows()).toHaveCount(3);
  for (const label of ["待签到", "已签到", "已取消"])
    await expect(page.locator("tbody .badge", { hasText: label })).toHaveCount(
      1,
    );
  await expect(
    page.getByRole("button", { name: "查询", exact: true }),
  ).toHaveClass(/button-primary/);
  for (const row of await rows().all()) {
    const label = await row.locator(".badge").innerText();
    await row.getByRole("button", { name: "查看详情" }).click();
    await expect(page.getByRole("dialog").locator(".badge")).toHaveText(label);
    await page.getByRole("button", { name: "关闭详情", exact: true }).click();
    await expect(row.getByRole("button", { name: "查看详情" })).toBeFocused();
  }
  // Contrast of every status appearance against its actual computed background.
  contrasts.push(
    ...(await page.locator(".admin-status .badge").evaluateAll((nodes) => {
      const luminance = (color) => {
        const [r, g, b] = color
          .match(/[\d.]+/g)
          .slice(0, 3)
          .map(Number)
          .map((v) => {
            v /= 255;
            return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
          });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      return nodes.map((node) => {
        const style = getComputedStyle(node),
          a = luminance(style.color),
          b = luminance(style.backgroundColor);
        return {
          text: node.textContent,
          ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        };
      });
    })),
  );
  expect(contrasts.every((c) => c.ratio >= 4.5)).toBe(true);
  await layout("registrations");
  await page.getByLabel("报名状态筛选").selectOption("checked_in");
  await expect(rows()).toHaveCount(1);
  await page.getByRole("button", { name: "重置", exact: true }).click();
  await expect(rows()).toHaveCount(3);
  await page.getByLabel("搜索报名").fill("不存在的昵称");
  await page.getByRole("button", { name: "查询", exact: true }).click();
  await expect(
    page.getByText("没有符合筛选条件的报名，可重置条件后重试。"),
  ).toBeVisible();
  await page.getByRole("button", { name: "重置", exact: true }).click();
  await expect(rows()).toHaveCount(3);
  const recordRoute = "**/api/registration/records?**";
  await page.route(recordRoute, (r) =>
    r.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "合成测试：读取失败" }),
    }),
  );
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(page.locator(".reg-admin").getByRole("alert")).toHaveText(
    "合成测试：读取失败",
  );
  await expect(rows()).toHaveCount(3);
  await expect(page.locator(".reg-sync")).toContainText("当前内容可能不是最新");
  await page.screenshot({ path: dir + "/read-failure.png", fullPage: true });
  await page.unroute(recordRoute);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route(recordRoute, async (r) => {
    await gate;
    await r.continue();
  });
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.locator(".reg-sync")).toContainText("正在读取报名数据");
  await expect(
    page.getByText("当前活动还没有报名，可分享报名二维码。"),
  ).toHaveCount(0);
  release();
  await expect(page.locator(".reg-admin").getByRole("alert")).toHaveCount(0);
  await expect(page.locator(".reg-sync")).toContainText("报名数据更新于");
  await page.unroute(recordRoute);
  await page.route(recordRoute, async (r) => {
    const response = await r.fetch();
    const data = await response.json();
    await r.fulfill({
      response,
      json: {
        ...data,
        items: [],
        total: 0,
        stats: { total: 0, male: 0, female: 0, checked_in: 0 },
      },
    });
  });
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(
    page.getByText("当前活动还没有报名，可分享报名二维码。"),
  ).toBeVisible();
  await page.unroute(recordRoute);
  await page.goto(url("/admin/participants"));
  await expect(rows()).toHaveCount(3);
  await expect(rows().filter({ hasText: "晚霞轻轻落" })).toContainText(
    "暂停推荐",
  );
  await expect(rows().filter({ hasText: "测试远山" })).toContainText("已离场");
  await expect(
    page.getByRole("button", { name: "从本场移除", exact: true }),
  ).toHaveCount(0);
  await layout("participants");
  await page.getByRole("checkbox", { name: "选择本页全部参与者" }).check();
  await expect(page.locator(".field-selection-count")).toHaveText("已选 3 人");
  await page.getByRole("button", { name: "标记离场", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("报名与同舟档案保留");
  await keyboardContained(dialog);
  await page.screenshot({ path: dir + "/leave-preview.png" });
  const actionRoute = "**/api/field/action?**";
  await page.route(actionRoute, (r) =>
    r.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "合成测试：提交失败" }),
    }),
  );
  await dialog.getByRole("button", { name: "确认离场", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveCount(1);
  await expect(page.getByText("操作已由服务器确认。")).toHaveCount(0);
  await page.unroute(actionRoute);
  await dialog.getByRole("button", { name: "确认离场", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const leaveAttempts = actionRequests.filter((r) => r.action === "leave");
  expect(leaveAttempts).toHaveLength(2);
  expect(leaveAttempts[0].id).toBe(leaveAttempts[1].id);
  await expect(
    page.locator(".participant-roster tbody td:nth-child(3) .badge", {
      hasText: "已离场",
    }),
  ).toHaveCount(3);
  await page.getByRole("checkbox", { name: "选择本页全部参与者" }).check();
  await page.getByRole("button", { name: "恢复入场", exact: true }).click();
  await page.getByRole("button", { name: "确认恢复", exact: true }).click();
  await expect(
    page.locator(".participant-roster tbody td:nth-child(3) .badge", {
      hasText: "在场",
    }),
  ).toHaveCount(3);
  await rows().first().getByRole("button", { name: "选择并管理" }).click();
  await page.getByRole("button", { name: "从本场移除", exact: true }).click();
  await expect(page.getByRole("button", { name: "确认移除" })).toHaveClass(
    /admin-danger-confirm/,
  );
  await page.getByRole("button", { name: "确认移除" }).click();
  await expect(rows()).toHaveCount(2);
  await page.goto(url("/admin/activities"));
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "关闭现场", exact: true }).click();
  await page
    .getByRole("button", { name: "结束本轮并清零现场", exact: true })
    .click();
  const confirm = page.getByRole("button", { name: "确认清零", exact: true });
  await expect(confirm).toBeDisabled();
  await page.getByLabel("确认活动标识").fill(fixture.activity);
  await expect(confirm).toBeDisabled();
  await page
    .getByRole("checkbox", { name: "已确认现场所有遇见地点空闲" })
    .check();
  await expect(confirm).toBeEnabled();
  await page.screenshot({ path: dir + "/reset-preview.png" });
  const beforeReset = await (
    await page.request.get(url("/api/field/overview"))
  ).json();
  expect(beforeReset.open).toBe(false);
  const resetResponse = page.waitForResponse(
    (r) =>
      r.url().includes("/api/field/action?") &&
      r.request().postDataJSON()?.action === "reset",
  );
  await confirm.click();
  const resetResult = await (await resetResponse).json();
  expect(resetResult.ok).toBe(true);
  expect(resetResult.count).toBe(2);
  expect(resetResult.previousEpoch).toBe(beforeReset.epoch);
  expect(resetResult.epoch).not.toBe(beforeReset.epoch);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const afterReset = await (
    await page.request.get(url("/api/field/overview"))
  ).json();
  expect(afterReset.epoch).toBe(resetResult.epoch);
  expect(afterReset.open).toBe(false);
  expect(
    afterReset.archives.some(
      (a) => a.action === "reset" && a.epoch === beforeReset.epoch,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "开放现场", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "关闭现场", exact: true }),
  ).toBeVisible();
  const createdActivity = fixture.activity + "-new";
  await page.getByLabel("新活动标识").fill(createdActivity);
  await page.getByRole("button", { name: "创建活动", exact: true }).click();
  const createdRow = page
    .locator(".activity-list > div")
    .filter({ hasText: createdActivity });
  await expect(createdRow).toContainText("报名关闭 · 现场关闭");
  await createdRow.getByRole("button", { name: "管理", exact: true }).click();
  await expect(page).toHaveURL(
    origin + "/admin/activities?activity=" + createdActivity,
  );
  await expect(
    page.getByRole("button", { name: "开放现场", exact: true }),
  ).toBeVisible();
  await page.getByLabel("切换活动").selectOption(fixture.activity);
  await expect(page).toHaveURL(url("/admin/activities"));
  await page.goto(url("/admin/participants"));
  await expect(rows()).toHaveCount(0);
  await page.goto(url("/admin/registrations"));
  await expect(rows()).toHaveCount(3);
  expect(errors).toEqual([]);
  for (const request of actionRequests) {
    expect(request.id).toMatch(
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
    );
  }
  await writeFile(
    dir + "/results.json",
    JSON.stringify(
      {
        activity: fixture.activity,
        origin,
        browserCapabilities,
        actionRequests,
        resetResult,
        widths,
        contrasts,
        errors,
        passed: [
          "server-statuses",
          "list-detail-consistency",
          "keyboard-focus",
          "sticky-actions",
          "filter-empty",
          "loading-failure-retry",
          "batch-leave-restore",
          "remove",
          "reset-guards",
          "reset-executed-new-epoch",
          "close-open-create-switch",
          "failed-action-retry-same-id",
          "uuid-v4-format",
          "registration-retained",
        ],
      },
      null,
      2,
    ),
  );
  console.log("Admin visual UAT passed");
} finally {
  await browser.close();
}
