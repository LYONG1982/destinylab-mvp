import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { QUESTIONS } from "../../src/data/questions";
import { defaultMeetPoints } from "../../src/domain/meet-points";
import type { DemoState, Invitation } from "../../src/domain/types";

const protocol = { "X-Destiny-Protocol": "520-v1" };
const activityFor = (suffix: string) => `selfedge-${suffix}-${randomUUID().replaceAll("-", "").slice(0, 12)}`;

type Actor = { context: BrowserContext; id: string };

function newState(mode: "assigned" | "empty" | "legacy"): DemoState {
  const now = Date.now();
  const points = mode === "empty" ? [] : defaultMeetPoints().map((point) => ({
    ...point,
    location: point.id === (mode === "legacy" ? "meet-2" : "meet-1")
      ? mode === "legacy" ? "旧码验收·二号馆东侧长廊入口旁" : "个人相遇验收·东侧入口"
      : "",
    closed: mode === "legacy" && point.id === "meet-1",
    capacity: 1,
  }));
  return {
    schema: 1, epoch: randomUUID(), revision: 0, now, wallAt: now,
    scenario: "live", activityPaused: false,
    participants: [], invitations: [], points,
    helps: [], merchants: [], events: [], scans: [], responses: {},
    merchantViews: [], commands: [], broadcastConsumed: [], tongzhouSubmissions: [],
    displayQuestionId: "q1", displayGrants: {},
  } as DemoState;
}

async function guardedFixture(baseURL: string | undefined, mode: "assigned" | "empty" | "legacy") {
  if (!baseURL || !process.env.DESTINY_PUBLIC_URL || !process.env.DATABASE_URL)
    throw new Error("Self-meet edge tests require the configured private-LAN UAT and dedicated database.");
  const origin = new URL(baseURL).origin;
  const dbUrl = new URL(process.env.DATABASE_URL);
  if (
    new URL(origin).protocol !== "http:" || !((new URL(origin).hostname === "127.0.0.1" && new URL(origin).port === "3244") || (/^192\.168\.\d+\.\d+$/.test(new URL(origin).hostname) && new URL(origin).port === "3246")) ||
    origin !== new URL(process.env.DESTINY_PUBLIC_URL).origin ||
    !["localhost", "127.0.0.1"].includes(dbUrl.hostname) ||
    dbUrl.pathname !== "/destinylab_520_uat_test"
  ) throw new Error("Self-meet edge tests are restricted to the dedicated private-LAN UAT database.");

  const activity = activityFor(mode);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 5000 });
  await pool.query("INSERT INTO dl_activities(id,state) VALUES($1,$2::jsonb)", [activity, JSON.stringify(newState(mode))]);
  return { activity, origin, pool };
}

function api(activity: string, path: string, audience = "participant") {
  return `/api/live/${path}?activity=${encodeURIComponent(activity)}&audience=${audience}`;
}

async function createActor(context: BrowserContext, activity: string, origin: string, name: string, gender: "male" | "female", avatarId: string) {
  const request = context.request;
  const entered = await request.post(api(activity, "session"), {
    headers: { Origin: origin, "X-Destiny-Entry-Key": randomUUID() },
    data: { enter: true },
  });
  expect(entered.status(), await entered.text()).toBe(200);
  const initial = await entered.json() as { actor: string; state: DemoState };
  const run = async (command: unknown) => {
    const response = await request.post(api(activity, "command"), {
      headers: { ...protocol, Origin: origin, "Idempotency-Key": randomUUID() },
      data: { epoch: initial.state.epoch, command },
    });
    expect(response.status(), await response.text()).toBe(200);
    return response.json() as Promise<{ actor: string; state: DemoState }>;
  };
  await run({ type: "profile", name, gender, avatarId, age: "26–29", ready: true });
  for (const question of QUESTIONS)
    await run({ type: "answer", questionId: question.id, value: question.options[0] });
  return { context, id: initial.actor } satisfies Actor;
}

async function preparePair(browser: Browser, baseURL: string, activity: string, origin: string) {
  const maleContext = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const femaleContext = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const male = await createActor(maleContext, activity, origin, "山风验收", "male", "male_03");
  const female = await createActor(femaleContext, activity, origin, "清禾验收", "female", "female_03");
  const command = async (actor: Actor, value: unknown) => {
    const response = await actor.context.request.get(api(activity, "snapshot"));
    expect(response.status(), await response.text()).toBe(200);
    const snap = await response.json() as { state: DemoState };
    const result = await actor.context.request.post(api(activity, "command"), {
      headers: { ...protocol, Origin: origin, "Idempotency-Key": randomUUID() },
      data: { epoch: snap.state.epoch, command: value },
    });
    expect(result.status(), await result.text()).toBe(200);
    return result.json() as Promise<{ state: DemoState }>;
  };
  const invited = await command(male, { type: "invite", targetId: female.id });
  const invitation = invited.state.invitations.find((item) => item.from === male.id && item.to === female.id)!;
  expect(invitation).toBeTruthy();
  await command(female, { type: "accept", invitationId: invitation.id });
  return { male, female, invitationId: invitation.id, contexts: [maleContext, femaleContext] };
}

async function snapshotFromPool(pool: Pool, activity: string): Promise<DemoState> {
  const result = await pool.query("SELECT state FROM dl_activities WHERE id=$1", [activity]);
  return result.rows[0].state as DemoState;
}

