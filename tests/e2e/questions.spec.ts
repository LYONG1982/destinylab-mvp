import { expect, test, type Page } from "@playwright/test";
import type { DemoState } from "../../src/domain/types";
const KEY = "destinylab:v1.1:state";
const extra = [
  {
    id: "q7",
    title: "到一个不太熟悉的聚会，你通常会？",
    answer: "主动认识几个人",
  },
  {
    id: "q8",
    title: "遇到聊得来的人，你更容易怎么表达？",
    answer: "主动找话题",
  },
  { id: "q9", title: "如果遇到一个不错的人，你更期待？", answer: "先做朋友" },
  { id: "q10", title: "你更容易被哪种感觉的人吸引？", answer: "有趣会聊天" },
];
async function saved(page: Page): Promise<DemoState> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), KEY);
}
async function legacy(page: Page, scene = "discover") {
  await page.goto("/demo");
  await page.getByTestId(`scenario-${scene}`).click();
  await page.getByRole("button", { name: "确认载入", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.evaluate((key) => {
    const s = JSON.parse(localStorage.getItem(key)!) as DemoState;
    s.participants.forEach((p) => {
      for (const q of ["q7", "q8", "q9", "q10"]) delete p.answers[q];
    });
    s.invitations.forEach(
      (i) =>
        (i.common = i.common.filter((a) => Number(a.questionId.slice(1)) <= 6)),
    );
    localStorage.setItem(key, JSON.stringify(s));
  }, KEY);
  return saved(page);
}
async function mobile(page: Page, route: string, actor = "p-shanfeng") {
  await page.goto(`/mobile/${route}?actor=${actor}`);
  await expect(page.locator(".mobile-shell")).toBeVisible();
}
for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test.describe(`ten questions · ${reducedMotion}`, () => {
    test.use({ reducedMotion });
    test("q7–q10 fit five phone widths and only the final answer opens discovery", async ({
      page,
    }) => {
      test.setTimeout(90000);
      for (const width of [320, 360, 390, 393, 430]) {
        await page.setViewportSize({ width, height: 844 });
        const before = await legacy(page);
        await mobile(page, "05-discover");
        await expect(page).toHaveURL(/04-question/);
        await expect(page.locator(".destiny-progress")).toHaveAttribute(
          "aria-label",
          "已完成 6 道，共 10 道",
        );
        await expect(page.locator(".destiny-progress li")).toHaveCount(10);
        for (const [index, q] of extra.entries()) {
          await expect(
            page.getByRole("heading", { name: q.title, exact: true }),
          ).toBeVisible();
          await expect(page.locator(".question-progress strong")).toHaveText(
            String(index + 7).padStart(2, "0"),
          );
          const current = page.locator(".question-transition > :first-child");
          await expect(current.locator(".answer-card")).toHaveCount(4);
          const rectangles = await current
            .locator("h1, .answer-card")
            .evaluateAll((nodes) =>
              nodes.map((node) => {
                const box = node.getBoundingClientRect();
                return {
                  x: box.x,
                  right: box.right,
                  height: box.height,
                  scroll: node.scrollWidth,
                  client: node.clientWidth,
                };
              }),
            );
          for (const box of rectangles) {
            expect(box.x).toBeGreaterThanOrEqual(0);
            expect(box.right).toBeLessThanOrEqual(width);
            expect(box.scroll).toBeLessThanOrEqual(box.client + 1);
            expect(box.height).toBeGreaterThan(20);
          }
          const dots = await page
            .locator(".destiny-progress li > span")
            .evaluateAll((nodes) =>
              nodes.map((node) => node.getBoundingClientRect().x),
            );
          expect(dots[0]).toBeGreaterThanOrEqual(0);
          expect(dots[9] + 9).toBeLessThanOrEqual(width);
          expect(dots.every((x, i) => i === 0 || x - dots[i - 1] >= 9)).toBe(
            true,
          );
          await expect(
            page.getByRole("button", {
              name: index === 3 ? "看看现场同频的人" : "下一题",
              exact: true,
            }),
          ).toBeDisabled();
          if (reducedMotion === "no-preference" && [320, 390].includes(width)) {
            await expect(page.locator(".question-outgoing")).toHaveCount(0);
            await page.screenshot({
              path: `docs/verification/questions-10/${q.id}-${width}.png`,
              fullPage: true,
            });
          }
          await page
            .getByRole("button", { name: q.answer, exact: true })
            .click();
          await page
            .getByRole("button", {
              name: index === 3 ? "看看现场同频的人" : "下一题",
              exact: true,
            })
            .click();
          if (index < 3) await expect(page).toHaveURL(/04-question/);
        }
        await expect(page).toHaveURL(/05-discover/);
        const after = await saved(page);
        expect(Object.keys(after.participants[0].answers)).toHaveLength(10);
        expect(after.invitations).toEqual(before.invitations);
        expect(after.responses).toEqual(before.responses);
        expect(after.scans).toEqual(before.scans);
        expect(after.epoch).toBe(before.epoch);
        expect(after.participants[0].avatarId).toBe(
          before.participants[0].avatarId,
        );
      }
    });
  });
}
test("saved extra answers survive backtracking and refresh; admin shows all ten without filling old answers", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const before = await legacy(page);
  await mobile(page, "04-question");
  expect(await saved(page)).toEqual(before);
  await page
    .getByRole("button", { name: "主动认识几个人", exact: true })
    .click();
  await page.getByRole("button", { name: "下一题", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: extra[1].title }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回上一题" }).click();
  await expect(
    page.getByRole("button", { name: extra[0].answer, exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "跟着感觉走", exact: true }).click();
  await page.getByRole("button", { name: "下一题", exact: true }).click();
  await expect
    .poll(async () => (await saved(page)).participants[0].answers.q7)
    .toBe("跟着感觉走");
  await expect(
    page.getByRole("heading", { name: extra[1].title }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: extra[1].title }),
  ).toBeVisible();
  for (const [index, q] of extra.slice(1).entries()) {
    await page.getByRole("button", { name: q.answer, exact: true }).click();
    await page
      .getByRole("button", {
        name: index === 2 ? "看看现场同频的人" : "下一题",
        exact: true,
      })
      .click();
    await expect
      .poll(async () => (await saved(page)).participants[0].answers[q.id])
      .toBe(q.answer);
    if (index < 2)
      await expect(
        page.getByRole("heading", { name: extra[index + 2].title }),
      ).toBeVisible();
    else await expect(page).toHaveURL(/05-discover/);
    await page.reload();
    if (index < 2)
      await expect(
        page.getByRole("heading", { name: extra[index + 2].title }),
      ).toBeVisible();
  }
  await expect(page).toHaveURL(/05-discover/);
  const after = await saved(page);
  expect(after.participants[0].answers.q7).toBe("跟着感觉走");
  expect(after.participants.slice(1)).toEqual(before.participants.slice(1));
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto("/admin/participants");
  await page
    .getByRole("row")
    .filter({ hasText: "山风" })
    .getByRole("button", { name: "查看详情" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "10 道轻问题" }),
  ).toBeVisible();
  await expect(dialog.locator(".answer-detail > div")).toHaveCount(10);
  for (const value of ["跟着感觉走", ...extra.slice(1).map((q) => q.answer)])
    await expect(dialog).toContainText(value);
  await page.screenshot({
    path: "docs/verification/questions-10/admin-ten-answers.png",
  });
});
test("a persisted six-answer invitation completes two-person meeting then explicitly resumes q7", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const before = await legacy(page, "waiting");
  const invitationId = before.participants[0].currentId!;
  await mobile(page, "05-discover");
  await expect(page).toHaveURL(/07-invitation/);
  await expect(
    page.getByRole("heading", { name: "等待 小满 回应" }),
  ).toBeVisible();
  const receiver = await context.newPage();
  await receiver.setViewportSize({ width: 390, height: 844 });
  await mobile(receiver, "07-invitation", "p-xiaoman");
  await receiver.getByRole("button", { name: "我也愿意认识" }).click();
  await expect(receiver).toHaveURL(/08-mutual/);
  await page.getByRole("button", { name: "查看相遇任务" }).click();
  for (const p of [page, receiver]) {
    await expect(p).toHaveURL(/08-mutual/);
    await p.getByRole("button", { name: "查看见面指引" }).click();
    await expect(p).toHaveURL(/09-meet/);
    await p.getByRole("button", { name: "确认出发", exact: true }).click();
    await p.getByRole("button", { name: "我已经到了", exact: true }).click();
  }
  await page
    .getByRole("button", { name: "我已经见到 TA", exact: true })
    .click();
  expect(
    (await saved(page)).invitations.filter((i) => i.realMeetAt),
  ).toHaveLength(28);
  await receiver
    .getByRole("button", { name: "我已经见到 TA", exact: true })
    .click();
  await expect(page).toHaveURL(/10-next-step/);
  await expect(receiver).toHaveURL(/10-next-step/);
  await page.reload();
  await expect(page).toHaveURL(/10-next-step/);
  await page.getByRole("button", { name: /就到这里，也很好/ }).click();
  await expect(
    page.getByRole("button", { name: /就到这里，也很好/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "我想继续探索" }).click();
  await expect(page).toHaveURL(/04-question/);
  await expect(
    page.getByRole("heading", { name: extra[0].title }),
  ).toBeVisible();
  await expect(receiver).toHaveURL(/10-next-step/);
  const after = await saved(page);
  expect(after.invitations.filter((i) => i.realMeetAt)).toHaveLength(29);
  expect(after.invitations.find((i) => i.id === invitationId)!.common).toEqual(
    before.invitations.find((i) => i.id === invitationId)!.common,
  );
  expect(after.invitations.filter((i) => i.id !== invitationId)).toEqual(
    before.invitations.filter((i) => i.id !== invitationId),
  );
  expect(
    after.participants.map((p) => ({
      answers: p.answers,
      avatarId: p.avatarId,
    })),
  ).toEqual(
    before.participants.map((p) => ({
      answers: p.answers,
      avatarId: p.avatarId,
    })),
  );
});
test("legacy waiting and ended task pages stay readable without a redirect loop", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await legacy(page, "busy");
  await mobile(page, "05-discover");
  await expect(page).toHaveURL(/08-mutual/);
  await expect(
    page.getByRole("heading", { name: "正在等候相遇点" }),
  ).toBeVisible();
  for (const scene of ["declined", "expired"]) {
    await legacy(page, scene);
    await mobile(page, "09-meet");
    await expect(page).toHaveURL(/07-invitation/);
    await expect(
      page.getByRole("button", { name: "继续探索", exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(/07-invitation/);
    await page.getByRole("button", { name: "继续探索", exact: true }).click();
    await expect(page).toHaveURL(/04-question/);
    await expect(
      page.getByRole("heading", { name: extra[0].title }),
    ).toBeVisible();
  }
});
