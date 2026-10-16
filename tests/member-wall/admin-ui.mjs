import { chromium, expect as baseExpect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
const origin = process.env.WALL_UX_ORIGIN,
  dir = process.env.WALL_UX_EVIDENCE;
const u = new URL(origin || "http://invalid"),
  ip = u.hostname.split(".").map(Number);
if (
  !dir ||
  u.protocol !== "http:" ||
  u.port !== "3235" ||
  u.username ||
  u.password ||
  u.pathname !== "/" ||
  u.search ||
  u.hash ||
  isIP(u.hostname) !== 4 ||
  !(
    ip[0] === 10 ||
    (ip[0] === 192 && ip[1] === 168) ||
    (ip[0] === 172 && ip[1] >= 16 && ip[1] <= 31)
  )
)
  throw Error("Private IPv4 HTTP port3235 and isolated fixture required");
const f = JSON.parse(await readFile(dir + "/ux-fixture.json", "utf8"));
if (
  !/^wallux-[a-f0-9]{8}$/.test(f.activity) ||
  f.empty !== f.activity + "-empty" ||
  f.legacy !== f.activity + "-demo"
)
  throw Error("Synthetic activities only");
const expect = baseExpect.configure({ timeout: 12000 }),
  browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
});
context.setDefaultTimeout(15000);
context.setDefaultNavigationTimeout(30000);
await context.addCookies(f.cookies.map((c) => ({ ...c, url: origin })));
const page = await context.newPage(),
  errors = [],
  checks = [],
  widths = [];
context.on("page", (p) => p.on("pageerror", (e) => errors.push(e.message)));
page.on("pageerror", (e) => errors.push(e.message));
let accept = true;
page.on("dialog", (d) => (accept ? d.accept() : d.dismiss()));
const path = (p, id = f.activity) => `${origin}${p}?activity=${id}`;
const root = () => page.getByTestId("wall-settings");
const flip = () => page.getByLabel("卡片翻面间隔（秒）");
const rotation = () => page.getByLabel("换人间隔（秒）");
const save = () => page.getByRole("button", { name: "保存配置", exact: true });
const admin = async (id = f.activity) =>
  (await page.request.get(path("/api/member-wall/admin", id))).json();
