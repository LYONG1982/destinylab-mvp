import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import process from "node:process";
import { chromium } from "@playwright/test";
import { Pool } from "pg";

const BASE_URL = "http://127.0.0.1:3244";
const DATABASE_NAME = "destinylab_520_uat_test";
const RUNTIME_ENV =
  "/Users/lvyong198201/.local/share/destinylab/uat-520-20261026/runtime.env";
const OUTPUT_DIR =
  "/Users/lvyong198201/Desktop/Game 2026/DestinyLab-MVP/docs/verification/2026-10-27-520-uat";
const BUILD_ID = readFileSync(
  new URL("../../.next-520-uat/BUILD_ID", import.meta.url),
  "utf8",
).trim();
const EXPECT_TIMEOUT_MS = 20_000;
const HARD_TIMEOUT_MS = 9 * 60 * 1000;
let browser;
let pool;
const contexts = new Set();
const activities = [];
const evidence = {
  baseURL: BASE_URL,
  database: DATABASE_NAME,
  branch: "codex/weapp-release-20261013",
  buildId: BUILD_ID,
  startedAt: new Date().toISOString(),
  preparation: "synthetic fixtures inserted directly into isolated local UAT PostgreSQL; no user data",
  cases: [],
  screenshots: [],
  limitations: [
    "H5 browser UAT only; WeChat mini-program, GitHub and online deployment were not tested.",
    "This run did not execute the separate six-question journey or 100-client/30-minute load run.",
  ],
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(fn, description, timeoutMs = EXPECT_TIMEOUT_MS) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (error) {
      last = error;
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${description}${last instanceof Error ? ` (${last.message})` : ""}`);
}

function emptyState() {
  const now = Date.now();
  return {
    schema: 1,
    epoch: randomUUID(),
    revision: 1,
    now,
    wallAt: now,
    scenario: "live",
    activityPaused: false,
    participants: [],
    invitations: [],
    points: Array.from({ length: 30 }, (_, index) => ({
      id: `meet-${index + 1}`,
      name: `Meet${String(index + 1).padStart(2, "0")}`,
      location: "",
      distance: 0,
      occupant: null,
      occupants: [],
      capacity: 1,
      closed: false,
    })),
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
}

function fakePerson(name, gender, currentId) {
  return {
    id: `actor-${randomUUID()}`,
    name,
    gender,
    avatarId: gender === "male" ? "male_03" : "female_03",
    age: "26–29",
    ready: true,
    present: true,
    paused: false,
    profileComplete: true,
    answers: {
      q1: "一起逛逛",
      q3: "美食与探店",
      q5: "出去走走",
      q6: "相处自在",
      q8: "认真听对方说",
      q9: "多见几次再说",
    },
    currentId,
    joinedAt: Date.now(),
  };
}

function fakePair(state, { label, status, pointId, baseCode }) {
  const invitationId = `invite-${randomUUID()}`;
  const male = fakePerson(`风${label}`, "male", invitationId);
  const female = fakePerson(`月${label}`, "female", invitationId);
  const now = Date.now();
  const invitation = {
    id: invitationId,
    from: male.id,
    to: female.id,
    status,
    createdAt: now - 60_000,
    acceptedAt: now - 50_000,
    ...(status === "CONFIRMED" ? { realMeetAt: now - 5_000 } : {}),
    pointId,
    departures: status === "ARRIVING" || status === "CONFIRMED" ? { [male.id]: now - 20_000, [female.id]: now - 19_000 } : {},
    arrivals: status === "CONFIRMED" ? { [male.id]: now - 10_000, [female.id]: now - 9_000 } : {},
    confirmations: status === "CONFIRMED" ? { [male.id]: now - 6_000, [female.id]: now - 5_000 } : {},
    common: [],
    choices: {},
    pass: `P${randomUUID().slice(0, 6).toUpperCase()}`,
    code: "",
    codeVersion: "520",
    encounterCodes: {
      [male.id]: String(baseCode),
      [female.id]: String(520 - baseCode),
    },
  };
  state.participants.push(male, female);
  state.invitations.push(invitation);
  if (pointId) {
    const point = state.points.find((item) => item.id === pointId);
    point.occupants.push(invitationId);
    point.occupant = point.occupants[0];
  }
  return { invitation, male, female };
}

async function createActivity(nameSuffix) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const activity = `admin520-${nameSuffix}-${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    if (!/^admin520-[a-z0-9-]{1,40}$/.test(activity)) throw new Error("Activity guard rejected generated ID");
    if (["meet", "meet-uat", "meet-uat-520", "meet-uat-520-v2"].includes(activity))
      throw new Error("Unsafe activity ID");
    const state = emptyState();
    const inserted = await pool.query(
      "INSERT INTO dl_activities(id,state) VALUES($1,$2::jsonb) ON CONFLICT(id) DO NOTHING RETURNING id",
      [activity, JSON.stringify(state)],
    );
    if (inserted.rowCount === 1) {
      activities.push(activity);
      return { activity, state };
    }
  }
  throw new Error("Could not allocate a unique admin520 activity");
}

async function saveFixture(activity, state) {
  await pool.query("UPDATE dl_activities SET state=$2::jsonb WHERE id=$1", [
    activity,
    JSON.stringify(state),
  ]);
}

async function addParticipantSession(activity, participant) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await pool.query(
    "INSERT INTO dl_sessions(token_hash,activity_id,role,actor,expires_at) VALUES($1,$2,'participant',$3,now()+interval '1 hour')",
    [tokenHash, activity, participant.id],
  );
  return {
    name: `dl-participant-${activity}`,
    value: token,
    url: BASE_URL,
    httpOnly: true,
    sameSite: "Lax",
  };
}

