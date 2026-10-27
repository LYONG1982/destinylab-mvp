import { expect, test, type Page } from "@playwright/test";

test.use({
  viewport: { width: 390, height: 844 },
  reducedMotion: "no-preference",
});
async function scenario(page: Page, name: string) {
  await page.goto("/demo");
  await page.getByTestId(`scenario-${name}`).click();
  await page.getByRole("button", { name: "确认载入", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function mobile(page: Page, route: string, actor = "p-shanfeng") {
  await page.goto(
    `/mobile/${route}${route.includes("?") ? "&" : "?"}actor=${actor}`,
  );
  await expect(page.locator(".mobile-shell")).toBeVisible();
}
async function saved(page: Page) {
  return page.evaluate(() =>
    JSON.parse(localStorage.getItem("destinylab:v1.1:state")!),
  );
}

test("question motion advances saved nodes without losing immediate controls or input", async ({
  page,
}) => {
  await scenario(page, "fresh");
  await mobile(page, "01-start");
  await page.getByRole("button", { name: /一起逛逛/ }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "已加入今晚的答案" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "看看现场还有谁和我一样" }).click();
  await page.getByRole("radio", { name: "男生虚拟头像 03" }).check();
  await page.getByRole("button", { name: "继续答题" }).click();
  await expect(
    page.locator('.destiny-progress li[data-complete="true"]'),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "热闹街区", exact: true }).click();
  await expect(page.locator(".question-progress strong")).toHaveText("03");
  await expect(
    page.locator('.destiny-progress li[data-complete="true"]'),
  ).toHaveCount(2);
  await page.getByRole("button", { name: "返回上一题" }).click();
  await expect(page.locator(".question-progress strong")).toHaveText("02");
  await expect(
    page.getByRole("button", { name: "热闹街区", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".question-outgoing")).toHaveCount(0);
  const state = await saved(page);
  expect(
    state.participants.find((p: { id: string }) => p.id === "p-shanfeng")
      .answers.q3,
  ).toBeUndefined();
});

test("mutual paths actually draw, do not gate the CTA, and replay once per invitation", async ({
  page,
}) => {
  await scenario(page, "mutual");
  const before = (await saved(page)).invitations;
  await mobile(page, "08-mutual");
  await expect(page.getByTestId("mutual-motion")).toHaveAttribute(
    "data-playing",
    "true",
  );
  await expect(
    page.getByRole("button", { name: "我已遇见 TA", exact: true }),
  ).toBeEnabled();
  const samples: number[] = [];
  for (let i = 0; i < 8; i++) {
    samples.push(
      await page
        .locator(".mutual-path")
        .first()
        .evaluate((el) => parseFloat(getComputedStyle(el).strokeDashoffset)),
    );
    await page.waitForTimeout(100);
  }
  expect(
    samples.some((v) => v > 0 && v < 1),
    JSON.stringify(samples),
  ).toBe(true);
  await expect(page.getByTestId("mutual-motion")).toHaveAttribute(
    "data-playing",
    "false",
  );
  await page.reload();
  await expect(page.getByTestId("mutual-motion")).toHaveAttribute(
    "data-playing",
    "false",
  );
  await page.waitForTimeout(250);
  expect(
    await page
      .locator(".mutual-path")
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).strokeDashoffset)),
  ).toBe(0);
  expect((await saved(page)).invitations).toEqual(before);
  await scenario(page, "mutual");
  await mobile(page, "08-mutual");
  await expect(page.getByTestId("mutual-motion")).toHaveAttribute(
    "data-playing",
    "true",
  );
});

test("reduced motion, mid-flight preference change and visibility finish without hidden content", async ({
  page,
}) => {
  await scenario(page, "mutual");
  await mobile(page, "08-mutual");
  await expect(page.getByTestId("mutual-motion")).toHaveAttribute(
    "data-playing",
    "true",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.getByTestId("mutual-motion")).toHaveAttribute(
    "data-playing",
    "false",
  );
  await expect(page.getByText("Meet 01", { exact: true })).toBeVisible();
  await expect(page.getByTestId("own-encounter-code")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.getAnimations().filter((a) => a.playState === "running")
            .length,
      ),
    )
    .toBe(0);
  await page.getByRole("button", { name: "我已遇见 TA", exact: true }).click();
  await expect(page).toHaveURL(/10-next-step/);
  const recorded = (await saved(page)).invitations.find(
    (i: {
      confirmations: Record<string, number>;
      departures: Record<string, number>;
      arrivals: Record<string, number>;
    }) =>
      i.confirmations["p-shanfeng"],
  );
  expect(recorded?.departures).toEqual({});
  expect(recorded?.arrivals).toEqual({});
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await scenario(page, "mutual");
  await mobile(page, "08-mutual");
  await expect(page.getByTestId("mutual-motion")).toHaveAttribute(
    "data-playing",
    "true",
  );
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByTestId("mutual-motion")).toHaveAttribute(
    "data-playing",
    "false",
  );
  await expect(page.locator("html")).toHaveAttribute("data-motion", "false");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByTestId("mutual-motion")).toHaveAttribute(
    "data-playing",
    "false",
  );
});

