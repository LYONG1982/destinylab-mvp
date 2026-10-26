import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { QUESTIONS } from "../../src/data/questions";
import type { DemoState } from "../../src/domain/types";

const KEY = "destinylab:v1.1:state";
const evidence = "docs/verification/destiny-field-act3-v2/regression/common-detail";
const url = "/mobile/06-common?actor=p-shanfeng&target=p-xiaoman";
const saved = (page: Page) =>
  page.evaluate((key) => localStorage.getItem(key)!, KEY);
async function fixture(page: Page, shared: string[]) {
  await page.goto("/demo");
  await page.getByTestId("scenario-discover").click();
  await page.getByRole("button", { name: "确认载入", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.evaluate(
    ({ key, questions, shared }) => {
      const s = JSON.parse(localStorage.getItem(key)!) as DemoState;
      const me = s.participants.find((p) => p.id === "p-shanfeng")!;
      const other = s.participants.find((p) => p.id === "p-xiaoman")!;
      for (const q of questions) {
        me.answers[q.id] = q.options[0];
        other.answers[q.id] = q.options[shared.includes(q.id) ? 0 : 1];
      }
      other.age = "30–33";
      s.responses[me.id] = me.answers.q1;
      s.responses[other.id] = other.answers.q1;
      localStorage.setItem(key, JSON.stringify(s));
    },
    { key: KEY, questions: QUESTIONS, shared },
  );
}
async function detail(page: Page) {
  await page.goto(url);
  await expect(page.locator(".match-candidate")).toBeVisible();
}

test("0/1/2/3/4/10 real common answers render once each without changing state or permitting a zero-match invite", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (message) => {
    // Existing site has no favicon; it is outside this page and predates M06.
    if (message.location().url === "http://localhost:3210/favicon.ico") return;
    if (["error", "warning"].includes(message.type()))
      errors.push(message.text());
  });
  for (const count of [0, 1, 2, 3, 4, 10]) {
    const ids =
      count === 3
        ? ["q5", "q7", "q8"]
        : QUESTIONS.slice(0, count).map((q) => q.id);
    await fixture(page, ids);
    const before = await saved(page);
    const original = JSON.parse(before) as DemoState;
    const target = original.participants.find((p) => p.id === "p-xiaoman")!;
    await detail(page);
    await expect(page.locator(".match-candidate h2")).toHaveText(target.name);
    await expect(page.locator(".match-candidate-copy > p")).toHaveText(
      "女 · 30–33 岁",
    );
    await expect(page.locator(".match-candidate img")).toHaveAttribute(
      "data-avatar-id",
      target.avatarId!,
    );
    await expect(page.locator(".match-common-card")).toHaveCount(count);
    for (const id of ids) {
      const card = page.locator(`[data-question-id="${id}"]`);
      await expect(card.locator("strong")).toHaveCount(1);
      await expect(card.locator("strong")).toHaveText(target.answers[id]);
      await expect(card.locator(".match-same-label")).toHaveText("同频");
    }
    const primary = page.getByRole("button", {
      name: "想认识 TA",
      exact: true,
    });
    if (count) {
      await expect(page.locator(".common-heading strong")).toHaveText(
        String(count),
      );
      await expect(page.locator(".match-candidate-tags")).toContainText(
        `${count} 个共同点`,
      );
      await expect(primary).toBeEnabled();
    } else {
      await expect(page.locator(".common-heading")).toHaveCount(0);
      await expect(page.locator(".match-common-list")).toHaveCount(0);
      await expect(page.locator(".match-common-empty")).toContainText(
        "答案不完全相同",
      );
      await expect(page.locator("h1")).not.toContainText("同频");
      await expect(primary).toBeDisabled();
      await expect(page.locator("#invite-unavailable-reason")).toContainText(
        "当前没有共同答案",
      );
    }
    expect(await page.locator(".mobile-content").textContent()).not.toMatch(
      /\d+\s*%/,
    );
    expect(await saved(page)).toBe(before);
    await page.screenshot({
      path: `${evidence}/common-${count}-390.png`,
      fullPage: true,
    });
  }
  expect(errors).toEqual([]);
});

