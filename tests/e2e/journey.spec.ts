import { test, expect, type Page } from "@playwright/test";
import jsQR from "jsqr";
import { PNG } from "pngjs";
async function scenario(page: Page, name: string) {
  await page.goto("/demo");
  await page.getByTestId(`scenario-${name}`).click();
  await page.getByRole("button", { name: "确认载入", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".demo-status")).toContainText("真实相遇");
}
async function actorPage(page: Page, actor: string, route: string) {
  await page.goto(
    `/mobile/${route}${route.includes("?") ? "&" : "?"}actor=${actor}`,
  );
  await expect(page.locator(".mobile-shell")).toBeVisible();
}
async function saved(page: Page) {
  return page.evaluate(() =>
    JSON.parse(localStorage.getItem("destinylab:v1.1:state") || "{}"),
  );
}
test("complete first-time two-person story, persistent 28→29, operator and public screen agree", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await scenario(page, "fresh");
  await page.setViewportSize({ width: 390, height: 844 });
  await actorPage(page, "p-shanfeng", "01-start");
  const cta = page.getByRole("button", { name: "开始今天的遇见" });
  const box = await cta.boundingBox();
  expect(box!.y + box!.height).toBeLessThan(844);
  await cta.click();
  await expect(page).toHaveURL(/02-result/);
  await expect(page.locator(".donut")).toContainText("42");
  await page.getByRole("button", { name: "看看现场还有谁和我一样" }).click();
  await expect(page).toHaveURL(/03-profile/);
  await page.getByLabel("怎么称呼你？").fill("山风");
  await page.getByRole("button", { name: "可以，现在就能见面" }).click();
  await page.getByRole("button", { name: "继续答题" }).click();
  for (const [index, answer] of [
    "热闹街区",
    "旅行与城市",
    "慢慢靠近",
    "出去走走",
    "聊得来",
  ].entries()) {
    await page.getByRole("button", { name: answer, exact: true }).click();
    await page
      .getByRole("button", {
        name: index === 4 ? "看看现场同频的人" : "下一题",
        exact: true,
      })
      .click();
  }
  await expect(page).toHaveURL(/05-discover/);
  await expect(page.locator(".recommend-card")).toHaveCount(3);
  await page
    .locator(".recommend-card")
    .filter({ hasText: "小满" })
    .getByRole("button", { name: "看看共同答案" })
    .click();
  await expect(page.locator(".common-heading")).toContainText("4");
  await page.getByRole("button", { name: "想认识 TA" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "发出邀请", exact: true })
    .click();
  await expect(page).toHaveURL(/07-invitation/);
  await expect(
    page.getByRole("heading", { name: "等待 小满 回应" }),
  ).toBeVisible();
  const receiver = await context.newPage();
  await receiver.setViewportSize({ width: 390, height: 844 });
  await actorPage(receiver, "p-xiaoman", "07-invitation");
  await expect(receiver.locator(".person-card")).toContainText("山风");
  await receiver.getByRole("button", { name: "我也愿意认识" }).click();
  await expect(receiver).toHaveURL(/08-mutual/);
  await expect(
    page.getByText("你们都愿意认识彼此。", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "查看相遇任务" }).click();
  await expect(page).toHaveURL(/08-mutual/);
  for (const p of [page, receiver]) {
    await p.getByRole("button", { name: "查看相遇任务" }).click();
    await expect(p).toHaveURL(/09-meet/);
    await expect(p.locator(".verification-code")).toContainText("4721");
  }
  await Promise.all(
    [page, receiver].map((p) =>
      p.getByRole("button", { name: "确认出发", exact: true }).click(),
    ),
  );
  for (const p of [page, receiver])
    await expect(
      p.getByRole("button", { name: "我已经到了", exact: true }),
    ).toBeEnabled();
  await Promise.all(
    [page, receiver].map((p) =>
      p.getByRole("button", { name: "我已经到了", exact: true }).click(),
    ),
  );
  for (const p of [page, receiver])
    await expect(
      p.getByRole("button", { name: "我已经见到 TA", exact: true }),
    ).toBeEnabled();
  const admin = await context.newPage();
  await admin.goto("/admin/dashboard");
  const screen = await context.newPage();
  await screen.goto("/screen/real-meet");
  await page
    .getByRole("button", { name: "我已经见到 TA", exact: true })
    .click();
  await expect(admin.getByTestId("real-count")).toHaveText("28");
  await expect(screen.getByTestId("screen-real-count")).toHaveText("28");
  await receiver
    .getByRole("button", { name: "我已经见到 TA", exact: true })
    .click();
  await expect(page).toHaveURL(/10-next-step/);
  await expect(receiver).toHaveURL(/10-next-step/);
  await expect(admin.getByTestId("real-count")).toHaveText("29");
  await expect(screen.getByTestId("screen-real-count")).toHaveText("29");
  await page.getByRole("button", { name: /就到这里，也很好/ }).click();
  await expect(
    page.getByText("已保存你的选择。是否一起继续，请与对方面对面商量。"),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: /就到这里，也很好/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /核销|授权/ })).toHaveCount(0);
  const state = await saved(page);
  expect(
    state.invitations.filter((i: { realMeetAt?: number }) => i.realMeetAt),
  ).toHaveLength(29);
  expect(errors).toEqual([]);
});
test("nickname boundaries and Chinese composition, answer backtracking and refresh restoration", async ({
  page,
}) => {
  await scenario(page, "fresh");
  await actorPage(page, "p-shanfeng", "01-start");
  await page.getByRole("button", { name: "开始今天的遇见" }).click();
  await page.getByRole("button", { name: "看看现场还有谁和我一样" }).click();
  const input = page.getByLabel("怎么称呼你？");
  await input.fill("山风123");
  await expect(page.locator("#nickname-error")).toHaveText(
    "昵称请只使用汉字。",
  );
  await input.fill("一二三四五六");
  await expect(page.locator("#nickname-error")).toHaveText(
    "昵称最多 5 个汉字，请缩短一点。",
  );
  await input.fill("山风");
  await input.dispatchEvent("compositionstart");
  await input.fill("shan");
  await expect(page.locator("#nickname-error")).toBeEmpty();
  await input.fill("山风");
  await input.dispatchEvent("compositionend");
  await expect(page.locator("#nickname-error")).toBeEmpty();
  await page.getByRole("button", { name: "继续答题" }).click();
  await page.getByRole("button", { name: "安静咖啡馆", exact: true }).click();
  await page.getByRole("button", { name: "下一题", exact: true }).click();
  await page.getByRole("button", { name: "返回上一题" }).click();
  await expect(
    page.getByRole("button", { name: "安静咖啡馆", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(page.locator(".question-progress")).toContainText("03");
});
test("rejection and expiration are neutral, and browser back does not accept an invitation", async ({
  page,
  context,
}) => {
  await scenario(page, "waiting");
  const receiver = await context.newPage();
  await actorPage(receiver, "p-xiaoman", "07-invitation");
  await receiver
    .getByRole("button", { name: "暂时不见面", exact: true })
    .click();
  await expect(receiver.getByText(/本次邀请已结束。每个人/)).toBeVisible();
  await actorPage(page, "p-shanfeng", "07-invitation");
  await expect(page.getByText(/本次邀请已结束。每个人/)).toBeVisible();
  await page.getByRole("button", { name: "继续探索", exact: true }).click();
  await expect(page).toHaveURL(/05-discover/);
  await scenario(page, "waiting");
  await page.getByRole("button", { name: "时间前进 16 分钟" }).click();
  await actorPage(receiver, "p-xiaoman", "07-invitation");
  await expect(receiver.getByText(/邀请已过期。每个人/)).toBeVisible();
});
test("same-origin storage synchronizes help and point allocation, not isolated browser contexts", async ({
  page,
  context,
  browser,
}) => {
  await scenario(page, "help");
  const mobile = await context.newPage();
  await actorPage(mobile, "p-shanfeng", "09-meet");
  await expect(
    mobile.getByText("帮助请求已送达，等待工作人员接单。"),
  ).toBeVisible();
  await page.goto("/admin/dashboard");
  await page.getByRole("button", { name: /山风需要工作人员帮助/ }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "接单处理" })
    .click();
  await expect(
    mobile.getByText("工作人员已接单，请在相遇点附近稍候。"),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "标记已处理" })
    .click();
  await expect(
    mobile.getByText("本次帮助已处理。如仍有需要，可以再次求助。"),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭弹窗" }).click();
  await scenario(page, "busy");
  await actorPage(mobile, "p-shanfeng", "08-mutual");
  await expect(
    mobile.getByRole("heading", { name: "正在等候相遇点" }),
  ).toBeVisible();
  await page.goto("/admin/dashboard");
  await page
    .getByRole("button", { name: "确认空闲", exact: true })
    .first()
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认操作" })
    .click();
  await expect(
    mobile.getByRole("button", { name: "查看相遇任务" }),
  ).toBeVisible();
  const isolated = await browser.newContext();
  const isolatedPage = await isolated.newPage();
  await isolatedPage.goto("http://localhost:3210/demo");
  await expect(isolatedPage.locator(".demo-status")).toContainText("从头体验");
  await isolated.close();
});
test("failed request is retryable and delayed writes cannot revive a reset scenario", async ({
  page,
  context,
}) => {
  await scenario(page, "discover");
  await page.getByRole("button", { name: "下一次请求失败" }).click();
  await page.getByRole("link", { name: "本标签继续山风体验" }).click();
  await page
    .locator(".recommend-card")
    .filter({ hasText: "小满" })
    .getByRole("button")
    .click();
  await page.getByRole("button", { name: "想认识 TA" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "发出邀请", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByText("模拟连接中断，本次操作未提交，请重试。"),
  ).toBeVisible();
  expect(
    (await saved(page)).invitations.filter(
      (i: { status: string }) => i.status === "SENT",
    ),
  ).toHaveLength(0);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "发出邀请", exact: true })
    .click();
  await expect(page).toHaveURL(/07-invitation/);
  await scenario(page, "discover");
  await page.getByRole("button", { name: "模拟慢连接" }).click();
  await page.getByRole("link", { name: "本标签继续山风体验" }).click();
  await page
    .locator(".recommend-card")
    .filter({ hasText: "小满" })
    .getByRole("button")
    .click();
  await page.getByRole("button", { name: "想认识 TA" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "发出邀请", exact: true })
    .click();
  const hub = await context.newPage();
  await scenario(hub, "zero");
  await page.waitForTimeout(3000);
  const s = await saved(hub);
  expect(s.scenario).toBe("zero");
  expect(
    s.invitations.filter((i: { status: string }) => i.status === "SENT"),
  ).toHaveLength(0);
});
test("partner controls affect mobile, while redemption and service authorization stay out of MVP", async ({
  page,
  context,
}) => {
  await scenario(page, "confirmed");
  const mobile = await context.newPage();
  await actorPage(mobile, "p-shanfeng", "10-next-step");
  await page.goto("/admin/partners");
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /核销|授权/ })).toHaveCount(0);
  await page
    .locator(".partner-detail")
    .filter({ hasText: "云影咖啡" })
    .getByRole("button", { name: "暂停推荐" })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认操作" })
    .click();
  await expect(
    mobile.getByRole("button", { name: /去云影咖啡/ }),
  ).toBeDisabled();
  await mobile.getByRole("button", { name: /一起走走/ }).click();
  await expect(
    mobile.getByRole("button", { name: /一起走走/ }),
  ).toHaveAttribute("aria-pressed", "true");
  expect((await saved(page)).consents).toBeUndefined();
});
test("screen QR decodes to configured entry, remains visible and low activity does not insert identities", async ({
  page,
}) => {
  await scenario(page, "mutual");
  await page.goto("/screen");
  const qr = page.getByRole("img", { name: "扫码进入缘分实验室" });
  await expect(qr).toBeVisible();
  const src = await qr.getAttribute("src");
  const png = PNG.sync.read(Buffer.from(src!.split(",")[1], "base64"));
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  expect(decoded?.data).toBe("http://localhost:3210/mobile/01-start");
  await page.waitForTimeout(12500);
  await expect(
    page.getByRole("heading", { name: "人正在鼓楼探索" }),
  ).toBeVisible();
  await expect(qr).toBeVisible();
  for (const forbidden of ["山风", "小满", "4721", "Meet01"])
    await expect(page.locator(".screen-canvas")).not.toContainText(forbidden);
});
test("three independent pairs produce a single anonymous insertion and no repeat", async ({
  page,
}) => {
  await scenario(page, "broadcast");
  await page.goto("/screen");
  await page.waitForTimeout(13000);
  await expect(page.locator(".screen-mutual")).toBeVisible();
  await expect(
    page.getByRole("img", { name: "扫码进入缘分实验室" }),
  ).toBeVisible();
  await page.waitForTimeout(6500);
  await expect(page.locator(".screen-mutual")).toHaveCount(0);
  expect((await saved(page)).broadcastConsumed).toHaveLength(3);
});
test("phone widths, keyboard modal, and screen safe canvas have no critical overflow", async ({
  page,
}) => {
  await scenario(page, "discover");
  for (const width of [320, 360, 390, 393, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await actorPage(page, "p-shanfeng", "05-discover");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(page.locator(".recommend-card")).toHaveCount(3);
  }
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto("/admin/dashboard");
  await page.getByRole("button", { name: "暂停新邀请" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  for (const size of [
    { width: 1920, height: 1080 },
    { width: 3840, height: 2160 },
  ]) {
    await page.setViewportSize(size);
    await page.goto("/screen/real-meet");
    const b = await page.getByTestId("screen-canvas").boundingBox();
    expect(Math.abs(b!.width / b!.height - 16 / 9)).toBeLessThan(0.01);
    await expect(
      page.getByRole("img", { name: "扫码进入缘分实验室" }),
    ).toBeVisible();
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page.evaluate(
      () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    ),
  ).toBe(true);
});

test("corrupt saved state has a visible recovery path without silently overwriting the stored snapshot", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await scenario(page, "discover");
  const bad = JSON.stringify({
    schema: 1,
    epoch: "broken",
    participants: [],
    commands: [],
  });
  await page.evaluate(
    (value) => localStorage.setItem("destinylab:v1.1:state", value),
    bad,
  );
  await page.reload();
  await expect(
    page.getByText("保存的演示状态无法读取，请在演示入口重置。"),
  ).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("destinylab:v1.1:state")),
  ).toBe(bad);
  await scenario(page, "fresh");
  await expect(
    page.getByText("保存的演示状态无法读取，请在演示入口重置。"),
  ).toHaveCount(0);
  expect((await saved(page)).scenario).toBe("fresh");
  expect(errors).toEqual([]);
});
test("all four screen states render decodable QR pixels and readable panel text", async ({
  page,
}) => {
  await scenario(page, "broadcast");
  await page.setViewportSize({ width: 1920, height: 1080 });
  for (const mode of ["question", "presence", "mutual", "real-meet"]) {
    await page.goto(`/screen/${mode}`);
    const qr = page.getByRole("img", { name: "扫码进入缘分实验室" });
    await expect(qr).toBeVisible();
    await qr.evaluate((img) => (img as HTMLImageElement).decode());
    const png = PNG.sync.read(await qr.screenshot());
    const decoded = jsQR(
      new Uint8ClampedArray(png.data),
      png.width,
      png.height,
    );
    expect(decoded?.data, mode).toBe("http://localhost:3210/mobile/01-start");
    expect(
      await page
        .locator(".screen-qr h2")
        .evaluate((el) => getComputedStyle(el).color),
    ).toBe("rgb(40, 35, 31)");
  }
});