function contextFor(browserInstance, options = {}) {
  const contextPromise = browserInstance.newContext({
    baseURL: BASE_URL,
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
    ...options,
  });
  return contextPromise.then((context) => {
    contexts.add(context);
    context.setDefaultTimeout(EXPECT_TIMEOUT_MS);
    return context;
  });
}

async function loginAdmin(page, activity, credentials) {
  await page.goto(`/admin/dashboard?activity=${encodeURIComponent(activity)}`);
  await page.getByRole("heading", { name: "现场运营登录" }).waitFor({ state: "visible" });
  await page.getByLabel("运营账号").fill(credentials.username);
  await page.getByLabel("密码").fill(credentials.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("heading", { name: "相遇点配置与状态" }).waitFor({ state: "visible" });
}

async function snapshot(context, activity) {
  const response = await context.request.get(
    `/api/live/snapshot?activity=${encodeURIComponent(activity)}&audience=operator`,
  );
  assert.equal(response.status(), 200, "operator snapshot should be readable");
  return response.json();
}

function pointRow(page) {
  return page.getByRole("row").filter({
    has: page.getByText("Meet01", { exact: true }),
  });
}

async function confirmModal(page) {
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "确认操作" }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByText("操作已保存。", { exact: true }).waitFor({ state: "visible" });
}

