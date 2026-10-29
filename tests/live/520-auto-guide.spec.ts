import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Pool } from "pg";
import { QUESTIONS } from "../../src/data/questions";
import { defaultMeetPoints } from "../../src/domain/meet-points";
import type { DemoState } from "../../src/domain/types";

const headers = { "X-Destiny-Protocol": "520-v1" };
const evidence = "docs/verification/2026-10-29-auto-guide";
type Actor = { context: BrowserContext; id: string };

async function fixture(browser: Browser, baseURL: string | undefined, closed = false, blockedStorage = false) {
  const base = new URL(baseURL || "http://invalid");
  const db = new URL(process.env.DATABASE_URL || "http://invalid");
  if (base.origin !== "http://127.0.0.1:3244" || process.env.DESTINY_PUBLIC_URL !== base.origin ||
      !["127.0.0.1", "localhost"].includes(db.hostname) || db.pathname !== "/destinylab_520_uat_test")
    throw Error("Auto-guide tests require the dedicated loopback UAT and exact local test database");
  const activity = `autoguide-${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const points = defaultMeetPoints().slice(0, 1).map(p => ({ ...p, closed, location: "虚构自动呈现测试·东侧入口" }));
  const state = {
    schema: 1, epoch: randomUUID(), revision: 0, now: Date.now(), wallAt: Date.now(), scenario: "live",
    activityPaused: false, participants: [], invitations: [], points, helps: [], merchants: [], events: [],
    scans: [], responses: {}, merchantViews: [], commands: [], broadcastConsumed: [], tongzhouSubmissions: [],
    displayQuestionId: "q1", displayGrants: {},
  } as DemoState;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  await pool.query("INSERT INTO dl_activities(id,state) VALUES($1,$2::jsonb)", [activity, JSON.stringify(state)]);
  const contexts = await Promise.all([0, 1].map(() => browser.newContext({
    baseURL, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: "reduce",
  })));
  if (blockedStorage) await contexts[0].addInitScript(() => {
    Object.defineProperty(window, "sessionStorage", { get() { throw new DOMException("Storage blocked", "SecurityError"); } });
  });
  const api = (path: string, audience = "participant") => `/api/live/${path}?activity=${activity}&audience=${audience}`;
  const command = async (actor: Actor, command: unknown) => {
    const result = await actor.context.request.post(api("command"), {
      headers: { ...headers, Origin: base.origin, "Idempotency-Key": randomUUID() },
      data: { epoch: state.epoch, command },
    });
    expect(result.status(), await result.text()).toBe(200);
  };
  const actors: Actor[] = [];
  for (let n = 0; n < 2; n++) {
    const context = contexts[n];
    const entered = await context.request.post(api("session"), {
      headers: { Origin: base.origin, "X-Destiny-Entry-Key": randomUUID() }, data: { enter: true },
    });
    expect(entered.status(), await entered.text()).toBe(200);
    const actor = { context, id: (await entered.json()).actor as string };
    actors.push(actor);
    await command(actor, { type: "profile", name: n ? "禾禾" : "川川", gender: n ? "female" : "male", avatarId: n ? "female_05" : "male_05", age: "26–29", ready: true });
    for (const q of QUESTIONS) await command(actor, { type: "answer", questionId: q.id, value: q.options[0] });
  }
  const snapshot = async (): Promise<DemoState> => (await pool.query("SELECT state FROM dl_activities WHERE id=$1", [activity])).rows[0].state;
  expect((await snapshot()).invitations).toHaveLength(0); // Ready is not consent to a particular person.
  await command(actors[0], { type: "invite", targetId: actors[1].id });
  const invitationId = (await snapshot()).invitations[0].id;
  const pages = await Promise.all(contexts.map(c => c.newPage()));
  const close = async () => { await Promise.all(contexts.map(c => c.close())); await pool.end(); };
  return { activity, points, state, pool, actors, contexts, pages, api, snapshot, invitationId, close, origin: base.origin };
}

async function guide(page: Page, activity: string, expected = "Meet 01") {
  await expect(page).toHaveURL(new RegExp(`/08-mutual\\?activity=${activity}`), { timeout: 25000 });
  await expect(page.getByRole("region", { name: "你的相遇地点" })).toContainText(expected);
  await expect(page.getByTestId("own-encounter-code")).toContainText(/^\d{3}$/);
  await expect(page.getByLabel("对方相遇码隐藏")).toHaveText("???");
  return (await page.getByTestId("own-encounter-code").innerText()).trim();
}

async function save(f: Awaited<ReturnType<typeof fixture>>, scenario: string) {
  mkdirSync(evidence, { recursive: true });
  for (let n = 0; n < f.pages.length; n++)
    await f.pages[n].screenshot({ path: `${evidence}/${f.activity}-${scenario}-${n ? "female" : "male"}.png`, fullPage: true });
  const s = await f.snapshot();
  writeFileSync(`${evidence}/${f.activity}.json`, JSON.stringify({
    scenario, status: "PASS", activity: f.activity, invitations: s.invitations.length,
    codes: Object.values(s.invitations[0].encounterCodes || {}), point: s.points.find(p => p.id === s.invitations[0].pointId)?.name,
    departures: Object.keys(s.invitations[0].departures).length, arrivals: Object.keys(s.invitations[0].arrivals).length,
    confirmations: Object.keys(s.invitations[0].confirmations).length,
    boundary: "API prepares fictional local profiles; acceptance, auto-navigation and subsequent participant actions use real H5 UI. No production or WeChat-device claim.",
  }, null, 2));
}

for (const [senderRoute, blockedStorage, offline] of [
  ["07-invitation", false, false], ["05-discover", false, false],
  ["06-common", false, true], ["05-discover", true, false],
] as const) test(`auto-guide from ${senderRoute}; blocked storage=${blockedStorage}; reconnect=${offline}`, async ({ browser, baseURL }) => {
  const f = await fixture(browser, baseURL, false, blockedStorage);
  try {
    const [male, female] = f.pages;
    await male.goto(`/mobile/${senderRoute}?activity=${f.activity}&target=${f.actors[1].id}`);
    await female.goto(`/mobile/07-invitation?activity=${f.activity}`);
    await expect(female.getByRole("button", { name: "确认认识", exact: true })).toBeVisible();
    await expect(male.getByRole("region", { name: "相遇点指引" })).toHaveCount(0);
    if (offline) await f.contexts[0].setOffline(true);
    await female.getByRole("button", { name: "确认认识", exact: true }).click();
    if (offline) {
      await expect(male).toHaveURL(/06-common/);
      await f.contexts[0].setOffline(false);
    }
    // No sender click or goto after the peer accepts: this is the regression assertion.
    const [a, b] = await Promise.all([guide(male, f.activity), guide(female, f.activity)]);
    expect(Number(a) + Number(b)).toBe(520);
    await save(f, `${senderRoute}${blockedStorage ? "-blocked-storage" : ""}`);
    await male.getByRole("button", { name: "返回", exact: true }).click();
    await expect(male).toHaveURL(/05-discover/);
    await expect(male.locator(".task-banner")).toBeVisible();
    await male.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(male).toHaveURL(/05-discover/);
    if (!blockedStorage) {
      await male.reload();
      await expect(male.locator(".task-banner")).toBeVisible();
      await expect(male).toHaveURL(/05-discover/);
    }
    await male.goto(`/mobile/07-invitation?activity=${f.activity}`);
    expect(await guide(male, f.activity)).toBe(a);
    const s = await f.snapshot();
    expect(s.invitations).toHaveLength(1);
    expect(s.events.filter(e => e.type === "ENCOUNTER_CODES")).toHaveLength(1);
    expect(s.events.filter(e => e.type === "ASSIGNED")).toHaveLength(1);
    expect(s.invitations[0].confirmations).toEqual({});
    if (senderRoute === "07-invitation") {
      await male.getByRole("button", { name: "我已遇见 TA", exact: true }).click();
      await expect(male).toHaveURL(/10-next-step/);
      await male.goto(`/mobile/07-invitation?activity=${f.activity}`);
      await expect(male).toHaveURL(/10-next-step/);
      await expect(female).toHaveURL(/08-mutual/);
    }
  } finally { await f.close(); }
});

test("both guides wait truthfully and update in place when the operator enables an available point", async ({ browser, baseURL }) => {
  const f = await fixture(browser, baseURL, true);
  let admin: BrowserContext | undefined;
  try {
    for (const page of f.pages) await page.goto(`/mobile/07-invitation?activity=${f.activity}`);
    await f.pages[1].getByRole("button", { name: "确认认识", exact: true }).click();
    for (const page of f.pages) {
      await expect(page).toHaveURL(/08-mutual/);
      await expect(page.getByRole("region", { name: "你的相遇地点" })).toContainText("相遇点待分配");
      await expect(page.getByText("Meet 01", { exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "我已遇见 TA", exact: true })).toBeDisabled();
    }
    const before = (await f.snapshot()).invitations[0].encounterCodes;
    const login = JSON.parse(readFileSync(process.env.DESTINY_LIVE_TEST_LOGIN!, "utf8"));
    admin = await browser.newContext({ baseURL });
    const page = await admin.newPage();
    await page.goto(`/admin/dashboard?activity=${f.activity}`);
    await page.getByLabel("运营账号").fill(login.username);
    await page.getByLabel("密码", { exact: true }).fill(login.password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    const row = page.locator(".meet-point-table tbody tr").filter({ hasText: "Meet01" });
    await row.getByRole("button", { name: "启用", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "确认操作", exact: true }).click();
    await Promise.all(f.pages.map(p => guide(p, f.activity)));
    const after = await f.snapshot();
    expect(after.invitations[0].encounterCodes).toEqual(before);
    expect(after.invitations[0].status).toBe("MEET_ASSIGNED");
    await save(f, "resource-available-auto-update");
  } finally { await admin?.close(); await f.close(); }
});

test("a declined invitation does not navigate either actor into a successful guide", async ({ browser, baseURL }) => {
  const f = await fixture(browser, baseURL);
  try {
    for (const page of f.pages) await page.goto(`/mobile/07-invitation?activity=${f.activity}`);
    await f.pages[1].getByRole("button", { name: "暂时不见面", exact: true }).click();
    for (const page of f.pages) {
      await expect(page.getByText(/本次邀请已结束/).first()).toBeVisible();
      await expect(page).toHaveURL(/07-invitation/);
      await expect(page.getByRole("region", { name: "相遇点指引" })).toHaveCount(0);
    }
    const i = (await f.snapshot()).invitations[0];
    expect(i.encounterCodes).toBeUndefined(); expect(i.pointId).toBeNull();
  } finally { await f.close(); }
});