test("icebreakers use actual shared topics, wrap safely, reset for another person and fall back without inventing facts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page, ["q5", "q7", "q8"]);
  await detail(page);
  const before = await saved(page);
  const first = "“你周末也喜欢出去走走吗？\n最近有没有想去的地方？”";
  await expect(page.locator(".match-topic-text")).toHaveText(first);
  const switcher = page.getByRole("button", { name: "换一个话题" });
  await switcher.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".match-topic-source")).toContainText(
    "主动认识几个人",
  );
  await switcher.click();
  await expect(page.locator(".match-topic-source")).toContainText("主动找话题");
  await switcher.click();
  await expect(page.locator(".match-topic-text")).toHaveText(first);
  expect(await saved(page)).toBe(before);
  await switcher.click();
  await page.evaluate(() =>
    history.pushState(null, "", "/mobile/06-common?target=p-qinghe"),
  );
  await expect(page.locator(".match-candidate h2")).not.toHaveText("小满");
  await page.evaluate(() =>
    history.pushState(null, "", "/mobile/06-common?target=p-xiaoman"),
  );
  await expect(page.locator(".match-topic-text")).toHaveText(first);
  expect(await saved(page)).toBe(before);
  await fixture(page, ["q9"]);
  await detail(page);
  await expect(page.locator(".match-topic-source")).toContainText("先做朋友");
  await expect(page.locator(".match-topic-text")).toContainText(
    "这个答案你们刚好一样，也许可以从这里聊起。",
  );
  await expect(switcher).toHaveCount(0);
});

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`five mobile widths preserve labels, one primary action and readable 3-point length · ${reducedMotion}`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion });
    await fixture(page, ["q5", "q7", "q8"]);
    const rows: object[] = [];
    for (const width of [320, 375, 390, 393, 430]) {
      await page.setViewportSize({ width, height: 844 });
      await detail(page);
      await expect(page.locator(".match-common-card")).toHaveCount(3);
      await expect
        .poll(() =>
          page
            .locator(".match-candidate")
            .evaluate((el) => getComputedStyle(el).opacity),
        )
        .toBe("1");
      const rects = await page
        .locator(
          ".match-candidate, .match-candidate-copy, .match-candidate-tags, .match-common-card, .match-common-copy, .match-same-label, .match-icebreaker, .match-actions .button",
        )
        .evaluateAll((elements) =>
          elements.map((el) => {
            const rect = el.getBoundingClientRect();
            return {
              className: el.className,
              left: rect.left,
              right: rect.right,
              width: el.clientWidth,
              scrollWidth: el.scrollWidth,
            };
          }),
        );
      for (const rect of rects) {
        expect(rect.left).toBeGreaterThanOrEqual(0);
        expect(rect.right).toBeLessThanOrEqual(width);
        expect(rect.scrollWidth, rect.className).toBeLessThanOrEqual(
          rect.width + 1,
        );
      }
      await expect(page.locator(".mobile-content .button-primary")).toHaveCount(
        1,
      );
      const primary = await page
        .getByRole("button", { name: "想认识 TA" })
        .boundingBox();
      expect(primary!.height).toBeGreaterThanOrEqual(54);
      expect(primary!.height).toBeLessThanOrEqual(58);
      const metrics = await page.evaluate(() => ({
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        screens: document.documentElement.scrollHeight / innerHeight,
      }));
      expect(metrics.scrollWidth).toBe(width);
      if (width >= 375) expect(metrics.screens).toBeLessThanOrEqual(1.65);
      rows.push(metrics);
      await page.screenshot({
        path: `${evidence}/width-${width}-${reducedMotion}.png`,
        fullPage: true,
      });
    }
    await writeFile(
      `${evidence}/widths-${reducedMotion}.json`,
      JSON.stringify(rows, null, 2),
    );
  });
}