test("recommendation return preserves answers and people while explaining short lists", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [name, count] of [
    ["zero", 0],
    ["one", 1],
    ["two", 2],
    ["discover", 3],
  ] as const) {
    await scenario(page, name);
    await actorPage(page, "p-shanfeng", "05-discover");
    await expect(page.locator(".recommend-card")).toHaveCount(count);
    const shortage = page.getByText(
      "当前推荐已全部展示，暂时没有更多同频的人，可以稍后再来看看。",
    );
    if (count > 0 && count < 3) await expect(shortage).toBeVisible();
    else await expect(shortage).toHaveCount(0);
    if (count === 0) {
      await expect(
        page.getByRole("heading", { name: "现在和你同频的人还不多。" }),
      ).toBeVisible();
      continue;
    }
    const names = await page.locator(".recommend-card h2").allTextContents();
    const before = await saved(page);
    await page.getByRole("button", { name: "看看共同答案" }).first().click();
    await expect(page).toHaveURL(/06-common/);
    await page
      .getByRole("button", { name: "返回推荐列表", exact: true })
      .click();
    await expect(page).toHaveURL(/05-discover$/);
    await expect(page.locator(".recommend-card h2")).toHaveText(names);
    const after = await saved(page);
    expect(after.participants).toEqual(before.participants);
    expect(after.invitations).toEqual(before.invitations);
    expect(await page.evaluate(() => scrollY)).toBe(0);
  }
});

