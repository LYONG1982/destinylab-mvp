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
  u.search ||
  u.hash ||
  u.pathname !== "/" ||
  isIP(u.hostname) !== 4 ||
  !(
    ip[0] === 10 ||
    (ip[0] === 192 && ip[1] === 168) ||
    (ip[0] === 172 && ip[1] >= 16 && ip[1] <= 31)
  )
)
  throw Error("Private test origin only");
const f = JSON.parse(await readFile(dir + "/ux-fixture.json", "utf8"));
if (!/^wallux-[a-f0-9]{8}$/.test(f.activity))
  throw Error("Synthetic fixture only");
const expect = baseExpect.configure({ timeout: 12000 }),
  browser = await chromium.launch({ channel: "chrome", headless: true }),
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
context.setDefaultTimeout(15000);
await context.addCookies(f.cookies.map((c) => ({ ...c, url: origin })));
const page = await context.newPage(),
  errors = [],
  dialogs = [];
page.on("pageerror", (e) => errors.push(e.message));
let accept = true;
page.on("dialog", (d) => {
  dialogs.push(d.type());
  return accept ? d.accept() : d.dismiss();
});
const url = (p) => origin + p + "?activity=" + f.activity,
  flip = () => page.getByLabel("卡片翻面间隔（秒）"),
  root = () => page.getByTestId("wall-settings");
try {
  await page.goto(url("/admin/participants"));
  await page.getByRole("link", { name: "遇见卡牌墙", exact: true }).click();
  await expect(flip()).toBeEnabled();
  const initial = await flip().inputValue();
  const edited = initial === "9" ? "10" : "9";
  await flip().fill(edited);
  accept = false;
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(root()).toBeVisible();
  await page.getByRole("link", { name: "打开大屏", exact: true }).click();
  expect(context.pages().length).toBe(1);
  // Native Back cancellation restores the original URL and the preserved draft.
  const originalIndex = await page.evaluate(
    () => navigation.currentEntry.index,
  );
  const backDialog = page.waitForEvent("dialog");
  await page.evaluate(() => history.back());
  await backDialog;
  await page.waitForFunction(
    (index) => navigation.currentEntry.index === index,
    originalIndex,
  );
  await expect(page).toHaveURL(url("/admin/member-wall"));
  await expect(flip()).toHaveValue(edited);
  accept = true;
  await page.evaluate(() => history.back());
  await expect(page).toHaveURL(url("/admin/participants"));
  await page.evaluate(() => history.forward());
  await expect(page).toHaveURL(url("/admin/member-wall"));
  await expect(flip()).toHaveValue(edited);
  await page.getByRole("button", { name: "取消更改", exact: true }).click();
  await expect(flip()).toHaveValue(initial);
  const anonymous = await browser.newContext();
  expect(
    (await anonymous.request.get(url("/api/member-wall/admin"))).status(),
  ).toBe(401);
  const publicData = await (
    await anonymous.request.get(url("/api/member-wall/snapshot"))
  ).json();
  expect(publicData.diagnostics).toBeUndefined();
  await anonymous.close();
  // Desktop-ratio preview uses a real desktop viewport inside a scaled frame.
  await page.getByLabel("屏幕比例").selectOption("desktop");
  await page.getByLabel("预览场景").selectOption("back");
  const frame = page.frameLocator('iframe[title="模拟卡牌墙缩略预览"]');
  await expect(frame.getByTestId("member-wall")).toHaveAttribute(
    "data-side",
    "back",
  );
  await expect(frame.locator("[data-member]")).toHaveCount(24);
  // An indefinitely delayed read must surface a timeout rather than an endless loading spinner.
  let release;
  const gate = new Promise((r) => (release = r));
  await page.route("**/api/member-wall/admin?**", async (r) => {
    await gate;
    try {
      await r.continue();
    } catch {}
  });
  await page.getByRole("button", { name: "刷新状态", exact: true }).click();
  await expect(
    root().getByText("读取超时，请重试。", { exact: true }),
  ).toBeVisible({ timeout: 10000 });
  await expect(root().getByTestId("wall-screen-status")).toContainText(
    "状态待确认",
  );
  release();
  await page.unroute("**/api/member-wall/admin?**");
  await expect(
    root().getByText("读取超时，请重试。", { exact: true }),
  ).toHaveCount(0, { timeout: 15000 });
  expect(errors).toEqual([]);
  await writeFile(
    dir + "/navigation-results.json",
    JSON.stringify(
      {
        origin, activity: f.activity,
        checks: [
          "logout-cancel",
          "open-screen-dirty-cancel",
          "back-cancel-restore",
          "back-forward-draft",
          "operator-diagnostics-private",
          "desktop-preview-back",
          "slow-read-timeout-recovery",
        ],
        dialogs,
        errors,
      },
      null,
      2,
    ),
  );
  console.log("Navigation and boundary checks passed");
} catch (error) {
  console.log(
    "history-failure",
    await page.evaluate(() => ({
      url: location.href,
      index: navigation.currentEntry.index,
    })),
    dialogs,
  );
  await page.screenshot({
    path: dir + "/navigation-debug.png",
    fullPage: true,
  });
  throw error;
} finally {
  await browser.close();
}