test("failed send has no success motion; successful send preserves the invitation and can leave immediately", async ({
  page,
}) => {
  await scenario(page, "discover");
  await page.getByRole("button", { name: "下一次请求失败" }).click();
  await mobile(page, "06-common?target=p-xiaoman");
  await expect(page.locator(".match-common-card")).toHaveCount(4);
  await page.getByRole("button", { name: "想认识 TA" }).click();
  await page.getByRole("button", { name: "发出邀请", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("本次操作未提交");
  await expect(page.getByTestId("sent-signal")).toHaveCount(0);
  await page.getByRole("button", { name: "发出邀请", exact: true }).click();
  await expect(page).toHaveURL(/07-invitation/);
  await expect(page.getByTestId("sent-signal")).toBeVisible();
  await page.getByRole("button", { name: "先看看现场" }).click();
  await expect(page).toHaveURL(/05-discover/);
  await expect(page.getByTestId("sent-signal")).toHaveCount(0);
  await page.locator(".task-banner").click();
  await expect(page).toHaveURL(/07-invitation/);
  await expect(page.getByTestId("sent-signal")).toHaveCount(0);
  expect(
    (await saved(page)).invitations.filter(
      (i: { status: string }) => i.status === "SENT",
    ),
  ).toHaveLength(1);
});

test("incoming signal settles at the center, remains SENT and does not replay on refresh", async ({
  page,
}) => {
  await scenario(page, "waiting");
  await mobile(page, "07-invitation", "p-xiaoman");
  await expect(page.getByText("山风想认识你", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "确认认识" }),
  ).toBeEnabled();
  await expect
    .poll(() => page.locator(".signal-arrival circle").getAttribute("cx"))
    .toBe("140");
  const before = (await saved(page)).invitations;
  expect(
    before.find((i: { status: string }) => i.status === "SENT"),
  ).toBeTruthy();
  await page.reload();
  await expect(page.locator(".signal-arrival circle")).toHaveAttribute(
    "cx",
    "140",
  );
  expect((await saved(page)).invitations).toEqual(before);
});

test("a saved first answer updates only actual screen percentages across tabs", async ({
  page,
  context,
}) => {
  await scenario(page, "fresh");
  const screen = await context.newPage();
  await screen.setViewportSize({ width: 1920, height: 1080 });
  await screen.goto("/screen/question");
  await expect(screen.locator("[data-field-id]")).toHaveCount(3);
  await mobile(page, "01-start");
  await page.getByRole("button", { name: /轻松聊聊/ }).click();
  await expect(page).toHaveURL(/02-result/);
  const state = await saved(page);
  const responses = Object.values(state.responses);
  const percentage = Math.round(
    (responses.filter((answer) => answer === "轻松聊聊").length /
      responses.length) *
      100,
  );
  const row = screen.locator("[data-field-id]").filter({ hasText: "轻松聊聊" });
  await expect(row.locator(":scope > span")).toHaveText(`${percentage}%`);
  await expect(row.locator("p [data-number]")).toHaveText(
    String(responses.filter((answer) => answer === "轻松聊聊").length),
  );
  for (const secret of ["p-shanfeng", "p-xiaoman", "4721", "Meet01"])
    await expect(screen.getByTestId("destiny-world")).not.toContainText(secret);
});

test("waiting point, individual meeting record and merchant feedback reflect only persisted facts", async ({
  page,
}) => {
  await scenario(page, "busy");
  await mobile(page, "08-mutual");
  await expect(page.locator(".mutual-place-copy")).toContainText("正在分配");
  await expect(
    page.getByRole("button", { name: "我已遇见 TA", exact: true }),
  ).toBeDisabled();
  await scenario(page, "mutual");
  await mobile(page, "09-meet");
  await expect(page.getByTestId("own-encounter-code")).toBeVisible();
  await page.waitForTimeout(1600);
  await expect(page.getByRole("button", { name: "确认出发" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "我已经到了" })).toHaveCount(0);
  await page.getByRole("button", { name: "我已遇见 TA", exact: true }).click();
  await expect(page).toHaveURL(/10-next-step/);
  const state = await saved(page);
  const invitation = state.invitations.find(
    (i: {
      confirmations: Record<string, number>;
      departures: Record<string, number>;
      arrivals: Record<string, number>;
    }) =>
      i.confirmations["p-shanfeng"],
  );
  expect(invitation?.departures).toEqual({});
  expect(invitation?.arrivals).toEqual({});
  await scenario(page, "confirmed");
  await mobile(page, "10-next-step");
  await expect(page.locator(".route-draw")).toHaveCount(0);
  await page.getByRole("button", { name: /去云影咖啡/ }).click();
  await expect(page.locator(".route-draw")).toContainText("Meet01");
  await expect(page.locator(".route-draw")).toContainText("云影咖啡");
  await page.getByRole("button", { name: /就到这里，也很好/ }).click();
  await expect(page.locator(".route-draw")).toHaveCount(0);
});