async function caseConfigAndOccupiedCapacity(credentials) {
  const { activity, state } = await createActivity("config");
  const context = await contextFor(browser);
  const page = await context.newPage();
  const started = Date.now();
  await loginAdmin(page, activity, credentials);
  const row = pointRow(page);
  await row.waitFor({ state: "visible" });
  await row.getByLabel("现场位置").fill("北厅·木窗旁（合成UAT）");
  await row.getByLabel("容量（对）").fill("2");
  await row.getByRole("button", { name: "保存配置" }).click();
  await page.getByText("操作已保存。", { exact: true }).waitFor({ state: "visible" });

  let stored = await snapshot(context, activity);
  const savedPoint = stored.state.points.find((point) => point.id === "meet-1");
  assert.equal(savedPoint.location, "北厅·木窗旁（合成UAT）");
  assert.equal(savedPoint.capacity, 2);
  assert.equal(await row.getByLabel("现场位置").inputValue(), "北厅·木窗旁（合成UAT）");

  await row.getByRole("button", { name: "停用", exact: true }).click();
  await confirmModal(page);
  stored = await snapshot(context, activity);
  assert.equal(stored.state.points.find((point) => point.id === "meet-1").closed, true);
  await row.getByRole("button", { name: "启用", exact: true }).click();
  await confirmModal(page);
  stored = await snapshot(context, activity);
  assert.equal(stored.state.points.find((point) => point.id === "meet-1").closed, false);

  const pair1 = fakePair(state, { label: "岚", status: "ARRIVING", pointId: "meet-1", baseCode: 128 });
  const pair2 = fakePair(state, { label: "禾", status: "ARRIVING", pointId: "meet-1", baseCode: 217 });
  const pair3 = fakePair(state, { label: "苇", status: "ARRIVING", pointId: "meet-2", baseCode: 229 });
  const point = state.points.find((item) => item.id === "meet-1");
  point.location = "北厅·木窗旁（合成UAT）";
  point.capacity = 2;
  point.closed = false;
  state.points.find((item) => item.id === "meet-2").closed = true;
  await saveFixture(activity, state);
  await page.reload();
  await page.getByRole("heading", { name: "相遇点配置与状态" }).waitFor({ state: "visible" });
  const occupiedRow = pointRow(page);
  await waitFor(async () => (await occupiedRow.innerText()).includes("2 / 2 对"), "two synthetic occupants on the same point");
  assert.ok((await occupiedRow.innerText()).includes("风岚 · 月岚"));
  assert.ok((await occupiedRow.innerText()).includes("风禾 · 月禾"));
  assert.match(await occupiedRow.innerText(), /使用中/);
  assert.equal(await occupiedRow.getByRole("button", { name: "停用", exact: true }).isDisabled(), true);
  assert.equal(await occupiedRow.getByLabel("容量（对）").getAttribute("min"), "2");
  await occupiedRow.getByLabel("容量（对）").fill("1");
  assert.equal(await occupiedRow.getByRole("button", { name: "保存配置" }).isDisabled(), true);
  await occupiedRow.getByLabel("容量（对）").fill("2");
  const closedOccupiedRow = page.getByRole("row").filter({
    has: page.getByText("Meet02", { exact: true }),
  });
  await waitFor(async () => (await closedOccupiedRow.innerText()).includes("1 / 1 对"), "occupied disabled meet point");
  assert.equal(await closedOccupiedRow.getByRole("button", { name: "启用", exact: true }).isDisabled(), true);
  await occupiedRow.scrollIntoViewIfNeeded();
  const capacityScreenshot = `${OUTPUT_DIR}/${activity}-capacity-occupied.png`;
  await page.screenshot({ path: capacityScreenshot });
  evidence.screenshots.push(capacityScreenshot);
  stored = await snapshot(context, activity);
  assert.deepEqual(point.occupants, [pair1.invitation.id, pair2.invitation.id]);
  assert.deepEqual(state.points.find((item) => item.id === "meet-2").occupants, [pair3.invitation.id]);
  assert.equal(stored.state.points.find((item) => item.id === "meet-1").occupants.length, 2);
  assert.equal(stored.state.invitations.filter((item) => item.pointId === "meet-1").length, 2);
  await context.close();
  contexts.delete(context);
  return {
    activity,
    elapsedMs: Date.now() - started,
    result: "PASS",
    uiActions: [
      "后台表单通过浏览器保存 Meet01 的现场位置与 2 对容量",
      "后台按钮停用、启用 Meet01，并由运营快照确认状态变化",
      "后台真实表格显示同地点两对占用 2/2；已出发占用时停用按钮禁用，容量最小值为 2，尝试缩到 1 后保存按钮禁用",
      "隔离fixture模拟已停用但仍留有已出发占用的点位，后台启用按钮仍禁用",
    ],
    apiFixture: "两对ARRIVING合成人物占用Meet01、一对ARRIVING合成人物占用已停用Meet02，均由隔离数据库直接注入；没有伪称UI建档",
  };
}