test("the shared path draws once, does not replay on data updates or refresh, and settles on reduce or hide", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await fixture(page, ["q5", "q7", "q8"]);
  await detail(page);
  const svg = page.locator(".match-path");
  await expect(svg).toHaveAttribute("data-playing", "true");
  const samples: number[] = [];
  for (let index = 0; index < 8; index++) {
    samples.push(
      await svg
        .locator("path")
        .first()
        .evaluate((el) => parseFloat(getComputedStyle(el).strokeDashoffset)),
    );
    await page.waitForTimeout(65);
  }
  expect(samples.some((value) => value > 0 && value < 1)).toBe(true);
  await expect(svg).toHaveAttribute("data-playing", "false");
  const peer = await context.newPage();
  await peer.goto("/demo");
  await peer.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key)!) as DemoState;
    state.participants.find((p) => p.id === "p-xiaoman")!.answers.q8 =
      "认真听对方说";
    state.revision += 1;
    localStorage.setItem(key, JSON.stringify(state));
  }, KEY);
  await expect(page.locator(".match-common-card")).toHaveCount(2);
  await expect(page.locator(".common-heading strong")).toHaveText("2");
  await expect(svg).toHaveAttribute("data-playing", "false");
  await peer.close();
  const before = await saved(page);
  await page.reload();
  await expect(svg).toHaveAttribute("data-playing", "false");
  expect(await saved(page)).toBe(before);
  await fixture(page, ["q5", "q7", "q8"]);
  await detail(page);
  await expect(svg).toHaveAttribute("data-playing", "true");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(svg).toHaveAttribute("data-playing", "false");
  await expect
    .poll(() =>
      svg.evaluate((el) => el.getAnimations({ subtree: true }).length),
    )
    .toBe(0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(svg).toHaveAttribute("data-playing", "false");
  await fixture(page, ["q5", "q7", "q8"]);
  await detail(page);
  await expect(svg).toHaveAttribute("data-playing", "true");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(svg).toHaveAttribute("data-playing", "false");
  expect(
    await svg
      .locator("path")
      .first()
      .evaluate((el) => getComputedStyle(el).strokeDashoffset),
  ).toBe("0px");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(svg).toHaveAttribute("data-playing", "false");
  await writeFile(`${evidence}/path-samples.json`, JSON.stringify(samples));
});

test("long profiles and ten long shared answers fit; avatar failures and invalid targets remain understandable", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await fixture(
    page,
    QUESTIONS.map((q) => q.id),
  );
  await page.evaluate((key) => {
    const s = JSON.parse(localStorage.getItem(key)!) as DemoState;
    const me = s.participants.find((p) => p.id === "p-shanfeng")!;
    const target = s.participants.find((p) => p.id === "p-xiaoman")!;
    target.name = "银川小银杏";
    for (const id of Object.keys(me.answers))
      target.answers[id] = me.answers[id] =
        "一个用于旧数据兼容检查的比较长的共同答案";
    target.avatarId = null;
    localStorage.setItem(key, JSON.stringify(s));
  }, KEY);
  await page.setViewportSize({ width: 320, height: 844 });
  await detail(page);
  await expect(page.locator(".match-common-card")).toHaveCount(10);
  await expect(
    page.locator(".match-candidate .avatar-placeholder"),
  ).toBeVisible();
  await expect(page.locator(".match-candidate h2")).toHaveText("银川小银杏");
  const overflows = await page
    .locator(".match-common-copy, .match-candidate-copy, .match-topic-text")
    .evaluateAll((els) =>
      els
        .filter((el) => el.scrollWidth > el.clientWidth + 1)
        .map((el) => el.className),
    );
  expect(overflows).toEqual([]);
  for (const target of ["missing-person", "p-shanfeng"]) {
    await page.goto(`/mobile/06-common?actor=p-shanfeng&target=${target}`);
    await expect(
      page.getByRole("heading", { name: "这位朋友暂时不可见" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "想认识 TA" })).toHaveCount(
      0,
    );
    await page.getByRole("button", { name: "回到发现" }).click();
    await expect(page).toHaveURL(/05-discover$/);
  }
});
