import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { QUESTIONS, AGES } from "../../src/data/questions";
import { defaultMeetPoints } from "../../src/domain/meet-points";
import type { DemoState } from "../../src/domain/types";

const evidence = "docs/verification/2026-10-27-pairshots-updated";
const people = [
  { name: "云川", gender: "male", label: "男生", avatar: "04" },
  { name: "星宁", gender: "female", label: "女生", avatar: "06" },
] as const;
type Shot = { owner: number; sequence: number; title: string; action: string; file: string };
const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

test("two new mobile participants meet through real UI, with separate step-by-step screenshots", async ({ browser, baseURL }, testInfo) => {
  if (!baseURL || !process.env.DESTINY_PUBLIC_URL || !process.env.DATABASE_URL)
    throw Error("Pairshot regression requires the dedicated private-LAN UAT configuration");
  const origin = new URL(baseURL).origin;
  const dbUrl = new URL(process.env.DATABASE_URL!);
  if (origin !== "http://192.168.43.70:3246" || origin !== new URL(process.env.DESTINY_PUBLIC_URL).origin || !["localhost", "127.0.0.1"].includes(dbUrl.hostname) || dbUrl.pathname !== "/destinylab_520_uat_test")
    throw Error("Only the dedicated local screenshot UAT is allowed");
  const activity = `pairshot520-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const folder = `${evidence}/${activity}`;
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  for (const person of people) mkdirSync(`${folder}/${person.gender}`, { mode: 0o700 });
  const contexts: BrowserContext[] = [];
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 5000 });
  const shots: Shot[] = [];
  const result: Record<string, unknown> = {
    activity, origin, buildId: readFileSync(`${process.env.DIST_DIR || ".next-520-uat"}/BUILD_ID`, "utf8").trim(),
    startedAt: new Date().toISOString(), screenshots: shots,
    evidenceBoundary: "Chromium mobile emulation, 390x844 CSS pixels, touch, DPR2. All participant actions use real H5 UI. Empty activity preparation and operator login are not user UI actions. No physical phone/WeChat/production acceptance.",
  };
  const api = (name: string, audience = "operator") => `/api/live/${name}?activity=${activity}&audience=${audience}`;
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
  const shot = async (page: Page, owner: number, title: string, action: string) => {
    const sequence = shots.filter((item) => item.owner === owner).length + 1;
    const file = `${people[owner].gender}/${String(sequence).padStart(2, "0")}.png`;
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(Array.from(document.images).map(async (img) => {
        if (!img.complete) await new Promise<void>((resolve) => {
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
        });
      }));
      window.scrollTo(0, 0);
    });
    await page.screenshot({ path: `${folder}/${file}`, fullPage: true, animations: "disabled" });
    shots.push({ owner, sequence, title, action, file });
  };
  try {
    const now = Date.now();
    const initial = {
      schema: 1, epoch: randomUUID(), revision: 0, now, wallAt: now, scenario: "live", activityPaused: false,
      participants: [], invitations: [], helps: [], merchants: [], events: [], scans: [], responses: {}, merchantViews: [], commands: [], broadcastConsumed: [], tongzhouSubmissions: [], displayQuestionId: "q1", displayGrants: {},
      points: defaultMeetPoints(),
    };
    await pool.query("INSERT INTO dl_activities(id,state) VALUES($1,$2::jsonb)", [activity, JSON.stringify(initial)]);
    adminContext = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
    contexts.push(adminContext);
    const login = JSON.parse(readFileSync(process.env.DESTINY_LIVE_TEST_LOGIN!, "utf8"));
    const loggedIn = await adminContext.request.post(api("login"), { headers: { Origin: origin }, data: login });
    expect(loggedIn.status()).toBe(200);
    const admin = await adminContext.newPage();
    await admin.goto(`/admin/dashboard?activity=${activity}`);
    const pointRow = admin.getByRole("row").filter({ has: admin.getByText("Meet01", { exact: true }) });
    const location = "合成UAT·入口右侧桂花树旁";
    await pointRow.getByLabel("现场位置").fill(location);
    await pointRow.getByLabel("容量（对）").fill("1");
    await pointRow.getByRole("button", { name: "保存配置" }).click();
    await expect.poll(async () => (await operator()).points.find((p) => p.name === "Meet01")?.location).toBe(location);

    const userContexts = await Promise.all(people.map(() => browser.newContext({
      baseURL, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
      isMobile: true, hasTouch: true, reducedMotion: "reduce",
    })));
    contexts.push(...userContexts);
    const pages = await Promise.all(userContexts.map((context) => context.newPage()));
    for (const [index, person] of people.entries()) {
      const page = pages[index];
      await page.goto(`/mobile/01-start?activity=${activity}`);
      await expect(page.getByRole("button", { name: /一起逛逛/ })).toBeEnabled();
      await shot(page, index, "进入活动，回答第1题", "选择「一起逛逛」，从一个共同话题开始。");
      await page.getByRole("button", { name: /一起逛逛/ }).click();
      await expect(page.getByRole("button", { name: "看看现场还有谁和我一样" })).toBeVisible();
      await shot(page, index, "看到同题结果", "已保存第1题，点击「看看现场还有谁和我一样」。");
      await page.getByRole("button", { name: "看看现场还有谁和我一样" }).click();
      await page.getByLabel("怎么称呼你？").fill(person.name);
      if (person.gender === "female") await page.getByRole("button", { name: "女生", exact: true }).click();
      await page.getByRole("button", { name: AGES[1], exact: true }).click();
      await page.getByRole("button", { name: "可以，现在就能见面" }).click();
      await page.getByRole("radio", { name: `${person.label}虚拟头像 ${person.avatar}` }).check();
      await shot(page, index, "填写资料，愿意见面", `昵称${person.name}，26–29岁，选择系统头像，勾选「可以，现在就能见面」，点击「继续答题」。`);
      await page.getByRole("button", { name: "继续答题", exact: true }).click();
      for (const [questionIndex, question] of QUESTIONS.slice(1).entries()) {
        await expect(page.getByRole("heading", { name: question.title, exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: question.options[0], exact: true })).toBeEnabled();
        await shot(page, index, `第${questionIndex + 2}题：${question.short}`, `点击「${question.options[0]}」，答案保存后进入下一步。`);
        await page.getByRole("button", { name: question.options[0], exact: true }).click();
      }
      await expect(page).toHaveURL(/05-discover/);
    }
    const identities = await Promise.all(userContexts.map(mine));
    const actors = identities.map((identity) => identity.actor);
    expect(new Set(actors).size).toBe(2);
    let state = await operator();
    expect(state.participants).toHaveLength(2);
    expect(state.participants.filter((p) => p.gender === "male")).toHaveLength(1);
    expect(state.participants.filter((p) => p.gender === "female")).toHaveLength(1);
    for (const p of state.participants) expect(QUESTIONS.every((q) => !!p.answers[q.id])).toBe(true);
    for (const [index, page] of pages.entries()) {
      const card = page.locator(".recommend-card").filter({ has: page.getByRole("heading", { name: people[1 - index].name, exact: true }) });
      await expect(card).toBeVisible();
      await shot(page, index, "六题完成，发现对方", `推荐清单出现${people[1 - index].name}；点击「看看共同答案」。`);
      await card.getByRole("button", { name: "看看共同答案" }).click();
      await expect(page.getByRole("button", { name: "想认识 TA", exact: true })).toBeVisible();
      await shot(page, index, "查看共同答案", index === 0 ? "男生决定邀请女生，点击「想认识 TA」。" : "女生查看男生的共同答案，稍后接收他的邀请。");
      if (index === 1) {
        await page.getByRole("button", { name: "返回", exact: true }).click();
        await expect(page).toHaveURL(/05-discover/);
      }
    }
    await pages[0].getByRole("button", { name: "想认识 TA", exact: true }).click();
    await expect(pages[0].getByRole("dialog")).toBeVisible();
    await shot(pages[0], 0, "确认发出邀请", "在确认弹窗点击「发出邀请」。此时尚未生成相遇码。");
    await pages[0].getByRole("dialog").getByRole("button", { name: "发出邀请", exact: true }).click();
    await expect(pages[0].getByRole("heading", { name: "等待 星宁 回应", exact: true })).toBeVisible();
    await shot(pages[0], 0, "邀请已发出，等待星宁回应", "发送成功，等待对方主动同意；单方邀请不生成码。");
    state = await operator();
    expect(state.invitations).toHaveLength(1);
    expect(state.invitations[0].status).toBe("SENT");
    expect(state.invitations[0].encounterCodes).toBeUndefined();
    expect(state.invitations[0].code).toBe("");

    await pages[1].getByRole("link", { name: /查看你的相遇任务/ }).click();
    await expect(pages[1].getByRole("button", { name: "确认认识", exact: true })).toBeVisible();
    await shot(pages[1], 1, "收到云川的邀请", "看清昵称和共同话题，愿意后点击「确认认识」。");
    await pages[1].getByRole("button", { name: "确认认识", exact: true }).click();
    await expect(pages[0]).toHaveURL(/08-mutual/);
    const codes: string[] = [];
    for (const [index, page] of pages.entries()) {
      await expect(page).toHaveURL(/08-mutual/);
      const snapshot = await mine(userContexts[index]);
      const invitation = snapshot.state.invitations[0];
      expect(Object.keys(invitation.encounterCodes!)).toEqual([actors[index]]);
      const code = invitation.encounterCodes![actors[index]];
      expect(code).toMatch(/^\d{3}$/);
      codes.push(code);
      await expect(page.locator(".mutual-code-copy")).toContainText(code);
      await expect(page.getByRole("region", { name: "你的相遇地点" })).toContainText("Meet 01");
      await expect(page.locator(".mutual-place-copy")).toContainText(location);
      await expect(page.locator(".mutual-code-copy")).toContainText("???");
      await expect(page.getByTestId("own-encounter-code")).toContainText(code);
      await shot(page, index, "双方愿意见面，自动获得地点和个人码", `本人的码为${code}，前往 Meet 01（${location}）；对方码保持隐藏。`);
      await page.reload();
      await expect(page.locator(".mutual-code-copy")).toContainText(code);
      const restored = await mine(userContexts[index]);
      expect(restored.actor).toBe(actors[index]);
      expect(restored.state.invitations[0].encounterCodes![actors[index]]).toBe(code);
      expect(restored.state.invitations[0].pointId).toBe("meet-1");
      await expect(page.getByRole("button", { name: "我已遇见 TA", exact: true })).toBeEnabled();
    }
    expect(new Set(codes).size).toBe(2);
    expect(Number(codes[0]) + Number(codes[1])).toBe(520);
    result.people = people.map((person, index) => ({ ...person, code: codes[index], point: "Meet01", location }));
    expect((await world()).totalMeetings).toBe(0);

    await pages[0].getByRole("button", { name: "我已遇见 TA", exact: true }).click();
    await expect(pages[0]).toHaveURL(/10-next-step/);
    await expect(pages[0].getByText("已记录你的这次相遇。接下来，想怎样继续？")).toBeVisible();
    expect((await world()).totalMeetings).toBe(0);
    const maleOnly = await operator();
    expect(maleOnly.invitations[0].confirmations[actors[0]]).toBeTruthy();
    expect(maleOnly.invitations[0].confirmations[actors[1]]).toBeUndefined();
    expect(maleOnly.invitations[0].departures).toEqual({});
    expect(maleOnly.invitations[0].arrivals).toEqual({});
    expect(maleOnly.invitations[0].realMeetAt).toBeUndefined();
    await shot(pages[0], 0, "男生记录自己的相遇", "男生点击「我已遇见 TA」后直接进入下一站；女生仍可独立记录。");
    await expect(pages[1]).toHaveURL(/08-mutual/);
    await shot(pages[1], 1, "女生独立查看相遇指引", "女生可查看自己的地点和个人码，随后独立点击「我已遇见 TA」。");
    await pages[1].getByRole("button", { name: "我已遇见 TA", exact: true }).click();
    await expect(pages[1]).toHaveURL(/10-next-step/);
    await expect(pages[1].getByText("已记录你的这次相遇。接下来，想怎样继续？")).toBeVisible();
    await expect.poll(async () => (await world()).totalMeetings).toBe(1);
    for (const [index, page] of pages.entries()) {
      await page.reload();
      await expect(page).toHaveURL(/10-next-step/);
      await expect(page.getByText("已记录你的这次相遇。接下来，想怎样继续？")).toBeVisible();
      await shot(page, index, "相遇已记录，进入下一站", "个人记录在刷新后保留；两人都完成记录后，双方相遇计数为1。");
    }
    expect((await world()).totalMeetings).toBe(1);
    state = await operator();
    expect(state.invitations[0].status).toBe("CONFIRMED");
    await admin.goto(`/admin/participants?activity=${activity}`);
    await admin.getByLabel("筛选参与阶段").selectOption("all");
    await expect(admin.getByText("共 2 人", { exact: true })).toBeVisible();
    await admin.screenshot({ path: `${folder}/admin-participants.png`, fullPage: true, animations: "disabled" });
    await admin.goto(`/admin/encounters?activity=${activity}`);
    await expect(admin.locator(".encounter-card")).toHaveCount(1);
    await admin.screenshot({ path: `${folder}/admin-encounter.png`, fullPage: true, animations: "disabled" });
    result.adminUrl = `${origin}/admin/encounters?activity=${activity}`;
    result.startUrl = `${origin}/mobile/01-start?activity=${activity}`;
    result.finalMeetingCount = 1;
    result.status = "PASS";
    result.assertions = ["two isolated new actors, one male and one female", "all six answers submitted through UI", "no codes before acceptance", "private personal three-digit codes with peer code hidden", "automatic same Meet01 and configured location", "identity/code/location stable after reload", "each actor independently enters next-step after own confirmation", "meeting count remains0 after one personal record and becomes1 after both", "admin2 people and1 confirmed task"];
    const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>云川与星宁 · 双人手机相遇旅程</title><style>
      *{box-sizing:border-box}body{margin:0;background:#f5efe6;color:#302723;font:16px/1.7 system-ui,-apple-system,sans-serif}header,main,footer{max-width:1120px;margin:auto;padding:28px}header{padding-top:48px}h1{font-size:32px;margin:0 0 8px;color:#781f31}h2{margin:0}p{margin:8px 0}.info{background:#fffaf4;border:1px solid #ddcfc1;border-radius:18px;padding:20px;margin:20px 0}nav{display:flex;gap:20px;flex-wrap:wrap}a{color:#781f31}main{display:grid;grid-template-columns:1fr 1fr;gap:28px;padding-top:0}.person{min-width:0}.person-title{position:sticky;top:0;background:#f5efe6ee;backdrop-filter:blur(8px);padding:16px 0;z-index:1}.card{background:#fffaf4;border:1px solid #ddcfc1;border-radius:20px;padding:18px;margin-bottom:24px}.card h3{font-size:18px;margin:0}.card p{color:#73665d;font-size:14px}.card img{display:block;width:100%;height:auto;border-radius:12px;border:1px solid #e2d5c9;margin-top:14px}.tag{font-size:13px;color:#73665d}.code{font-size:26px;font-weight:700;color:#781f31}footer{font-size:13px;color:#73665d}@media(max-width:720px){main{grid-template-columns:1fr}header,main,footer{padding:20px}h1{font-size:26px}}
      </style><header><p class="tag">本地UAT · 2026-10-27 · Playwright真实页面操作</p><h1>云川与星宁的相遇旅程</h1><p>一个男生主动邀请，一个女生确认认识，一起前往自动分配的相遇点。</p><div class="info"><div class="code">云川 ${codes[0]} ＋ 星宁 ${codes[1]} ＝ 520</div><p>自动地点：Meet01 · ${escape(location)}（合成测试位置）</p><p>两人均完成六题与实际见面确认，后台为2人、1条已确认任务，相遇计数为1。</p><nav><a href="#male">查看男生完整流程（${shots.filter((s) => s.owner === 0).length}张）</a><a href="#female">查看女生完整流程（${shots.filter((s) => s.owner === 1).length}张）</a><a href="${escape(String(result.adminUrl))}">UAT后台任务</a><a href="result.json">核验结果</a></nav></div><p class="tag">390×844手机视口、触摸、2倍像素；全页截图可点击查看原图。模拟的是页面操作，未代替真实扫码、实体手机、微信或现场验收。</p></header><main>${people.map((person, owner) => `<section class="person" id="${person.gender}"><div class="person-title"><h2>${person.label} · ${person.name}</h2><span class="tag">系统头像 · 独立浏览器身份</span></div>${shots.filter((s) => s.owner === owner).map((s) => `<article class="card"><h3>${String(s.sequence).padStart(2, "0")} · ${escape(s.title)}</h3><p>${escape(s.action)}</p><a href="${s.file}" target="_blank" rel="noopener"><img src="${s.file}" alt="${escape(person.name + "：" + s.title)}" loading="lazy" width="780"></a></article>`).join("")}</section>`).join("")}</main><footer>活动：${activity}<br>候选：${escape(String(result.buildId))}<br>空白活动准备与管理员登录用于测试准备，参与者、答题、邀请和见面动作均由H5 UI产生。全部人物及地点为虚构；图册不含登录凭据。截图按人物各自操作顺序排列，两列不表示逐行同步。</footer></html>`;
    writeFileSync(`${folder}/index.html`, html, { mode: 0o600 });
  } catch (error) {
    result.status = "FAIL";
    result.error = error instanceof Error ? error.message.replace(/[A-Za-z0-9_-]{43}/g, "[REDACTED_TOKEN]") : "Unknown failure";
    throw error;
  } finally {
    result.finishedAt = new Date().toISOString();
    result.testStatus = testInfo.status;
    writeFileSync(`${folder}/result.json`, JSON.stringify(result, null, 2), { mode: 0o600 });
    await Promise.allSettled(contexts.map((context) => context.close()));
    await pool.end();
  }
});
