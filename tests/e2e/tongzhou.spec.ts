import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import type { DemoState } from "../../src/domain/types";
const KEY = "destinylab:v1.1:state";
const evidence = "docs/verification/destiny-field-act3-v2/regression/tongzhou";
async function scenario(page: Page, scene = "discover") {
  await page.goto("/demo");
  await page.getByTestId(`scenario-${scene}`).click();
  await page.getByRole("button", { name: "确认载入", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
const saved = (page: Page): Promise<DemoState> =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), KEY);
async function form(page: Page, actor = "p-shanfeng") {
  await page.goto(`/mobile/tongzhou?actor=${actor}`);
  await expect(
    page.getByRole("combobox", { name: "民族", exact: true }),
  ).toBeVisible();
}
async function example(page: Page) {
  await page.getByRole("button", { name: "填入虚构示例" }).click();
}
async function submit(page: Page) {
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "确认授权并提交资料", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "资料已提交", exact: true }),
  ).toBeVisible();
}

test("required ethnicity, optional fields, explicit consent, failed retry and double click preserve a single record", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await scenario(page);
  const before = await saved(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await form(page);
  await expect(
    page.getByRole("combobox", { name: "民族", exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "确认授权并提交资料" }),
  ).toBeDisabled();
  await example(page);
  await page.getByRole("combobox", { name: "民族", exact: true }).fill("");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "确认授权并提交资料" }).click();
  await expect(
    page.getByRole("combobox", { name: "民族", exact: true }),
  ).toBeFocused();
  await expect(page.getByText("请填写民族", { exact: true })).toBeVisible();
  await page
    .getByRole("combobox", { name: "民族", exact: true })
    .fill("自填民族");
  await page.locator("summary").click();
  await page.getByLabel("身高（cm）", { exact: true }).fill("168");
  await page.getByLabel("月收入范围", { exact: true }).selectOption("不便透露");
  await page
    .getByLabel("家庭简述", { exact: true })
    .fill("虚构家庭简述，仅用于测试");
  await page.evaluate(() =>
    sessionStorage.setItem("destinylab:fail-next", "yes"),
  );
  await page.getByRole("button", { name: "确认授权并提交资料" }).click();
  await expect(page.locator(".tongzhou-form").getByRole("alert")).toContainText(
    "本次操作未提交",
  );
  await expect(
    page.getByRole("combobox", { name: "民族", exact: true }),
  ).toHaveValue("自填民族");
  expect((await saved(page)).tongzhouSubmissions).toHaveLength(0);
  await page.getByRole("button", { name: "确认授权并提交资料" }).dblclick();
  await expect(
    page.getByRole("heading", { name: "资料已提交", exact: true }),
  ).toBeVisible();
  const after = await saved(page);
  expect(after.tongzhouSubmissions).toHaveLength(1);
  expect(after.tongzhouSubmissions[0].fields!.ethnicity).toBe("自填民族");
  expect(after.participants).toEqual(before.participants);
  expect(after.invitations).toEqual(before.invitations);
  expect(after.events).toEqual(before.events);
  await page.reload();
  await expect(page.locator(".tongzhou-details")).toContainText("自填民族");
  const agency = await context.newPage();
  await agency.goto("/agency/tongzhou");
  await expect(agency.locator(".tongzhou-record")).toContainText("138****0000");
  await expect(agency.locator(".tongzhou-record")).not.toContainText(
    "自填民族",
  );
  await agency.locator(".tongzhou-record").click();
  await expect(agency.getByRole("region", { name: "填报详情" })).toContainText(
    "自填民族",
  );
  await agency.getByLabel("查找资料").fill("无此城市");
  await expect(
    agency.getByRole("heading", { name: "没有符合条件的资料" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("updates sync to agency; withdrawal clears open detail and stale editor; deletion clears all personal values", async ({
  page,
  context,
}) => {
  await scenario(page);
  await form(page);
  await example(page);
  await submit(page);
  const other = await context.newPage();
  await other.goto("/mobile/tongzhou?actor=p-shanfeng");
  await other.getByRole("button", { name: "修改填报资料" }).click();
  const agency = await context.newPage();
  await agency.goto("/agency/tongzhou");
  await agency.locator(".tongzhou-record").click();
  await page.getByRole("button", { name: "修改填报资料" }).click();
  await page
    .getByRole("textbox", { name: "所在城市", exact: true })
    .fill("演示新城");
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await submit(page);
  await expect(agency.getByRole("region", { name: "填报详情" })).toContainText(
    "演示新城",
  );
  await expect(
    other.getByRole("heading", { name: "资料已提交", exact: true }),
  ).toBeVisible();
  await other.getByRole("button", { name: "修改填报资料" }).click();
  await other.evaluate(() =>
    sessionStorage.setItem("destinylab:delay", "2500"),
  );
  await other
    .getByRole("textbox", { name: "所在城市", exact: true })
    .fill("不该恢复");
  await other.getByRole("checkbox").check();
  await other.getByRole("button", { name: "确认授权并提交资料" }).click();
  await page.getByRole("button", { name: "撤回授权", exact: true }).click();
  await page.getByRole("button", { name: "确认撤回授权" }).click();
  await expect(
    agency.getByRole("region", { name: "填报详情" }),
  ).not.toContainText("演示用户");
  await expect(agency.locator(".tongzhou-record")).toHaveCount(0);
  await expect(
    other.getByRole("heading", { name: "授权已撤回", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(2800);
  expect((await saved(page)).tongzhouSubmissions[0].status).toBe("withdrawn");
  expect((await saved(page)).tongzhouSubmissions[0].fields!.city).toBe(
    "演示新城",
  );
  await page.getByRole("button", { name: "重新授权并提交" }).click();
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await submit(page);
  await expect(agency.locator(".tongzhou-record")).toHaveCount(1);
  await expect(
    agency.getByRole("region", { name: "填报详情" }),
  ).not.toContainText("演示用户");
  await agency.locator(".tongzhou-record").click();
  await page.getByRole("button", { name: "删除填报资料", exact: true }).click();
  await page.getByRole("button", { name: "确认删除资料" }).click();
  await expect(
    page.getByRole("heading", { name: "填报资料已删除" }),
  ).toBeVisible();
  await expect(agency.locator(".tongzhou-details")).toHaveCount(0);
  const result = await saved(page);
  expect(result.tongzhouSubmissions[0].fields).toBeNull();
  expect(JSON.stringify(result)).not.toContain("13800000000");
  await page.getByRole("button", { name: "重新填写资料" }).click();
  await expect(
    page.getByRole("combobox", { name: "民族", exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByRole("textbox", { name: "真实姓名", exact: true }),
  ).toHaveValue("");
});

test("leaving, changing actor and resetting cancel delayed private submissions", async ({
  page,
}) => {
  await scenario(page);
  await form(page);
  await example(page);
  await page.evaluate(() => sessionStorage.setItem("destinylab:delay", "2500"));
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "确认授权并提交资料" }).click();
  await page.getByRole("link", { name: "返回现场", exact: true }).click();
  await expect(page).toHaveURL(/05-discover/);
  await page.waitForTimeout(2800);
  expect((await saved(page)).tongzhouSubmissions).toHaveLength(0);
  await form(page);
  await example(page);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "确认授权并提交资料" }).click();
  await form(page, "p-xiaoman");
  await page.waitForTimeout(2800);
  expect((await saved(page)).tongzhouSubmissions).toHaveLength(0);
  await expect(
    page.getByRole("textbox", { name: "真实姓名", exact: true }),
  ).toHaveValue("");
  await example(page);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "确认授权并提交资料" }).click();
  await scenario(page, "confirmed");
  await page.waitForTimeout(2800);
  expect((await saved(page)).tongzhouSubmissions).toHaveLength(0);
});

test("storage failure preserves editable input and retry; unreadable data hides stale private details without resetting storage", async ({
  page,
  context,
}) => {
  await scenario(page);
  await form(page);
  await example(page);
  const before = await page.evaluate((key) => localStorage.getItem(key), KEY);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "destinylab:v1.1:state") {
        Storage.prototype.setItem = original;
        throw new DOMException("Test quota", "QuotaExceededError");
      }
      return original.call(this, key, value);
    };
  });
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "确认授权并提交资料" }).click();
  await expect(page.locator(".tongzhou-form").getByRole("alert")).toContainText(
    "无法保存演示状态",
  );
  await expect(
    page.getByRole("textbox", { name: "真实姓名", exact: true }),
  ).toHaveValue("演示用户");
  expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe(
    before,
  );
  await submit(page);
  const agency = await context.newPage();
  await agency.goto("/agency/tongzhou");
  await agency.locator(".tongzhou-record").click();
  const valid = await page.evaluate((key) => localStorage.getItem(key)!, KEY);
  await page.evaluate(
    (key) => localStorage.setItem(key, "corrupt-test-snapshot"),
    KEY,
  );
  await expect(agency.locator(".tongzhou-details")).toHaveCount(0);
  await expect(agency.locator(".notice-error")).toContainText("无法读取");
  expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe(
    "corrupt-test-snapshot",
  );
  await page.evaluate(({ key, valid }) => localStorage.setItem(key, valid), {
    key: KEY,
    valid,
  });
  await expect(agency.locator(".tongzhou-record")).toHaveCount(1);
  await expect(agency.locator(".tongzhou-details")).toHaveCount(0);
  const other = await context.newPage();
  await form(other, "p-xiaoman");
  await expect(
    other.getByRole("textbox", { name: "真实姓名", exact: true }),
  ).toHaveValue("");
  await expect(other.getByRole("checkbox")).not.toBeChecked();
});

