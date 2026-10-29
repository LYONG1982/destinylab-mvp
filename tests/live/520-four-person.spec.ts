import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { QUESTIONS, AGES } from "../../src/data/questions";
import { defaultMeetPoints } from "../../src/domain/meet-points";
import type { DemoState } from "../../src/domain/types";

const evidence = "docs/verification/2026-10-27-four-person";
const people = [
  { name: "山风", gender: "male", avatar: "03" },
  { name: "远舟", gender: "male", avatar: "07" },
  { name: "小满", gender: "female", avatar: "03" },
  { name: "清禾", gender: "female", avatar: "08" },
] as const;
const login = JSON.parse(readFileSync(process.env.DESTINY_LIVE_TEST_LOGIN!, "utf8"));

for (const sharedPoint of [false, true]) {
  test(`four real UI participants form two pairs at ${sharedPoint ? "one shared point" : "two separate points"}`, async ({ browser, baseURL }, testInfo) => {
    const origin = new URL(baseURL!).origin;
    const dbUrl = new URL(process.env.DATABASE_URL!);
    if (origin !== new URL(process.env.DESTINY_PUBLIC_URL!).origin || !["localhost", "127.0.0.1"].includes(dbUrl.hostname) || dbUrl.pathname !== "/destinylab_520_uat_test")
      throw Error("Only dedicated local four-person UAT is allowed");
    const activity = `four520-${sharedPoint ? "shared" : "separate"}-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const mode = sharedPoint ? "shared" : "separate";
    const contexts: BrowserContext[] = [];
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 5000 });
    const result: Record<string, unknown> = {
      activity, mode, origin, startedAt: new Date().toISOString(),
      buildId: readFileSync(`${process.env.DESTINY_DIST_DIR || ".next-520-uat"}/BUILD_ID`, "utf8").trim(),
      preparation: "Only empty activity/initial point enablement and operator authentication are prepared. All four people, answers, invitations and meeting actions use browser UI.",
      screenshots: [], stages: [],
    };
    mkdirSync(evidence, { recursive: true, mode: 0o700 });
    const api = (name: string, role = "operator") => `/api/live/${name}?activity=${activity}&audience=${role}`;
    const image = async (page: Page, name: string) => {
      const file = `${evidence}/${activity}-${name}.png`;
      await page.screenshot({ path: file, fullPage: true });
      (result.screenshots as string[]).push(file);
    };
    const stage = (label: string) => (result.stages as string[]).push(label);
    let adminContext: BrowserContext;
    const operator = async () => {
      const response = await adminContext.request.get(api("snapshot"));
      expect(response.status()).toBe(200);
      return (await response.json()).state as DemoState;
    };
    const world = async () => {
      const response = await adminContext.request.get(api("snapshot", "screen"));
      expect(response.status()).toBe(200);
      return (await response.json()).world;
    };
    const mine = async (context: BrowserContext) => {
      const response = await context.request.get(api("snapshot", "participant"));
      expect(response.status()).toBe(200);
      return await response.json() as { actor: string; state: DemoState };
    };

    try {
      const now = Date.now();
      const initial = {
        schema: 1, epoch: randomUUID(), revision: 0, now, wallAt: now, scenario: "live", activityPaused: false,
        participants: [], invitations: [], helps: [], merchants: [], events: [], scans: [], responses: {}, merchantViews: [], commands: [], broadcastConsumed: [], tongzhouSubmissions: [], displayQuestionId: "q1", displayGrants: {},
        points: defaultMeetPoints().map((point, index) => ({ ...point, capacity: 1, closed: sharedPoint && index !== 0 })),
      };
      await pool.query("INSERT INTO dl_activities(id,state) VALUES($1,$2::jsonb)", [activity, JSON.stringify(initial)]);
      adminContext = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
      contexts.push(adminContext);
      const loggedIn = await adminContext.request.post(api("login"), { headers: { Origin: origin }, data: login });
      expect(loggedIn.status()).toBe(200);
      const admin = await adminContext.newPage();
      await admin.goto(`/admin/dashboard?activity=${activity}`);
      const configuredLocations: Record<string, string> = {};
      for (const index of sharedPoint ? [1] : [1, 2]) {
        const name = `Meet${String(index).padStart(2, "0")}`;
        const row = admin.getByRole("row").filter({ has: admin.getByText(name, { exact: true }) });
        const location = sharedPoint ? "合成UAT·共用相遇区" : `合成UAT·${index === 1 ? "东侧" : "西侧"}相遇区`;
        await row.getByLabel("现场位置").fill(location);
        await row.getByLabel("容量（对）").fill(sharedPoint ? "2" : "1");
        await row.getByRole("button", { name: "保存配置" }).click();
        await expect.poll(async () => (await operator()).points.find((p) => p.name === name)?.location).toBe(location);
        configuredLocations[`meet-${index}`] = location;
      }
      stage("Admin UI configured synthetic locations and capacity");

      const userContexts = await Promise.all(people.map(() => browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, reducedMotion: "reduce" })));
      contexts.push(...userContexts);
      const pages = await Promise.all(userContexts.map((context) => context.newPage()));
      for (const [index, person] of people.entries()) {
        const page = pages[index];
        await page.goto(`/mobile/01-start?activity=${activity}`);
        await page.getByRole("button", { name: /一起逛逛/ }).click();
        await page.getByRole("button", { name: "看看现场还有谁和我一样" }).click();
        await page.getByLabel("怎么称呼你？").fill(person.name);
        if (person.gender === "female") await page.getByRole("button", { name: "女生", exact: true }).click();
        await page.getByRole("button", { name: AGES[1], exact: true }).click();
        await page.getByRole("button", { name: "可以，现在就能见面" }).click();
        await page.getByRole("radio", { name: `${person.gender === "male" ? "男生" : "女生"}虚拟头像 ${person.avatar}` }).check();
        await page.getByRole("button", { name: "继续答题", exact: true }).click();
        for (const question of QUESTIONS.slice(1)) await page.getByRole("button", { name: question.options[0], exact: true }).click();
        await expect(page).toHaveURL(/05-discover/);
      }
      const identities = await Promise.all(userContexts.map(mine));
      const actors = identities.map((s) => s.actor);
      expect(new Set(actors).size).toBe(4);
      result.identities = people.map((person, index) => ({ ...person, actor: actors[index] }));
      for (const [index, page] of pages.entries()) {
        await expect(page.locator(".recommend-card")).toHaveCount(2);
        for (const candidate of people.filter((p) => p.gender !== people[index].gender))
          await expect(page.locator(".recommend-card").getByRole("heading", { name: candidate.name, exact: true })).toBeVisible();
      }
      let state = await operator();
      expect(state.participants).toHaveLength(4);
      expect(state.participants.filter((p) => p.gender === "male")).toHaveLength(2);
      expect(state.participants.filter((p) => p.gender === "female")).toHaveLength(2);
      for (const participant of state.participants) expect(QUESTIONS.every((q) => !!participant.answers[q.id])).toBe(true);
      await admin.goto(`/admin/participants?activity=${activity}`);
      await admin.getByLabel("筛选参与阶段").selectOption("all");
      await expect(admin.getByText("共 4 人", { exact: true })).toBeVisible();
      for (const person of people) await expect(admin.getByRole("row").filter({ has: admin.getByText(person.name, { exact: true }) })).toHaveCount(1);
      await image(admin, "four-participants");
      stage("Four isolated actors completed all six answers in UI; each saw two opposite-gender candidates");

      for (const [from, to] of [[0, 2], [1, 3]]) {
        const card = pages[from].locator(".recommend-card").filter({ has: pages[from].getByRole("heading", { name: people[to].name, exact: true }) });
        await card.getByRole("button", { name: "看看共同答案" }).click();
        await pages[from].getByRole("button", { name: "想认识 TA" }).click();
        await pages[from].getByRole("dialog").getByRole("button", { name: "发出邀请", exact: true }).click();
        await expect(pages[from]).toHaveURL(/07-invitation/);
        state = await operator();
        const pending = state.invitations.find((i) => i.from === actors[from])!;
        expect(pending.status).toBe("SENT");
        expect(pending.encounterCodes).toBeUndefined();
        expect(pending.code).toBe("");
        await pages[to].getByRole("link", { name: /查看你的相遇任务/ }).click();
        await pages[to].getByRole("button", { name: "确认认识", exact: true }).click();
        await expect(pages[to]).toHaveURL(/08-mutual/);
        await expect(pages[from]).toHaveURL(/08-mutual/);
      }
      state = await operator();
      expect(state.invitations).toHaveLength(2);
      expect(new Set(state.invitations.map((i) => i.pointId)).size).toBe(sharedPoint ? 1 : 2);
      const participantResults: Array<Record<string, unknown>> = [];
      const codes: string[] = [];
      for (const [index, page] of pages.entries()) {
        const current = await mine(userContexts[index]);
        expect(current.actor).toBe(actors[index]);
        expect(current.state.invitations).toHaveLength(1);
        const invitation = current.state.invitations[0];
        expect(Object.keys(invitation.encounterCodes!)).toEqual([actors[index]]);
        expect([invitation.from, invitation.to]).toContain(actors[index]);
        const code = invitation.encounterCodes![actors[index]];
        expect(code).toMatch(/^\d{3}$/);
        codes.push(code);
        const point = state.points.find((p) => p.id === invitation.pointId)!;
        await expect(page.locator(".mutual-code-copy")).toContainText(code);
        const pointRegion = page.getByRole("region", { name: "你的相遇地点" });
        await expect(pointRegion).toContainText(point.name.replace(/^Meet(\d+)$/i, "Meet $1"));
        await expect(pointRegion.locator(".mutual-place-copy")).toContainText(configuredLocations[point.id]);
        await expect(page.getByText(/让这次相遇被看见|允许本次公开展示|工作人员正在协调/)).toHaveCount(0);
        await image(page, `user-${index + 1}-${people[index].name}`);
        await page.reload();
        await expect(page.locator(".mutual-code-copy")).toContainText(code);
        const restored = await mine(userContexts[index]);
        expect(restored.actor).toBe(actors[index]);
        expect(restored.state.invitations[0].pointId).toBe(point.id);
        expect(restored.state.invitations[0].encounterCodes![actors[index]]).toBe(code);
        participantResults.push({ name: people[index].name, gender: people[index].gender, actor: actors[index], code, point: point.name, location: point.location, invitation: invitation.id, reloadStable: true });
      }
      expect(new Set(codes).size).toBe(4);
      expect(Number(codes[0]) + Number(codes[2])).toBe(520);
      expect(Number(codes[1]) + Number(codes[3])).toBe(520);
      result.people = participantResults;
      stage("Two tasks have four globally unique personal codes, pair sums 520, own-only projections, stable refresh and expected locations");

      await admin.goto(`/admin/encounters?activity=${activity}`);
      await expect(admin.locator(".encounter-card")).toHaveCount(2);
      await image(admin, "two-encounters");
      const screenContext = await browser.newContext({ baseURL, viewport: { width: 1920, height: 1080 }, reducedMotion: "reduce" });
      contexts.push(screenContext);
      const screen = await screenContext.newPage();
      await screen.goto(`/screen?activity=${activity}`);
      const scene = screen.getByTestId("destiny-world");
      await expect(scene).toHaveAttribute("data-pair-count", "2", { timeout: 30000 });
      await expect(scene).toHaveAttribute("data-pair-visible", "true", { timeout: 30000 });
      await expect(screen.locator('[data-testid*="qr"], [aria-label*="二维码"], img[alt*="二维码"]')).toHaveCount(0);
      await expect(screen.getByText(/扫码进入/)).toHaveCount(0);
      let publicData = await world();
      expect(publicData.meetScene.qualifiedPairs).toHaveLength(2);
      expect(publicData.totalMeetings).toBe(0);
      expect(JSON.stringify(publicData)).not.toContain("encounterCodes");
      for (const actor of actors) expect(JSON.stringify(publicData)).not.toContain(actor);
      await image(screen, "two-public-pairs-before-meeting");
      stage("Public screen shows two pairs without consent UI/entry QR/private code fields, while actual meeting count remains zero");

      const countProgress: number[] = [0];
      for (const [pairIndex, pair] of [[0, 2], [1, 3]].entries()) {
        const first = pages[pair[0]];
        const second = pages[pair[1]];
        await expect(first).toHaveURL(/08-mutual/);
        await expect(second).toHaveURL(/08-mutual/);
        for (const participant of [first, second]) {
          await expect(
            participant.getByRole("button", { name: "确认出发" }),
          ).toHaveCount(0);
          await expect(
            participant.getByRole("button", { name: "我已经到了" }),
          ).toHaveCount(0);
        }
        await first.getByRole("button", { name: "我已遇见 TA", exact: true }).click();
        await expect(first).toHaveURL(/10-next-step/);
        expect((await world()).totalMeetings).toBe(pairIndex);
        const singleRecorded = await operator();
        const singleInvitation = singleRecorded.invitations.find(
          (invitation: { from: string }) => invitation.from === actors[pair[0]],
        )!;
        expect(singleInvitation.confirmations[actors[pair[0]]]).toBeTruthy();
        expect(singleInvitation.confirmations[actors[pair[1]]]).toBeUndefined();
        expect(singleInvitation.departures).toEqual({});
        expect(singleInvitation.arrivals).toEqual({});
        expect(singleInvitation.realMeetAt).toBeUndefined();
        await expect(second).toHaveURL(/08-mutual/);
        countProgress.push(pairIndex);
        await second.getByRole("button", { name: "我已遇见 TA", exact: true }).click();
        await expect(second).toHaveURL(/10-next-step/);
        await expect.poll(async () => (await world()).totalMeetings).toBe(pairIndex + 1);
        countProgress.push(pairIndex + 1);
      }
      for (const page of pages) await page.reload();
      publicData = await world();
      expect(publicData.totalMeetings).toBe(2);
      state = await operator();
      expect(state.invitations.filter((i) => i.status === "CONFIRMED")).toHaveLength(2);
      expect(state.points.reduce((sum, p) => sum + (p.occupants?.length ?? (p.occupant ? 1 : 0)), 0)).toBe(2);
      await admin.goto(`/admin/dashboard?activity=${activity}`);
      await expect(admin.getByRole("heading", { name: "相遇点配置与状态" })).toBeVisible();
      await image(admin, "confirmed-but-held-points");
      await expect(scene).toHaveAttribute("data-meetings", "2");
      await expect(scene).toHaveAttribute("data-pair-visible", "true", { timeout: 30000 });
      await expect.poll(async () => {
        const labels = await screen.locator("[data-pair-caption]:visible").allTextContents();
        return labels.length === 2 && labels.every((label) => label.includes("已确认见面"));
      }, { timeout: 30000 }).toBe(true);
      await expect(screen.getByText("次相遇", { exact: true }).locator("..")).toHaveText(/2\s*次相遇/);
      await image(screen, "two-confirmed-public-pairs");
      result.actualMeetingCountProgress = countProgress;
      result.finalConfirmedPairs = 2;
      result.pointsRemainHeld = true;
      result.publicPairs = publicData.meetScene.qualifiedPairs.length;
      result.screenDomFinalMeetings = 2;
      result.screenBothPairsConfirmed = true;
      result.adminUrl = `${origin}/admin/encounters?activity=${activity}`;
      result.screenUrl = `${origin}/screen?activity=${activity}`;
      stage("Both pairs recorded independently via the direct meeting action; counts change only after both records, arrivals remain absent, and points stay held");
      result.result = "PASS";
    } catch (error) {
      result.result = "FAIL";
      result.error = error instanceof Error ? error.message.replace(/[A-Za-z0-9_-]{43}/g, "[REDACTED_TOKEN]") : "Unknown failure";
      throw error;
    } finally {
      result.finishedAt = new Date().toISOString();
      result.testStatus = testInfo.status;
      writeFileSync(`${evidence}/${activity}-result.json`, JSON.stringify(result, null, 2), { mode: 0o600 });
      await Promise.allSettled(contexts.map((context) => context.close()));
      await pool.end();
    }
  });
}