async function openGuide(page: Page, activity: string) {
  await page.goto(`/mobile/08-mutual?activity=${encodeURIComponent(activity)}`);
  await expect(page.locator(".mutual-place-copy")).toBeVisible();
}

test("one actor records and continues while the peer can independently end; the assigned slot stays held", async ({ browser, baseURL }) => {
  const fixture = await guardedFixture(baseURL, "assigned");
  const pair = await preparePair(browser, baseURL!, fixture.activity, fixture.origin);
  try {
    const malePage = await pair.male.context.newPage();
    await openGuide(malePage, fixture.activity);
    await expect(malePage.getByRole("button", { name: "我已遇见 TA" })).toBeEnabled();
    await malePage.getByRole("button", { name: "我已遇见 TA" }).click();
    await expect(malePage).toHaveURL(/10-next-step/);
    await expect(malePage.getByText("已记录你的这次相遇。接下来，想怎样继续？")).toBeVisible();

    const femalePage = await pair.female.context.newPage();
    await openGuide(femalePage, fixture.activity);
    await femalePage.getByRole("button", { name: "暂时不见面" }).click();
    await expect(femalePage.getByRole("heading", { name: "结束这次相遇安排？" })).toBeVisible();
    await femalePage.getByRole("button", { name: "确认结束" }).click();
    await expect(femalePage).not.toHaveURL(/08-mutual|09-meet|10-next-step/);

    await malePage.reload();
    await expect(malePage).toHaveURL(/10-next-step/);
    await malePage.getByRole("button", { name: "我想继续探索" }).click();
    await expect(malePage).toHaveURL(/05-discover/);
    const saved = await snapshotFromPool(fixture.pool, fixture.activity);
    const inv = saved.invitations.find((item) => item.id === pair.invitationId)!;
    expect(inv.confirmations[pair.male.id]).toBeTruthy();
    expect(inv.confirmations[pair.female.id]).toBeFalsy();
    expect(inv.status).toBe("CANCELLED");
    expect(inv.pointId).toBeTruthy();
    expect(saved.points.find((point) => point.id === inv.pointId)?.occupants).toContain(inv.id);
    expect(inv.realMeetAt).toBeUndefined();
  } finally {
    await Promise.all(pair.contexts.map((context) => context.close()));
    await fixture.pool.end();
  }
});

test("without an available point the guide invents no Meet01 and cannot record", async ({ browser, baseURL }) => {
  const fixture = await guardedFixture(baseURL, "empty");
  const pair = await preparePair(browser, baseURL!, fixture.activity, fixture.origin);
  try {
    const page = await pair.male.context.newPage();
    await page.goto(`/mobile/08-mutual?activity=${encodeURIComponent(fixture.activity)}`);
    await expect(page.locator(".mutual-place-copy")).toContainText(/分配/);
    await expect(page.getByText("Meet 01", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "我已遇见 TA" })).toBeDisabled();
    await page.goto(`/mobile/10-next-step?activity=${encodeURIComponent(fixture.activity)}`);
    await expect(page).toHaveURL(/08-mutual|09-meet/);
    const state = await snapshotFromPool(fixture.pool, fixture.activity);
    const inv = state.invitations.find((item) => item.id === pair.invitationId)!;
    expect(inv.status).toBe("ACCEPTED");
    expect(inv.pointId).toBeNull();
  } finally {
    await Promise.all(pair.contexts.map((context) => context.close()));
    await fixture.pool.end();
  }
});

test("legacy shared four-digit code and Meet02 custom location remain visible without 520 or hidden-code UI", async ({ browser, baseURL }) => {
  const fixture = await guardedFixture(baseURL, "legacy");
  const pair = await preparePair(browser, baseURL!, fixture.activity, fixture.origin);
  try {
    const state = await snapshotFromPool(fixture.pool, fixture.activity);
    const inv = state.invitations.find((item) => item.id === pair.invitationId)! as Invitation & { codeMap?: Record<string, string> };
    inv.codeVersion = undefined;
    inv.encounterCodes = undefined;
    delete inv.codeMap;
    inv.code = "4721";
    inv.status = "MEET_ASSIGNED";
    inv.pointId = "meet-2";
    const point = state.points.find((item) => item.id === "meet-2")!;
    point.name = "Meet02";
    point.location = "旧码验收·二号馆东侧长廊入口旁";
    const held = new Set(point.occupants || []);
    held.add(inv.id);
    point.occupants = [...held];
    point.occupant = inv.id;
    await fixture.pool.query("UPDATE dl_activities SET state=$2::jsonb WHERE id=$1", [fixture.activity, JSON.stringify(state)]);

    const page = await pair.male.context.newPage();
    await openGuide(page, fixture.activity);
    await expect(page.getByText("Meet 02", { exact: true })).toBeVisible();
    await expect(page.locator(".mutual-place-copy")).toContainText(point.location);
    await expect(page.getByTestId("own-encounter-code")).toContainText("4721");
    await expect(page.getByText("???", { exact: true })).toHaveCount(0);
    await expect(page.getByText(/520/)).toHaveCount(0);
    await page.getByRole("button", { name: "我已遇见 TA" }).click();
    await expect(page).toHaveURL(/10-next-step/);
  } finally {
    await Promise.all(pair.contexts.map((context) => context.close()));
    await fixture.pool.end();
  }
});
