import { test, expect, type Page, type Route } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PNG } from "pngjs";
import type { DemoState } from "../../src/domain/types";
import type { LiveSnapshot } from "../../src/lib/api/live-types";

const origin = "http://127.0.0.1:3240";
const commandURL = "**/api/live/command?**";
let activity: string;
let pool: Pool;
let pageErrors: string[];
const api = (path: string) =>
  `/api/live/${path}?activity=${activity}&audience=participant`;
const form = (page: Page) => page.locator(".profile-form");
const submit = (page: Page) =>
  form(page).getByRole("button", { name: "继续答题" });
const avatar = (page: Page) => form(page).locator(":scope > .avatar-selector");
const read = async (page: Page): Promise<LiveSnapshot> => {
  const response = await page.request.get(api("snapshot"));
  expect(response.status()).toBe(200);
  return response.json();
};
const raw = async (): Promise<DemoState> =>
  (await pool.query("SELECT state FROM dl_activities WHERE id=$1", [activity]))
    .rows[0].state;
const profileCount = async () =>
  Number(
    (
      await pool.query(
        "SELECT count(*) FROM dl_commands WHERE activity_id=$1",
        [activity],
      )
    ).rows[0].count,
  );

test.beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
});
test.afterAll(async () => {
  await pool.end();
});
test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});
test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  activity = `profile-test-${randomUUID().slice(0, 8)}`;
  const now = Date.now();
  const state: DemoState = {
    schema: 1,
    epoch: randomUUID(),
    revision: 0,
    now,
    wallAt: now,
    scenario: "live",
    activityPaused: false,
    participants: [],
    invitations: [],
    points: [],
    helps: [],
    merchants: [],
    events: [],
    scans: [],
    responses: {},
    merchantViews: [],
    commands: [],
    broadcastConsumed: [],
    tongzhouSubmissions: [],
    displayQuestionId: "q1",
    displayGrants: {},
  };
  await pool.query("INSERT INTO dl_activities(id,state) VALUES($1,$2)", [
    activity,
    JSON.stringify(state),
  ]);
  const joined = await page.request.post(api("session"), {
    headers: { Origin: origin },
    data: { enter: true },
  });
  expect(joined.status()).toBe(200);
  const snapshot = await read(page);
  const answered = await page.request.post(api("command"), {
    headers: { Origin: origin, "Idempotency-Key": randomUUID() },
    data: {
      epoch: snapshot.state!.epoch,
      command: { type: "answer", questionId: "q1", value: "一起逛逛" },
    },
  });
  expect(answered.status()).toBe(200);
  await page.goto(`/mobile/03-profile?activity=${activity}`);
  await expect(form(page)).toBeVisible();
});

async function fill(page: Page) {
  await page.getByLabel("怎么称呼你？").fill("测试清禾");
  await page.getByRole("button", { name: "26–29", exact: true }).click();
  await avatar(page).getByRole("radio", { name: "男生虚拟头像 03" }).check();
}
async function editor(page: Page) {
  await form(page)
    .getByRole("button", { name: /上传我的照片|更换头像/ })
    .click();
  return page.getByRole("dialog", { name: "选择你的头像" });
}
async function finish(page: Page, expectedAvatar = "male_03") {
  await submit(page).click();
  await expect(page).toHaveURL(/04-question/);
  const snapshot = await read(page);
  const me = snapshot.state!.participants.find((p) => p.id === snapshot.actor)!;
  expect(me.avatarId).toBe(expectedAvatar);
  expect(me.name).toBe("测试清禾");
  expect(me.ready).toBe(false);
  expect(me.answers).toEqual({ q1: "一起逛逛" });
  return me;
}