const post = async (p, data, id = f.activity) => {
  const r = await page.request.post(path("/api/member-wall/" + p, id), {
    headers: { Origin: origin },
    data,
  });
  expect(r.ok()).toBe(true);
  return r.json();
};
const cancel = async () => {
  await page.getByRole("button", { name: "取消更改", exact: true }).click();
};
try {
  let release;
  const gate = new Promise((r) => (release = r));
  const adminRoute = "**/api/member-wall/admin?**";
  await page.route(adminRoute, async (r) => {
    await gate;
    await r.fulfill({ status: 503, json: { error: "合成测试：读取失败" } });
  });
  await page.goto(path("/admin/member-wall"));
  await expect(root()).toBeVisible();
  await expect(root().getByText("正在连接", { exact: true })).toBeVisible();
  await expect(root().locator("dd")).toHaveText(["—", "—", "—", "—"]);
  release();
  await expect(
    root().getByText("合成测试：读取失败", { exact: true }),
  ).toBeVisible();
  await expect(root().locator("dd")).toHaveText(["—", "—", "—", "—"]);
  await page.screenshot({ path: dir + "/initial-failure.png", fullPage: true });
  await page.unroute(adminRoute);
  await page.getByRole("button", { name: "重试读取", exact: true }).click();
  await expect(root().locator("dd")).toHaveText(["7人", "6人", "4人", "0人"]);
  await expect(save()).toBeDisabled();
  const capabilities = await page.evaluate(() => ({
    secureContext: isSecureContext,
    randomUUID: typeof crypto.randomUUID,
  }));
  expect(capabilities.secureContext).toBe(false);
  expect(capabilities.randomUUID).toBe("undefined");
  checks.push(
    "loading-failure-not-zero",
    "server-counts-and-diagnostics",
    "LAN-HTTP",
  );
  for (const width of [1440, 1280, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1100 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await expect(flip()).toBeVisible();
    await page.screenshot({
      path: `${dir}/admin-${width}.png`,
      fullPage: true,
    });
    widths.push(width);
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByRole("button", { name: "连接、主控与异常帮助" }).click();
  const help = page.getByRole("dialog");
  await expect(help).toBeVisible();
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("Tab");
    expect(await help.evaluate((d) => d.contains(document.activeElement))).toBe(
      true,
    );
  }
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "连接、主控与异常帮助" }),
  ).toBeFocused();
  await flip().fill("7");
  await expect(flip()).toHaveAttribute("aria-invalid", "true");
  await expect(save()).toBeDisabled();
  await flip().fill("30");
  await expect(rotation()).toHaveAttribute("aria-invalid", "true");
  await rotation().fill("60");
  await expect(save()).toBeEnabled();
  await page.getByRole("button", { name: "刷新状态", exact: true }).click();
  await expect(flip()).toHaveValue("30");
  accept = false;
  await page.getByRole("link", { name: "现场参与者", exact: true }).click();
  await expect(page).toHaveURL(path("/admin/member-wall"));
  accept = true;
  await page.route("**/api/member-wall/config?**", (r) =>
    r.fulfill({ status: 503, json: { error: "合成测试：保存失败" } }),
  );
  await save().click();
  await expect(
    root().getByText("合成测试：保存失败", { exact: true }),
  ).toBeVisible();
  await expect(flip()).toHaveValue("30");
  await expect(root().getByText(/^已保存 ·/)).toHaveCount(0);
  await page.unroute("**/api/member-wall/config?**");
  await save().click();
  await expect(root().getByText(/^已保存 ·/)).toBeVisible();
  await expect(save()).toBeDisabled();
  expect((await admin()).config.flipSeconds).toBe(30);
  expect((await admin()).activeScreen).toBe(false);
  checks.push(
    "field-bounds",
    "poll-preserves-draft",
    "navigation-cancel",
    "save-failure-retains-draft",
    "server-save-not-start",
  );
  await flip().fill("25");
  await page.reload();
  await expect(flip()).toHaveValue("25");
  await expect(root().getByText(/已恢复本窗口/)).toBeVisible();
  let a = await admin();
  await post("config", {
    config: { ...a.config, flipSeconds: 20 },
    expectedVersion: a.configVersion,
  });
  await page.getByRole("button", { name: "刷新状态", exact: true }).click();
  await expect(root().getByText(/服务器配置已由其他窗口更新/)).toBeVisible();
  await expect(flip()).toHaveValue("25");
  await expect(save()).toBeDisabled();
  await cancel();
  await expect(flip()).toHaveValue("20");
  // Race: server changes after last UI read. The 409 response must not overwrite the draft.
  await flip().fill("18");
  a = await admin();
  await post("config", {
    config: { ...a.config, flipSeconds: 22 },
    expectedVersion: a.configVersion,
  });
  await save().click();
  await expect(root().getByText(/配置已变化，请刷新后重试/)).toBeVisible();
  await expect(flip()).toHaveValue("18");
  await expect(root().getByText(/服务器配置已由其他窗口更新/)).toBeVisible();
  await cancel();
  await expect(flip()).toHaveValue("22");
  await page.getByRole("button", { name: "恢复默认设置" }).click();
  await expect(flip()).toHaveValue("10");
  expect((await admin()).config.flipSeconds).toBe(22);
  await cancel();
  checks.push(
    "refresh-restores-draft",
    "version-conflict-keeps-draft",
    "save-409",
    "defaults-draft-only",
  );
  await flip().fill("8");
  await rotation().fill("16");
  const previewPromise = context.waitForEvent("page");
  await root().getByRole("link", { name: "预览效果", exact: true }).click();
  const preview = await previewPromise;
  const previewWrites = [];
  preview.on("request", (r) => {
    if (r.method() === "POST") previewWrites.push(new URL(r.url()).pathname);
  });
  await expect(
    preview.getByText("模拟预览 · 不影响现场", { exact: true }),
  ).toBeVisible();
  await expect(preview.getByTestId("member-wall")).toHaveAttribute(
    "data-mode",
    "demo",
  );
  await expect(preview.getByTestId("member-wall")).toHaveAttribute(
    "data-side",
    "back",
    { timeout: 11000 },
  );
  await preview.screenshot({ path: dir + "/preview-back.png" });
  await preview.getByRole("link", { name: "8 人", exact: true }).click();
  await expect(preview.locator("[data-member]")).toHaveCount(8);
  expect(new URL(preview.url()).searchParams.get("flip")).toBe("8");
  expect((await admin()).activeScreen).toBe(false);
  expect((await admin()).config.flipSeconds).toBe(22);
  expect(previewWrites).toEqual([]);
  await preview.close();
  await cancel();
  checks.push(
    "preview-no-write-no-claim",
    "preview-draft-parameters-and-flip",
    "preview-vacancies",
  );
  await flip().fill("24");
  accept = false;
  await page.getByLabel("切换活动").selectOption(f.empty);
  await expect(page).toHaveURL(path("/admin/member-wall"));
  accept = true;
  await page.getByLabel("切换活动").selectOption(f.empty);
  await expect(root().locator("dd")).toHaveText(["0人", "0人", "0人", "0人"]);
  await expect(
    root().getByText("当前没有在场参与者", { exact: true }),
  ).toBeVisible();
  await expect(flip()).toHaveValue("10");
  await page.screenshot({ path: dir + "/empty.png", fullPage: true });
  await page.getByLabel("切换活动").selectOption(f.activity);
  await expect(flip()).toHaveValue("24");
  await cancel();
  await page.getByLabel("切换活动").selectOption(f.legacy);
  await expect(
    root().getByText("现场当前为演示模式", { exact: true }),
  ).toBeVisible();
  expect((await admin(f.legacy)).config.mode).toBe("demo");
  await page
    .getByRole("button", { name: "切回真实活动资料", exact: true })
    .click();
  await save().click();
  await expect(root().getByText(/^已保存 ·/)).toBeVisible();
  expect((await admin(f.legacy)).config.mode).toBe("real");
  await page.getByLabel("切换活动").selectOption(f.activity);
  checks.push(
    "activity-switch-cancel",
    "activity-scoped-draft",
    "empty-scene",
    "legacy-demo-explicit-conversion",
  );
  // Paused visuals must continue receiving consent and presence changes.
  await page.getByRole("checkbox", { name: "启用翻面与轮播" }).uncheck();
  await save().click();
  await expect(save()).toBeDisabled();
  const screen = await context.newPage();
  await screen.setViewportSize({ width: 1920, height: 1080 });
  await screen.goto(path("/display/member-wall"));
  await screen.getByRole("button", { name: "启动主屏", exact: true }).click();
  await expect(
    screen.getByRole("button", { name: "本窗口为主屏", exact: true }),
  ).toBeVisible();
  await expect(screen.locator("[data-member]")).toHaveCount(4);
  const spectator = await context.newPage();
  await spectator.setViewportSize({ width: 1920, height: 1080 });
  await spectator.goto(path("/display/member-wall"));
  await expect(
    spectator.getByRole("button", {
      name: "其他窗口主控 · 本窗口只读",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(root().getByTestId("wall-screen-status")).toContainText(
    "主屏会话运行中",
  );
  await expect(root().locator("dd").last()).toHaveText("4人");
  await context.addCookies([{ ...f.participant, url: origin }]);
  const me = await (await page.request.get(path("/api/member-wall/me"))).json();
  await post("consent", {
    allow: false,
    nickname: "",
    expectedVersion: me.version,
    consentVersion: me.consentVersion,
  });
  await expect(screen.locator("[data-member]")).toHaveCount(3);
  await expect(spectator.locator("[data-member]")).toHaveCount(3);
  const fieldInput = { action: "leave", ids: [f.leaveActor], epoch: f.epoch };
  const pr = await page.request.post(path("/api/field/preview"), {
    headers: { Origin: origin },
    data: fieldInput,
  });
  expect(pr.ok()).toBe(true);
  const pv = await pr.json();
  const rr = await page.request.post(path("/api/field/action"), {
    headers: { Origin: origin, "Idempotency-Key": crypto.randomUUID() },
    data: { ...fieldInput, preview: pv.token },
  });
  expect(rr.ok()).toBe(true);
  await expect(screen.locator("[data-member]")).toHaveCount(2);
  await screen.screenshot({ path: dir + "/paused-consent-presence.png" });
  await spectator.evaluate(() => {
    HTMLElement.prototype.requestFullscreen = () =>
      Promise.reject(new Error("test denied"));
  });
  await spectator.getByRole("button", { name: "全屏", exact: true }).click();
  await expect(spectator.getByText(/浏览器未允许全屏/)).toBeVisible();
  // Saving actively invalidates the existing lease; neither page can silently reclaim.
  await flip().fill("21");
  accept = false;
  await save().click();
  expect((await admin()).activeScreen).toBe(true);
  accept = true;
  await save().click();
  await expect(root().getByText(/^已保存 ·/)).toBeVisible();
  await expect(
    screen.getByRole("button", { name: "启动主屏", exact: true }),
  ).toBeEnabled();
  expect((await admin()).activeScreen).toBe(false);
  await screen.getByRole("button", { name: "启动主屏", exact: true }).click();
  await expect(screen.locator("[data-member]")).toHaveCount(2);
  await screen.route("**/api/**", (r) => r.abort());
  await expect(screen.getByTestId("member-wall")).toHaveAttribute(
    "data-status",
    "expired",
    { timeout: 20000 },
  );
  await expect(screen.locator("[data-member]")).toHaveCount(0);
  await expect(root().getByTestId("wall-screen-status")).toContainText(
    "已到期",
    { timeout: 20000 },
  );
  await screen.unroute("**/api/**");
  await screen.reload();
  await expect(
    screen.getByRole("button", { name: "启动主屏", exact: true }),
  ).toBeEnabled();
  await screen.getByRole("button", { name: "启动主屏", exact: true }).click();
  await expect(screen.locator("[data-member]")).toHaveCount(2);
  await screen.close();
  await spectator.close();
  checks.push(
    "two-window-readonly",
    "paused-revocation-and-leave",
    "fullscreen-rejection",
    "save-ends-lease-confirmation",
    "offline-hides-expired-data",
    "expiry-manual-restart",
  );
  expect(errors).toEqual([]);
  await writeFile(
    dir + "/ux-results.json",
    JSON.stringify(
      { origin, activity: f.activity, capabilities, widths, checks, errors },
      null,
      2,
    ),
  );
  console.log("Wall UX LAN browser checks passed:", checks.length);
} finally {
  await browser.close();
}