async function caseRetainedAndLiveBackfill(credentials) {
  const { activity, state } = await createActivity("backfill");
  for (const point of state.points) point.closed = point.id !== "meet-1";
  const ended = fakePair(state, {
    label: "松",
    status: "CONFIRMED",
    pointId: "meet-1",
    baseCode: 128,
  });
  const waiting = fakePair(state, {
    label: "溪",
    status: "ACCEPTED",
    pointId: null,
    baseCode: 217,
  });
  const point = state.points.find((item) => item.id === "meet-1");
  point.location = "中厅·木柱旁（合成UAT）";
  point.capacity = 1;
  await saveFixture(activity, state);
  const userCookie = await addParticipantSession(activity, waiting.male);

  const context = await contextFor(browser);
  const page = await context.newPage();
  await loginAdmin(page, activity, credentials);
  const row = pointRow(page);
  await waitFor(async () => (await row.innerText()).includes("1 / 1 对"), "held confirmed occupancy in operator view");
  assert.match(await row.innerText(), /待确认空闲/);
  assert.ok((await row.innerText()).includes("风松 · 月松"));
  assert.equal(await row.getByRole("button", { name: "确认已空闲并释放", exact: true }).isVisible(), true);
  await row.scrollIntoViewIfNeeded();
  const retainedScreenshot = `${OUTPUT_DIR}/${activity}-retained-before-release.png`;
  await page.screenshot({ path: retainedScreenshot });
  evidence.screenshots.push(retainedScreenshot);

  const userContext = await contextFor(browser, {
    viewport: { width: 390, height: 844 },
  });
  await userContext.addCookies([userCookie]);
  await userContext.addInitScript(() => {
    const NativeEventSource = window.EventSource;
    window.__uat520Sse = { constructed: 0, opened: 0, errors: 0 };
    window.EventSource = class UatTrackedEventSource extends NativeEventSource {
      constructor(url, options) {
        super(url, options);
        window.__uat520Sse.constructed++;
        this.addEventListener("open", () => window.__uat520Sse.opened++);
        this.addEventListener("error", () => window.__uat520Sse.errors++);
      }
    };
  });
  const userPage = await userContext.newPage();
  await userPage.goto(`/mobile/08-mutual?activity=${encodeURIComponent(activity)}`);
  const codeLocator = userPage.locator(".mutual-code-copy");
  await codeLocator.waitFor({ state: "visible" });
  const beforeText = await codeLocator.innerText();
  const personalCode = beforeText.match(/我的相遇码[：:]\s*(\d{3})/)?.[1];
  assert.match(personalCode || "", /^\d{3}$/);
  assert.match(await userPage.locator("body").innerText(), /相遇点待系统分配/);
  const initialSse = await userPage.evaluate(() => window.__uat520Sse);
  await waitFor(async () => (await userPage.evaluate(() => window.__uat520Sse.opened)) >= 1, "participant SSE connection");

  await row.getByRole("button", { name: "确认已空闲并释放", exact: true }).click();
  await confirmModal(page);
  await waitFor(async () => (await userPage.locator(".mutual-place-copy").innerText().catch(() => "")).includes("Meet01"), "participant live update after admin release", 25_000);
  const afterText = await codeLocator.innerText();
  const afterCode = afterText.match(/我的相遇码[：:]\s*(\d{3})/)?.[1];
  assert.equal(afterCode, personalCode, "personal code must remain stable after automatic assignment");
  assert.match(await userPage.locator(".mutual-place-copy").innerText(), /中厅·木柱旁（合成UAT）/);

  let stored = await snapshot(context, activity);
  const released = stored.state.invitations.find((item) => item.id === ended.invitation.id);
  const autoAssigned = stored.state.invitations.find((item) => item.id === waiting.invitation.id);
  assert.equal(released.pointId, "meet-1", "ended invitation retains its historical point reference");
  assert.equal(released.status, "CONFIRMED");
  assert.equal(autoAssigned.status, "MEET_ASSIGNED");
  assert.equal(autoAssigned.pointId, "meet-1");
  assert.equal(autoAssigned.encounterCodes[waiting.male.id], "217");
  assert.equal(autoAssigned.encounterCodes[waiting.female.id], "303");
  assert.deepEqual(stored.state.points.find((item) => item.id === "meet-1").occupants, [waiting.invitation.id]);
  assert.match(await row.innerText(), /风溪\s*·\s*月溪/);
  await row.scrollIntoViewIfNeeded();
  const backfillScreenshot = `${OUTPUT_DIR}/${activity}-auto-backfill.png`;
  const participantScreenshot = `${OUTPUT_DIR}/${activity}-participant-live-update.png`;
  await page.screenshot({ path: backfillScreenshot });
  await userPage.screenshot({ path: participantScreenshot, fullPage: true });
  evidence.screenshots.push(backfillScreenshot, participantScreenshot);

  await userContext.setOffline(true);
  const offlineRejected = await waitFor(
    async () => userPage.evaluate(async () => {
      try {
        await fetch("/api/health/ready", { cache: "no-store" });
        return false;
      } catch {
        return true;
      }
    }),
    "browser network request to fail while offline",
    10_000,
  );
  assert.equal(offlineRejected, true);
  await userContext.setOffline(false);
  await userPage.reload();
  await codeLocator.waitFor({ state: "visible" });
  assert.equal(
    (await codeLocator.innerText()).match(/我的相遇码[：:]\s*(\d{3})/)?.[1],
    personalCode,
    "personal code must remain stable after network recovery and page reconnect",
  );
  await userPage.reload();
  await codeLocator.waitFor({ state: "visible" });
  assert.equal(
    (await codeLocator.innerText()).match(/我的相遇码[：:]\s*(\d{3})/)?.[1],
    personalCode,
    "personal code must remain stable after a full page reload",
  );
  assert.match(await userPage.locator(".mutual-place-copy").innerText(), /中厅·木柱旁（合成UAT）/);
  stored = await snapshot(context, activity);
  assert.equal(stored.state.points.find((item) => item.id === "meet-1").occupants[0], waiting.invitation.id);
  await userContext.close();
  contexts.delete(userContext);
  await context.close();
  contexts.delete(context);
  return {
    activity,
    result: "PASS",
    uiActions: [
      "真实运营后台显示已确认见面但仍占用的点位为待确认空闲，保留旧配对占用直到人工确认现场空闲",
      "真实后台点击逐对确认已空闲并释放，确认框复核后提交",
      "已打开的等待配对用户页自动收到后台释放后的 Meet01/现场位置，无需刷新；同一三位码在自动补位、断网恢复后重新加载和再次刷新后保持不变",
      "后台表格更新为新配对占用，运营快照确认状态、点位和原三位码",
    ],
    apiFixture: "一对CONFIRMED保留占用和一对ACCEPTED排队关系由隔离数据库注入；用户会话由哈希令牌合成",
    reconnection: {
      initialOpenCount: initialSse.opened,
      offlineFetchRejected: offlineRejected,
      pageReloadAfterNetworkRecovery: true,
      codeStableAcrossReconnectAndReload: true,
    },
  };
}