test("M05 empty and M10 entries return to the existing journey without modifying tasks", async ({
  page,
}) => {
  for (const [scene, route] of [
    ["zero", "05-discover"],
    ["confirmed", "10-next-step"],
  ]) {
    await scenario(page, scene);
    const before = await saved(page);
    await page.goto(`/mobile/${route}?actor=p-shanfeng`);
    await page
      .getByRole("link", { name: "填写资料，申请同舟婚恋联系" })
      .click();
    await expect(page).toHaveURL(/mobile\/tongzhou/);
    await page.getByRole("link", { name: "返回现场探索 / 当前任务" }).click();
    await expect(page).toHaveURL(new RegExp(route));
    const after = await saved(page);
    expect(after.participants).toEqual(before.participants);
    expect(after.invitations).toEqual(before.invitations);
  }
});

test("older snapshot remains intact and public pages never render submission values", async ({
  page,
  context,
}) => {
  await scenario(page);
  const before = await saved(page);
  await page.evaluate((key) => {
    const s = JSON.parse(localStorage.getItem(key)!);
    delete s.tongzhouSubmissions;
    localStorage.setItem(key, JSON.stringify(s));
  }, KEY);
  await form(page);
  await example(page);
  await page
    .getByRole("textbox", { name: "真实姓名", exact: true })
    .fill("私密示例姓名");
  await submit(page);
  const after = await saved(page);
  expect(after.epoch).toBe(before.epoch);
  expect(after.participants).toEqual(before.participants);
  for (const route of [
    "/screen/question",
    "/screen/presence",
    "/screen/real-meet",
    "/mobile/05-discover?actor=p-xiaoman",
    "/admin/participants",
  ]) {
    const publicPage = await context.newPage();
    await publicPage.goto(route);
    await expect(publicPage.locator(".loading")).toHaveCount(0);
    const text = await publicPage.locator("body").innerText();
    for (const secret of ["私密示例姓名", "13800000000", "回族"])
      expect(text).not.toContain(secret);
    await publicPage.close();
  }
});