for (const width of [320, 390, 430]) {
  test(`missing fields focus and explain before saving; touch and keyboard at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const before = await raw();
    const calls: unknown[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/live/command"))
        calls.push(request.postDataJSON());
    });
    await submit(page).tap();
    await expect(page.getByLabel("怎么称呼你？")).toBeFocused();
    await expect(form(page).getByRole("alert")).toContainText(
      "填写合格昵称、选择年龄段、选择头像",
    );
    await page.getByLabel("怎么称呼你？").fill("ABC");
    await submit(page).click();
    await expect(page.getByLabel("怎么称呼你？")).toBeFocused();
    await page.getByLabel("怎么称呼你？").fill("测试清禾");
    await submit(page).click();
    await expect(page.getByRole("group", { name: "你的年龄段" })).toBeFocused();
    await expect(page.locator("#profile-age-error")).toHaveText(
      "请选择你的年龄段。",
    );
    await page.getByRole("button", { name: "26–29", exact: true }).tap();
    await submit(page).tap();
    await expect(avatar(page)).toBeFocused();
    await expect(avatar(page)).toBeInViewport();
    await expect(form(page).getByRole("alert")).toHaveText(
      "还需选择头像，请完成后继续。",
    );
    await page.screenshot({
      path: `docs/verification/2026-10-26-profile/M03-${width}-missing.png`,
      fullPage: true,
    });
    expect(calls).toHaveLength(0);
    expect(await raw()).toEqual(before);
    await avatar(page).getByRole("radio", { name: "男生虚拟头像 03" }).focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowRight");
    await expect(
      avatar(page).getByRole("radio", { name: "男生虚拟头像 04" }),
    ).toBeChecked();
    await page.getByRole("button", { name: "女生", exact: true }).tap();
    await expect(avatar(page).locator("input:checked")).toHaveCount(0);
    await expect(avatar(page).locator(".field-error")).toContainText(
      "女生头像",
    );
    await avatar(page).getByRole("radio", { name: "女生虚拟头像 04" }).check();
    await expect(form(page).getByRole("alert")).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `docs/verification/2026-10-26-profile/M03-${width}-ready.png`,
      fullPage: true,
    });
    const me = await finish(page, "female_04");
    expect(calls).toHaveLength(1);
    expect(me.id).toBe(before.participants[0].id);
    expect((await raw()).scans).toEqual(before.scans);
  });
}

for (const failure of ["server", "rejected", "network", "timeout"] as const) {
  test(`${failure}: draft and retry survive; busy blocks duplicates and success saves once`, async ({
    page,
  }) => {
    await fill(page);
    const count = await profileCount();
    const ids: string[] = [];
    let held: Route | undefined;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let first = true;
    await page.route(commandURL, async (route) => {
      ids.push(route.request().headers()["idempotency-key"]);
      if (!first) return route.continue();
      first = false;
      held = route;
      // For timeout, the server has committed but its response is lost.
      const response = failure === "timeout" ? await route.fetch() : undefined;
      await gate;
      if (failure === "server" || failure === "rejected")
        await route.fulfill({
          status: failure === "server" ? 503 : 409,
          json: { error: "测试服务暂不可用，请稍后重试。" },
        });
      else if (failure === "network") await route.abort("failed");
      else await route.fulfill({ response }).catch(() => {});
    });
    await submit(page).click();
    await expect(
      form(page).getByRole("button", { name: "正在保存…" }),
    ).toBeDisabled();
    await expect(
      form(page).getByRole("button", { name: "上传我的照片" }),
    ).toBeDisabled();
    await form(page).evaluate((el: HTMLFormElement) => {
      el.requestSubmit();
      el.requestSubmit();
    });
    await expect.poll(() => !!held).toBe(true);
    expect(ids).toHaveLength(1);
    if (failure !== "timeout") release();
    await expect(form(page).getByRole("alert")).toContainText("保存未完成", {
      timeout: 15000,
    });
    release();
    if (failure === "network" || failure === "timeout")
      await expect(form(page).getByRole("alert")).toContainText(
        "网络连接中断或等待超时",
      );
    await expect(page.getByLabel("怎么称呼你？")).toHaveValue("测试清禾");
    await expect(
      avatar(page).getByRole("radio", { name: "男生虚拟头像 03" }),
    ).toBeChecked();
    await expect(submit(page)).toBeEnabled();
    await expect(form(page).getByRole("alert")).toBeInViewport();
    await finish(page);
    expect(ids).toHaveLength(2);
    if (failure === "rejected") expect(ids[1]).not.toBe(ids[0]);
    else expect(ids[1]).toBe(ids[0]);
    expect(await profileCount()).toBe(count + 1);
  });
}

test("editor system choice, cancellation, photo upload/removal preserve the profile draft and saved avatar", async ({
  page,
}) => {
  await fill(page);
  let dialog = await editor(page);
  await dialog.locator("summary").click();
  await dialog.getByRole("radio", { name: "男生虚拟头像 07" }).check();
  await expect(
    avatar(page).getByRole("radio", { name: "男生虚拟头像 03" }),
  ).toBeChecked();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(
    avatar(page).getByRole("radio", { name: "男生虚拟头像 03" }),
  ).toBeChecked();
  dialog = await editor(page);
  await dialog.locator("summary").click();
  await dialog.getByRole("radio", { name: "男生虚拟头像 07" }).check();
  await dialog.getByRole("button", { name: "确认使用" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    avatar(page).getByRole("radio", { name: "男生虚拟头像 07" }),
  ).toBeChecked();
  await expect(page.getByLabel("怎么称呼你？")).toHaveValue("测试清禾");
  dialog = await editor(page);
  const png = new PNG({ width: 64, height: 64 });
  png.data.fill(190);
  for (let i = 3; i < png.data.length; i += 4) png.data[i] = 255;
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "synthetic.png",
    mimeType: "image/png",
    buffer: PNG.sync.write(png),
  });
  await expect(
    dialog.getByRole("img", { name: "拖动照片调整圆形头像" }),
  ).toBeVisible();
  await expect(dialog.getByRole("checkbox")).not.toBeChecked();
  await dialog.getByRole("button", { name: "确认使用" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(form(page).locator(".person-card .avatar-photo")).toBeVisible();
  const snapshot = await read(page);
  expect(snapshot.state!.participants[0].photo?.screen).toBe(false);
  expect(snapshot.state!.participants[0].avatarId).toBe("male_07");
  const photo = snapshot.state!.participants[0].photo;
  expect((await finish(page, "male_07")).photo).toEqual(photo);
  await page.goto(`/mobile/03-profile?activity=${activity}`);
  dialog = await editor(page);
  await dialog.getByRole("button", { name: "移除照片，换回系统头像" }).click();
  await dialog.locator("summary").click();
  await dialog.getByRole("radio", { name: "男生虚拟头像 08" }).check();
  await dialog.getByRole("button", { name: "确认使用" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    avatar(page).getByRole("radio", { name: "男生虚拟头像 08" }),
  ).toBeChecked();
  expect((await finish(page, "male_08")).photo).toBeNull();
  // Re-editing a complete profile has one editor that synchronizes the draft.
  await page.goto(`/mobile/03-profile?activity=${activity}`);
  await expect(page.getByRole("button", { name: "更换头像" })).toHaveCount(1);
  dialog = await editor(page);
  await dialog.locator("summary").click();
  await dialog.getByRole("radio", { name: "男生虚拟头像 09" }).check();
  await dialog.getByRole("button", { name: "确认使用" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    avatar(page).getByRole("radio", { name: "男生虚拟头像 09" }),
  ).toBeChecked();
  await finish(page, "male_09");
});

test("editor result cannot silently undo an unsaved gender choice", async ({
  page,
}) => {
  await fill(page);
  await page.getByRole("button", { name: "女生", exact: true }).click();
  const dialog = await editor(page);
  await dialog.locator("summary").click();
  await dialog.getByRole("radio", { name: "男生虚拟头像 07" }).check();
  await dialog.getByRole("button", { name: "确认使用" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "女生", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(avatar(page).locator(".field-error")).toContainText(
    "性别已更改",
  );
  await expect(avatar(page).locator("input:checked")).toHaveCount(0);
  await avatar(page).getByRole("radio", { name: "女生虚拟头像 04" }).check();
  await finish(page, "female_04");
});

test("composition input does not submit or steal focus", async ({ page }) => {
  await fill(page);
  const name = page.getByLabel("怎么称呼你？");
  const count = await profileCount();
  await name.focus();
  await name.dispatchEvent("compositionstart");
  await form(page).evaluate((el: HTMLFormElement) => el.requestSubmit());
  await expect(name).toBeFocused();
  await expect(form(page).getByRole("alert")).toHaveCount(0);
  expect(await profileCount()).toBe(count);
  await name.dispatchEvent("compositionend");
  await finish(page);
});

for (const change of ["path", "epoch", "identity"] as const) {
  test(`late success after ${change} change cannot navigate or overwrite the new page`, async ({
    page,
  }) => {
    await fill(page);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let saved = false;
    let delivered = false;
    await page.route(commandURL, async (route) => {
      const response = await route.fetch();
      saved = true;
      await gate;
      await route.fulfill({ response }).catch(() => {});
      delivered = true;
    });
    await submit(page).click();
    await expect.poll(() => saved).toBe(true);
    if (change === "path") {
      await page.getByRole("button", { name: "返回", exact: true }).click();
      await expect(page).toHaveURL(/02-result/);
    } else {
      const state = await raw();
      state.revision += 1;
      if (change === "epoch") state.epoch = randomUUID();
      else {
        state.participants[0].id = randomUUID();
        await pool.query(
          "UPDATE dl_sessions SET actor=$2 WHERE activity_id=$1 AND role='participant'",
          [activity, state.participants[0].id],
        );
      }
      state.participants[0].name = "新身份";
      state.participants[0].profileComplete = false;
      state.participants[0].avatarId = null;
      await pool.query(
        "UPDATE dl_activities SET state=$2,revision=$3 WHERE id=$1",
        [activity, JSON.stringify(state), state.revision],
      );
      await expect(page.getByLabel("怎么称呼你？")).toHaveValue("新身份");
    }
    release();
    await expect.poll(() => delivered).toBe(true);
    await expect(page).toHaveURL(
      new RegExp(change === "path" ? "02-result" : "03-profile"),
    );
    if (change !== "path") {
      await expect(page.getByLabel("怎么称呼你？")).toHaveValue("新身份");
      await expect(avatar(page).locator("input:checked")).toHaveCount(0);
    }
  });
}