async function main() {
  process.loadEnvFile(RUNTIME_ENV);
  if (BASE_URL !== "http://127.0.0.1:3244") throw new Error("URL guard rejected target");
  const databaseURL = new URL(process.env.DATABASE_URL || "http://invalid");
  if (
    !["127.0.0.1", "localhost", "::1"].includes(databaseURL.hostname) ||
    databaseURL.pathname !== `/${DATABASE_NAME}` ||
    databaseURL.protocol !== "postgresql:"
  )
    throw new Error("Database guard rejected target; only local destinylab_520_uat_test is allowed");
  const publicURL = new URL(process.env.DESTINY_PUBLIC_URL || "http://invalid");
  if (publicURL.origin !== BASE_URL) throw new Error("Protected runtime public URL does not match UAT target");
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(BUILD_ID)) throw new Error("Isolated build ID is missing or malformed");
  const servedBuild = await fetch(`${BASE_URL}/_next/static/${BUILD_ID}/_buildManifest.js`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!servedBuild.ok) throw new Error("Running local UAT service does not serve the isolated build ID from .next-520-uat/BUILD_ID");
  const loginPath = process.env.DESTINY_LIVE_TEST_LOGIN;
  if (!loginPath) throw new Error("Protected operator login fixture is unavailable");
  const credentials = JSON.parse(readFileSync(loginPath, "utf8"));
  if (typeof credentials.username !== "string" || typeof credentials.password !== "string")
    throw new Error("Protected operator login fixture has an unexpected shape");

  await mkdir(OUTPUT_DIR, { recursive: true, mode: 0o700 });
  pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3, connectionTimeoutMillis: 5000 });
  const actualDB = await pool.query("SELECT current_database() AS name");
  assert.equal(actualDB.rows[0].name, DATABASE_NAME, "database name guard");
  browser = await chromium.launch({ channel: "chrome", headless: true });
  evidence.cases.push(await caseConfigAndOccupiedCapacity(credentials));
  evidence.cases.push(await caseRetainedAndLiveBackfill(credentials));
  evidence.finishedAt = new Date().toISOString();
  evidence.elapsedMs = Date.parse(evidence.finishedAt) - Date.parse(evidence.startedAt);
  evidence.activities = activities;
  await writeFile(`${OUTPUT_DIR}/520-admin-uat.json`, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({
    result: "PASS",
    buildId: evidence.buildId,
    activities,
    cases: evidence.cases.map(({ activity, result, elapsedMs }) => ({ activity, result, elapsedMs })),
    evidence: `${OUTPUT_DIR}/520-admin-uat.json`,
    screenshots: evidence.screenshots.length,
  }, null, 2));
}

let hardTimeout;
try {
  await Promise.race([
    main(),
    new Promise((_, reject) => {
      hardTimeout = setTimeout(() => reject(new Error("UAT hard timeout reached (9 minutes)")), HARD_TIMEOUT_MS);
    }),
  ]);
} catch (error) {
  evidence.result = "FAIL";
  evidence.failure = error instanceof Error ? error.message : "Unknown test failure";
  evidence.failureStack = error instanceof Error ? error.stack : undefined;
  evidence.finishedAt = new Date().toISOString();
  evidence.activities = activities;
  await mkdir(OUTPUT_DIR, { recursive: true, mode: 0o700 }).catch(() => {});
  await writeFile(`${OUTPUT_DIR}/520-admin-uat-failure.json`, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 }).catch(() => {});
  console.error(error instanceof Error ? error.stack : `520 admin UAT failed: ${evidence.failure}`);
  process.exitCode = 1;
} finally {
  clearTimeout(hardTimeout);
  await Promise.allSettled([...contexts].map((context) => context.close()));
  await browser?.close().catch(() => {});
  await pool?.end().catch(() => {});
}