test("blocked invitation explains current task, opens the right route and clears when the old invite ends", async ({
  page,
  context,
}) => {
  await scenario(page, "waiting");
  await actorPage(page, "p-shanfeng", "06-common?target=p-qinghe");
  await expect(page.getByRole("button", { name: "想认识 TA" })).toBeDisabled();
  await expect(page.locator("#invite-unavailable-reason")).toContainText(
    "你发出的邀请正在等待回应",
  );
  const before = await saved(page);
  await page.getByRole("link", { name: "查看当前邀请" }).click();
  await expect(page).toHaveURL(/07-invitation$/);
  expect((await saved(page)).invitations).toEqual(before.invitations);
  await actorPage(page, "p-shanfeng", "06-common?target=p-qinghe");
  const receiver = await context.newPage();
  await actorPage(receiver, "p-xiaoman", "06-common?target=p-004");
  await expect(receiver.locator("#invite-unavailable-reason")).toContainText(
    "你收到了一条待回应的邀请",
  );
  await receiver.getByRole("link", { name: "查看当前邀请" }).click();
  await receiver
    .getByRole("button", { name: "暂时不见面", exact: true })
    .click();
  await expect(page.locator("#invite-unavailable-reason")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "想认识 TA" })).toBeEnabled();
  await receiver.close();
  for (const [scene, label, route] of [
    ["busy", "查看当前相遇", "08-mutual"],
    ["mutual", "查看当前相遇", "08-mutual"],
    ["arrival", "查看当前相遇", "09-meet"],
    ["confirmed", "前往下一站", "10-next-step"],
  ] as const) {
    await scenario(page, scene);
    await actorPage(page, "p-shanfeng", "06-common?target=p-qinghe");
    await expect(
      page.getByRole("button", { name: "想认识 TA" }),
    ).toBeDisabled();
    await expect(page.locator("#invite-unavailable-reason")).toBeVisible();
    await page.getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${route}$`));
  }
  await scenario(page, "paused");
  await actorPage(page, "p-shanfeng", "06-common?target=p-xiaoman");
  await expect(page.locator("#invite-unavailable-reason")).toContainText(
    "现场暂时暂停新邀请",
  );
  await expect(page.getByRole("button", { name: "想认识 TA" })).toBeDisabled();
  await expect(page.locator(".notice-action")).toHaveCount(0);
});
