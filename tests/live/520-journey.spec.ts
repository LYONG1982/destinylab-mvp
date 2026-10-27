import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Pool } from "pg";
import { QUESTIONS, AGES } from "../../src/data/questions";
import { defaultMeetPoints } from "../../src/domain/meet-points";
import type { DemoState } from "../../src/domain/types";

const protocol = { "X-Destiny-Protocol": "520-v1" };
const login = JSON.parse(
  readFileSync(process.env.DESTINY_LIVE_TEST_LOGIN!, "utf8"),
);
const resultDir = "docs/verification/2026-10-26-520-uat";
let activity = "";
let admin: APIRequestContext;
let pool: Pool;

function newActivityState(): DemoState {
  const now = Date.now();
  return {
    schema: 1,
    epoch: randomUUID(),
    revision: 0,
    now,
    wallAt: now,
    scenario: "live",
    activityPaused: false,
    participants: [],
    invitations: [],
    points: defaultMeetPoints(),
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
  } as DemoState;
}
const api = (path: string, audience = "operator") =>
  `/api/live/${path}?activity=${encodeURIComponent(activity)}&audience=${audience}`;

test.beforeEach(async ({ request }) => {
  activity = `uat520-${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query("INSERT INTO dl_activities(id,state) VALUES($1,$2::jsonb)", [
    activity,
    JSON.stringify(newActivityState()),
  ]);
  admin = request;
  const response = await admin.post(api("login"), {
    data: login,
    headers: {
      Origin: new URL(test.info().project.use.baseURL as string).origin,
    },
  });
  expect(response.status(), await response.text()).toBe(200);
  const point = await admin.post(api("command"), {
    headers: {
      ...protocol,
      Origin: new URL(test.info().project.use.baseURL as string).origin,
      "Idempotency-Key": randomUUID(),
    },
    data: {
      epoch: (await snapshot()).state.epoch,
      command: {
        type: "point-config",
        pointId: "meet-1",
        location: "北厅·木窗旁",
        capacity: 2,
      },
    },
  });
  expect(point.status(), await point.text()).toBe(200);
});

test.afterEach(async () => {
  await pool?.end().catch(() => {});
});

async function snapshot(audience = "operator") {
  const response = await admin.get(api("snapshot", audience));
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}

async function profile(page: Page, name: string, female: boolean) {
  await page.goto(`/mobile/01-start?activity=${activity}&actor=operator`);
  await page.getByRole("button", { name: /一起逛逛/ }).click();
  await page.getByRole("button", { name: "看看现场还有谁和我一样" }).click();
  await page.getByLabel("怎么称呼你？").fill(name);
  if (female)
    await page.getByRole("button", { name: "女生", exact: true }).click();
  await page.getByRole("button", { name: AGES[1], exact: true }).click();
  await page.getByRole("button", { name: "可以，现在就能见面" }).click();
  await page
    .getByRole("radio", { name: `${female ? "女生" : "男生"}虚拟头像 03` })
    .check();
  await page.getByRole("button", { name: "继续答题", exact: true }).click();
  for (const question of QUESTIONS.slice(1))
    await page
      .getByRole("button", { name: question.options[0], exact: true })
      .click();
  await expect(page).toHaveURL(/05-discover/);
}

async function mutualPage(page: Page) {
  await expect(page).toHaveURL(/08-mutual/);
  await expect(page.locator(".mutual-code-copy")).toBeVisible();
  await expect(page.getByText("Meet 01", { exact: true })).toBeVisible();
  await expect(page.locator(".mutual-place-copy")).toContainText("北厅·木窗旁");
  await expect(page.getByTestId("own-encounter-code")).toContainText(/^\d{3}$/);
  await expect(page.locator(".mutual-code-copy")).toContainText("???");
  await expect(page.getByText(/两人的数字相加等于 520/)).toBeVisible();
  await expect(
    page.getByText(/允许本次公开展示|撤回本次公开展示|让这次相遇被看见/),
  ).toHaveCount(0);
  return (await page.getByTestId("own-encounter-code").innerText()).trim();
}

test("two independent H5 users complete the six-question 520 journey and appear on the public screen by default", async ({
  browser,
  baseURL,
}) => {
  mkdirSync(resultDir, { recursive: true });
  const contexts = await Promise.all([
    browser.newContext({
      baseURL,
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    }),
    browser.newContext({
      baseURL,
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    }),
  ]);
  const [a, b] = await Promise.all(
    contexts.map((context) => context.newPage()),
  );
  try {
    await profile(a, "山风", false);
    await profile(b, "小满", true);
    await expect(a.locator(".recommend-card")).toHaveCount(1);
    await a.getByRole("button", { name: "看看共同答案" }).click();
    await a.getByRole("button", { name: "想认识 TA" }).click();
    await a
      .getByRole("dialog")
      .getByRole("button", { name: "发出邀请", exact: true })
      .click();
    await expect(a).toHaveURL(/07-invitation/);
    await b.getByRole("link", { name: /查看你的相遇任务/ }).click();
    await expect(b).toHaveURL(/07-invitation/);
    await b.getByRole("button", { name: "确认认识", exact: true }).click();
    await expect(a.getByRole("button", { name: "查看相遇任务" })).toBeVisible();
    await a.getByRole("button", { name: "查看相遇任务" }).click();
    const codeA = await mutualPage(a);
    const codeB = await mutualPage(b);
    expect(codeA).toMatch(/^\d{3}$/);
    expect(codeB).toMatch(/^\d{3}$/);
    expect(codeA).not.toBe(codeB);
    expect(Number(codeA) + Number(codeB)).toBe(520);
    mkdirSync(resultDir, { recursive: true });
    await a.screenshot({
      path: `${resultDir}/h5-personal-code-a.png`,
      fullPage: true,
    });
    await b.screenshot({
      path: `${resultDir}/h5-personal-code-b.png`,
      fullPage: true,
    });

    for (const [page, expectedCode] of [
      [a, codeA],
      [b, codeB],
    ] as const) {
      await page.reload();
      expect(await mutualPage(page)).toBe(expectedCode);
      await expect(page.getByRole("button", { name: "确认出发" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "我已经到了" })).toHaveCount(0);
    }
    const world = await contexts[0].newPage();
    await world.setViewportSize({ width: 1920, height: 1080 });
    await world.goto(`/screen?activity=${activity}`);
    const stage = world.getByTestId("destiny-world");
    await expect(stage).toHaveAttribute("data-pair-count", "1", {
      timeout: 30000,
    });
    await expect(stage).toHaveAttribute("data-pair-visible", "true", {
      timeout: 30000,
    });
    await expect(
      world.locator(
        '[data-testid*="qr"], [aria-label*="二维码"], img[alt*="二维码"]',
      ),
    ).toHaveCount(0);
    await expect(world.getByText(/扫码进入/)).toHaveCount(0);
    expect(
      (await snapshot("screen")).world.meetScene.qualifiedPairs,
    ).toHaveLength(1);
    await world.screenshot({
      path: `${resultDir}/h5-public-screen.png`,
      fullPage: true,
    });

    const firstRecordCommand = a.getByRole("button", {
      name: "我已遇见 TA",
      exact: true,
    });
    await firstRecordCommand.click();
    await expect(a).toHaveURL(/10-next-step/);
    await expect(b).toHaveURL(/08-mutual/);
    const afterFirstRecord = (await snapshot()).state;
    const recordedByA = afterFirstRecord.invitations[0];
    expect(recordedByA.confirmations[recordedByA.from]).toBeTruthy();
    expect(recordedByA.confirmations[recordedByA.to]).toBeUndefined();
    expect(recordedByA.departures).toEqual({});
    expect(recordedByA.arrivals).toEqual({});
    expect(recordedByA.realMeetAt).toBeUndefined();
    expect((await snapshot("screen")).world.totalMeetings).toBe(0);

    await b.getByRole("button", {
      name: "我已遇见 TA",
      exact: true,
    }).click();
    await expect(b).toHaveURL(/10-next-step/);
    await expect
      .poll(async () => (await snapshot()).state.invitations[0].realMeetAt)
      .toBeTruthy();
    expect((await snapshot("screen")).world.totalMeetings).toBe(1);
    const completedInvitation = (await snapshot()).state.invitations[0];
    expect(completedInvitation.confirmations).toMatchObject({
      [recordedByA.from]: expect.any(Number),
      [recordedByA.to]: expect.any(Number),
    });
    expect(completedInvitation.departures).toEqual({});
    expect(completedInvitation.arrivals).toEqual({});

    const state = await snapshot();
    const invitation = state.state.invitations[0];
    expect(invitation.codeVersion).toBe("520");
    expect(invitation.code).toBe("");
    expect(
      state.state.points.find((point: { id: string }) => point.id === "meet-1"),
    ).toMatchObject({ location: "北厅·木窗旁", capacity: 2 });
    writeFileSync(
      `${resultDir}/${activity}.json`,
      JSON.stringify(
        {
          activity,
          codeA,
          codeB,
          pointId: invitation.pointId,
          screenPairVisible: true,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