for (const reducedMotion of ["no-preference", "reduce"] as const)
  test(`form widths and keyboard feedback · ${reducedMotion}`, async ({
    page,
    context,
  }) => {
    await page.emulateMedia({ reducedMotion });
    await scenario(page);
    await form(page);
    await example(page);
    await mkdir(evidence, { recursive: true });
    for (const width of [320, 360, 390, 393, 430]) {
      await page.setViewportSize({ width, height: 844 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await expect(
        page.getByRole("combobox", { name: "民族", exact: true }),
      ).toBeVisible();
      const controls = await page
        .locator(".tongzhou-fields input, .tongzhou-fields select")
        .evaluateAll((els) =>
          els
            .filter((el) => el.getBoundingClientRect().height > 0)
            .map((el) => {
              const r = el.getBoundingClientRect();
              return { left: r.left, right: r.right, height: r.height };
            }),
        );
      for (const control of controls) {
        expect(control.left).toBeGreaterThanOrEqual(0);
        expect(control.right).toBeLessThanOrEqual(width);
        expect(control.height).toBeGreaterThanOrEqual(44);
      }
      if (reducedMotion === "no-preference")
        await page.screenshot({
          path: `${evidence}/form-${width}.png`,
          fullPage: true,
        });
    }
    await page.locator("summary").click();
    await page.getByLabel("身高（cm）", { exact: true }).fill("999");
    await page.locator("summary").click();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "确认授权并提交资料" }).click();
    await expect(page.getByLabel("身高（cm）", { exact: true })).toBeFocused();
    await expect(page.getByText("请填写 80–250 cm 之间的身高")).toBeVisible();
    await page.getByLabel("身高（cm）", { exact: true }).fill("168");
    await submit(page);
    const agency = await context.newPage();
    await agency.goto("/agency/tongzhou");
    await agency.locator(".tongzhou-record").click();
    if (reducedMotion === "no-preference") {
      await page.screenshot({
        path: `${evidence}/receipt.png`,
        fullPage: true,
      });
      await agency.screenshot({
        path: `${evidence}/agency.png`,
        fullPage: true,
      });
    }
  });
