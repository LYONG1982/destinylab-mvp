import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Pool } from "pg";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { AGES, QUESTIONS } from "../../src/data/questions";
import { defaultMeetPoints } from "../../src/domain/meet-points";
import type { DemoState } from "../../src/domain/types";

const evidenceRoot = "docs/verification/2026-10-27-selfmeet";
const protocol = { "X-Destiny-Protocol": "520-v1" };
const people = [
  { gender: "male", role: "男生", name: "星河", avatar: "04" },
  { gender: "female", role: "女生", name: "晴禾", avatar: "06" },
] as const;
type Owner = "male" | "female" | "admin";
type Shot = {
  owner: Owner;
  sequence: number;
  title: string;
  action: string;
  file: string;
};

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown failure";
  return message
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[REDACTED_DATABASE_URL]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[REDACTED_TOKEN]");
}

function testActivityState(): DemoState {
  const now = Date.now();
  const points = defaultMeetPoints();
  points[0].capacity = undefined;
  points[0].location = "虚构测试地点·入口右侧";
  points[1].capacity = 2;
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
    points,
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

test("self-meet: two independent participants record and continue on their own", async ({ browser, baseURL }, testInfo) => {
  const expectedURL = process.env.DESTINY_PUBLIC_URL;
  const databaseURL = process.env.DATABASE_URL;
  const loginPath = process.env.DESTINY_LIVE_TEST_LOGIN;
  if (!baseURL || !expectedURL || !databaseURL || !loginPath)
    throw new Error("Self-meet gallery requires DESTINY_PUBLIC_URL, dedicated DATABASE_URL, and protected operator login fixture.");

  const base = new URL(baseURL);
  const configured = new URL(expectedURL);
  const database = new URL(databaseURL);
  if (
    base.origin !== configured.origin ||
    configured.protocol !== "http:" ||
    !((configured.hostname === "127.0.0.1" && configured.port === "3244") || (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(configured.hostname) && configured.port === "3246")) ||
    !["127.0.0.1", "localhost"].includes(database.hostname) ||
    database.pathname !== "/destinylab_520_uat_test"
  )
    throw new Error("Self-meet gallery only runs on the configured private LAN origin and exact local 520 test database.");

  const activity = `selfmeet520-${randomUUID().replaceAll("-", "").slice(0, 14)}`;
  const folder = join(evidenceRoot, activity);
  for (const owner of ["male", "female", "admin"] as const)
    mkdirSync(join(folder, owner), { recursive: true, mode: 0o700 });

  const buildPath = resolve(process.env.DESTINY_DIST_DIR || ".next-selfmeet-uat", "BUILD_ID");
  let buildId = "";
  const shots: Shot[] = [];
  const contexts: BrowserContext[] = [];
  const errors: string[] = [];
  const responsiveChecks: Record<string, unknown>[] = [];
  const result: Record<string, unknown> = {
    activity,
    origin: configured.origin,
    buildPath: `${process.env.DESTINY_DIST_DIR || ".next-selfmeet-uat"}/BUILD_ID`,
    startedAt: new Date().toISOString(),
    status: "RUNNING",
    screenshots: shots,
    responsiveChecks,
    evidenceBoundary: "Local H5 UAT in two isolated Chromium touch contexts at DPR 2. Fictional synthetic profiles and point location; no production, physical phone, or WeChat acceptance claim. No cookies or login fixture contents are saved in this report or gallery.",
  };
  const pool = new Pool({ connectionString: databaseURL, max: 2, connectionTimeoutMillis: 5000 });
  const api = (name: string, audience = "operator") =>
    `/api/live/${name}?activity=${encodeURIComponent(activity)}&audience=${audience}`;
  let adminContext: BrowserContext | undefined;
  let adminPage: Page | undefined;
  let actorIds: string[] = [];
  let encounterCodes: string[] = [];
  const testLocation = "虚构测试地点·入口右侧";

  const operatorSnapshot = async () => {
    if (!adminContext) throw new Error("Operator context is not ready.");
    const response = await adminContext.request.get(api("snapshot"));
    expect(response.status()).toBe(200);
    return (await response.json()).state as DemoState;
  };
  const worldSnapshot = async () => {
    if (!adminContext) throw new Error("Operator context is not ready.");
    const response = await adminContext.request.get(api("snapshot", "screen"));
    expect(response.status()).toBe(200);
    return (await response.json()).world as { totalMeetings: number };
  };
  const participantSnapshot = async (context: BrowserContext) => {
    const response = await context.request.get(api("snapshot", "participant"));
    expect(response.status()).toBe(200);
    return (await response.json()) as { actor: string; state: DemoState };
  };
  const recordShot = async (
    page: Page,
    owner: Owner,
    title: string,
    action: string,
  ) => {
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(
        Array.from(document.images).map(
          (image) =>
            image.complete
              ? Promise.resolve()
              : new Promise<void>((resolveImage) => {
                  image.addEventListener("load", () => resolveImage(), { once: true });
                  image.addEventListener("error", () => resolveImage(), { once: true });
                }),
        ),
      );
      window.scrollTo(0, 0);
    });
    const sequence = shots.filter((shot) => shot.owner === owner).length + 1;
    const file = `${owner}/${String(sequence).padStart(2, "0")}.png`;
    await page.screenshot({
      path: join(folder, file),
      fullPage: true,
      animations: "disabled",
    });
    shots.push({ owner, sequence, title, action, file });
  };
  const galleryHtml = (standalone: boolean) => {
    const imageSource = (shot: Shot) => {
      if (!standalone) return shot.file;
      return `data:image/png;base64,${readFileSync(join(folder, shot.file)).toString("base64")}`;
    };
    const cards = (owner: Owner, displayName: string) =>
      shots
        .filter((shot) => shot.owner === owner)
        .map((shot) => {
          const image = `<img src="${imageSource(shot)}" alt="${escapeHtml(`${displayName}：${shot.title}`)}" loading="lazy">`;
          const preview = standalone
            ? image
            : `<a href="${shot.file}" target="_blank" rel="noopener">${image}</a>`;
          return `<article class="card"><h3>${String(shot.sequence).padStart(2, "0")} · ${escapeHtml(shot.title)}</h3><p>${escapeHtml(shot.action)}</p>${preview}</article>`;
        })
        .join("");
    const codeMale = encounterCodes[0] || "—";
    const codeFemale = encounterCodes[1] || "—";
    const adminCards = shots
      .filter((shot) => shot.owner === "admin")
      .map((shot) => {
        const image = `<img src="${imageSource(shot)}" alt="${escapeHtml(shot.title)}" loading="lazy">`;
        const preview = standalone
          ? image
          : `<a href="${shot.file}" target="_blank" rel="noopener">${image}</a>`;
        return `<article class="card"><h3>${String(shot.sequence).padStart(2, "0")} · ${escapeHtml(shot.title)}</h3><p>${escapeHtml(shot.action)}</p>${preview}</article>`;
      })
      .join("");
    const admins = standalone ? "" : `<a href="双人相遇流程图册.html" download>下载单文件HTML</a> · <a href="${escapeHtml(`${configured.origin}/admin/encounters?activity=${activity}`)}">本地UAT后台</a> · <a href="result.json">结果JSON</a>`;
    const files = standalone ? "本文件内嵌所有截图，可离线查看。" : "单击截图可打开原始PNG。";
    const finalStatus = result.status === "PASS" ? "流程验收通过" : result.status === "FAIL" ? "验收未通过，展示已生成证据" : "验收进行中";
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>星河与晴禾 · 双人独立相遇图册</title><style>
      *{box-sizing:border-box}body{margin:0;background:#f5efe6;color:#302723;font:16px/1.7 system-ui,-apple-system,"PingFang SC",sans-serif}header,main,footer{max-width:1240px;margin:auto;padding:28px}header{padding-top:42px}h1{font-size:32px;margin:0 0 8px;color:#781f31}h2{margin:0}p{margin:8px 0}.info{background:#fffaf4;border:1px solid #ddcfc1;border-radius:18px;padding:20px;margin:20px 0}.links{display:flex;gap:16px;flex-wrap:wrap}a{color:#781f31}main{display:grid;grid-template-columns:1fr 1fr;gap:28px;padding-top:0}.person{min-width:0}.person-title{position:sticky;top:0;background:#f5efe6ed;backdrop-filter:blur(8px);padding:14px 0;z-index:1}.card{background:#fffaf4;border:1px solid #ddcfc1;border-radius:20px;padding:18px;margin-bottom:22px}.card h3{font-size:18px;margin:0}.card p{color:#73665d;font-size:14px}.card img{display:block;width:100%;height:auto;border-radius:12px;border:1px solid #e2d5c9;margin-top:14px}.tag{font-size:13px;color:#73665d}.code{font-size:25px;font-weight:700;color:#781f31}.admin{max-width:1240px;margin:20px auto;padding:24px 28px;border-top:1px solid #ddcfc1}.admin-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px}footer{font-size:13px;color:#73665d}@media(max-width:760px){main,.admin-grid{grid-template-columns:1fr}header,main,footer,.admin{padding:18px}h1{font-size:26px}}
      </style></head><body><header><p class="tag">本地H5 UAT · 2026-10-27 · ${escapeHtml(finalStatus)}</p><h1>星河与晴禾的双人相遇旅程</h1><p>两位新参与者分别完成六题；接受邀请后各自看到同一地点和本人的相遇码，单独记录本人相遇并进入下一站。</p><div class="info"><div class="code">星河 ${escapeHtml(codeMale)} ＋ 晴禾 ${escapeHtml(codeFemale)} ＝ 520</div><p>地点：Meet01 · ${escapeHtml(testLocation)}（虚构测试位置）</p><p>最终后台：2位参与者、1对双方已记录；男生先记录时双方统计仍为0。</p><p class="links"><a href="#male">男生流程（${shots.filter((shot) => shot.owner === "male").length}张）</a><a href="#female">女生流程（${shots.filter((shot) => shot.owner === "female").length}张）</a><a href="#admin">后台点位及双人状态（${shots.filter((shot) => shot.owner === "admin").length}张）</a>${admins}</p><p class="tag">${escapeHtml(files)} 报告只记录虚构姓名、相遇码、构建标识与验收结果；不包含登录凭据、Cookie或原始参与者ID。</p></div><p class="tag">手机触摸仿真：390×844 CSS像素、DPR 2；另检查320/375/390/430宽度及390×667短屏。浏览器仿真不代表实体手机、微信或现场验收。</p></header><main><section class="person" id="male"><div class="person-title"><h2>男生 · 星河</h2><span class="tag">系统头像 male_04 · 独立浏览器会话</span></div>${cards("male", "星河")}</section><section class="person" id="female"><div class="person-title"><h2>女生 · 晴禾</h2><span class="tag">系统头像 female_06 · 独立浏览器会话</span></div>${cards("female", "晴禾")}</section></main><section class="admin" id="admin"><h2>后台点位与配对记录</h2><p class="tag">验证30对新增默认值、软删除与编号保留、缺省容量补齐、双人/一对统计、占用删除保护。</p><div class="admin-grid">${adminCards}</div></section><footer>活动：${escapeHtml(activity)}<br>候选Build ID：${escapeHtml(buildId || "未读取") }<br>空活动准备、后台登录与查询用于测试准备和核验；入场、资料、回答、邀请、接受与个人相遇操作均由H5界面完成。所有人物与地点均为虚构。截图按每位参与者自己的时间顺序编号；两列不表示双方动作同时发生。</footer></body></html>`;
  };

  try {
    buildId = readFileSync(buildPath, "utf8").trim();
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(buildId))
      throw new Error("Isolated self-meet BUILD_ID is missing or malformed.");
    result.buildId = buildId;

    await pool.query("INSERT INTO dl_activities(id,state) VALUES($1,$2::jsonb)", [
      activity,
      JSON.stringify(testActivityState()),
    ]);

    adminContext = await browser.newContext({
      baseURL: configured.origin,
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    });
    contexts.push(adminContext);
    const login = JSON.parse(readFileSync(loginPath, "utf8"));
    const loggedIn = await adminContext.request.post(api("login"), {
      headers: { Origin: configured.origin },
      data: login,
    });
    expect(loggedIn.status()).toBe(200);

    const servedBuild = await adminContext.request.get(
      `${configured.origin}/_next/static/${buildId}/_buildManifest.js`,
    );
    expect(servedBuild.status()).toBe(200);
    adminPage = await adminContext.newPage();
    const observePageErrors = (page: Page) =>
      page.on("pageerror", (error) => errors.push(error.message));
    observePageErrors(adminPage);
    await adminPage.goto(`/admin/dashboard?activity=${activity}`);
    const pointPanel = adminPage
      .locator("section.panel")
      .filter({ has: adminPage.getByRole("heading", { name: "相遇点配置与状态" }) });
    await expect(pointPanel).toBeVisible();

    const initialState = await operatorSnapshot();
    expect(initialState.points.find((point) => point.name === "Meet01")?.capacity).toBeUndefined();
    expect(initialState.points.find((point) => point.name === "Meet02")?.capacity).toBe(2);
    const addForm = adminPage.locator(".add-meet-point-form");
    await expect(addForm.getByLabel("容量（对）")).toHaveValue("30");
    await expect(addForm.getByLabel("编号")).toHaveAttribute("placeholder", "Meet31");
    await addForm.getByLabel("现场位置").fill("虚构测试地点·廊架");
    await addForm.getByRole("button", { name: "新增点位", exact: true }).click();
    await expect.poll(async () => {
      const point = (await operatorSnapshot()).points.find((candidate) => candidate.name === "Meet31");
      return point ? [point.location, point.capacity, point.deletedAt] : null;
    }).toEqual(["虚构测试地点·廊架", 30, undefined]);
    await recordShot(adminPage, "admin", "新增相遇点，默认容量30对", "输入虚构现场位置后新增Meet31；服务端快照确认容量为30对。");

    const meet31Row = pointPanel.getByRole("row").filter({ hasText: "Meet31" });
    await expect(meet31Row.getByRole("button", { name: "删除", exact: true })).toBeEnabled();
    await meet31Row.getByRole("button", { name: "删除", exact: true }).click();
    const deleteDialog = adminPage.getByRole("dialog");
    await expect(deleteDialog).toContainText("Meet31");
    await deleteDialog.getByRole("button", { name: "确认操作", exact: true }).click();
    await expect.poll(async () => {
      const point = (await operatorSnapshot()).points.find((candidate) => candidate.name === "Meet31");
      return point?.deletedAt !== undefined;
    }).toBe(true);
    await expect(pointPanel.getByRole("row").filter({ hasText: "Meet31" })).toHaveCount(0);
    await expect(pointPanel.getByText("已删除点位历史 · 1 个")).toBeVisible();
    await expect(addForm.getByLabel("编号")).toHaveAttribute("placeholder", "Meet32");
    await recordShot(adminPage, "admin", "删除点位仍保留历史编号", "Meet31从活动清单移除，历史视图保留原位置；下一建议为Meet32。");

    const defaultsPreview = pointPanel.locator("section.point-capacity-defaults");
    await expect(defaultsPreview).toContainText("1 个未配置容量");
    await expect(defaultsPreview.locator("details")).toContainText("Meet01");
    await defaultsPreview.getByRole("button", { name: "应用缺省30对", exact: true }).click();
    const defaultsDialog = adminPage.getByRole("dialog");
    await expect(defaultsDialog).toContainText("Meet01");
    await defaultsDialog.getByRole("button", { name: "确认操作", exact: true }).click();
    await expect.poll(async () => {
      const snapshot = await operatorSnapshot();
      return [
        snapshot.points.find((point) => point.name === "Meet01")?.capacity,
        snapshot.points.find((point) => point.name === "Meet02")?.capacity,
      ];
    }).toEqual([30, 2]);
    await recordShot(adminPage, "admin", "缺省容量补齐且保留手工值", "Meet01从未配置变为30对；显式配置的Meet02仍为2对。");

    const userContexts = await Promise.all(
      people.map(() =>
        browser.newContext({
          baseURL: configured.origin,
          viewport: { width: 390, height: 844 },
          deviceScaleFactor: 2,
          isMobile: true,
          hasTouch: true,
          reducedMotion: "reduce",
        }),
      ),
    );
    userContexts.forEach((context) => contexts.push(context));
    const userPages = await Promise.all(userContexts.map((context) => context.newPage()));
    userPages.forEach(observePageErrors);

    const completeProfile = async (page: Page, index: 0 | 1) => {
      const profile = people[index];
      const q1Answer = QUESTIONS[0].options[0];
      await page.goto(`/mobile/01-start?activity=${activity}`);
      await expect(page.getByRole("heading", { name: /认真遇见一个人/ })).toBeVisible();
      await recordShot(page, profile.gender, "刚进入活动，等待回答第一题", "独立浏览器身份进入H5活动首页，选择自己的第一道题答案。");
      await page.getByRole("button", { name: new RegExp(q1Answer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).click();
      await expect(page.getByRole("button", { name: "看看现场还有谁和我一样" })).toBeVisible();
      await recordShot(page, profile.gender, "提交第1题并看到结果", `已保存第一题「${q1Answer}」，查看现场结果后继续完善资料。`);
      await page.getByRole("button", { name: "看看现场还有谁和我一样" }).click();
      await page.getByLabel("怎么称呼你？").fill(profile.name);
      if (profile.gender === "female")
        await page.getByRole("button", { name: "女生", exact: true }).click();
      await page.getByRole("button", { name: AGES[1], exact: true }).click();
      await page.getByRole("button", { name: "可以，现在就能见面", exact: true }).click();
      await page
        .getByRole("radio", { name: new RegExp(`${profile.role}虚拟头像 ${profile.avatar}`) })
        .check();
      await recordShot(page, profile.gender, "填写昵称、年龄与系统头像", `昵称${profile.name}，26–29岁，系统头像${profile.gender}_${profile.avatar}，选择现在方便认识新朋友。`);
      await page.getByRole("button", { name: "继续答题", exact: true }).click();
      for (const [offset, question] of QUESTIONS.slice(1).entries()) {
        await expect(page.getByRole("heading", { name: question.title, exact: true })).toBeVisible();
        await recordShot(page, profile.gender, `第${offset + 2}题：${question.short}`, `提交本题选项「${question.options[0]}」，进入下一题。`);
        await page.getByRole("button", { name: question.options[0], exact: true }).click();
      }
      await expect(page).toHaveURL(/05-discover/);
    };
    await Promise.all(userPages.map((page, index) => completeProfile(page, index as 0 | 1)));

    const identities = await Promise.all(userContexts.map(participantSnapshot));
    actorIds = identities.map((identity) => identity.actor);
    expect(new Set(actorIds).size).toBe(2);
    let state = await operatorSnapshot();
    expect(state.participants).toHaveLength(2);
    expect(state.participants.map((participant) => participant.name).sort()).toEqual(people.map(person => person.name).sort());
    expect(state.participants.filter((participant) => participant.gender === "male")).toHaveLength(1);
    expect(state.participants.filter((participant) => participant.gender === "female")).toHaveLength(1);
    for (const participant of state.participants)
      expect(QUESTIONS.every((question) => Boolean(participant.answers[question.id]))).toBe(true);

    for (const [index, page] of userPages.entries()) {
      const otherName = people[1 - index].name;
      const card = page
        .locator(".recommend-card")
        .filter({ has: page.getByRole("heading", { name: otherName, exact: true }) });
      await expect(card).toBeVisible();
      await recordShot(page, people[index].gender, "完成六题，发现另一位参与者", `推荐列表显示${otherName}；进入共同答案卡片。`);
      await card.getByRole("button", { name: "看看共同答案" }).click();
      await expect(page.getByRole("button", { name: "想认识 TA", exact: true })).toBeVisible();
      await recordShot(page, people[index].gender, "查看共同答案", `双方至少有一道相同答案；${index === 0 ? "男生准备发起邀请" : "女生先留在等待状态"}。`);
      if (index === 1) {
        await page.getByRole("button", { name: "暂时不了，看看其他人" }).click();
        await expect(page).toHaveURL(/05-discover/);
      }
    }

    const malePage = userPages[0];
    let femalePage = userPages[1];
    await malePage.getByRole("button", { name: "想认识 TA", exact: true }).click();
    const inviteDialog = malePage.getByRole("dialog");
    await expect(inviteDialog).toContainText("想认识");
    await recordShot(malePage, "male", "男生查看邀请确认弹窗", "确认发送给晴禾；邀请发出前不会提前生成相遇码。");
    await inviteDialog.getByRole("button", { name: "发出邀请", exact: true }).click();
    await expect(malePage.getByRole("heading", { name: "等待 晴禾 回应", exact: true })).toBeVisible();
    await recordShot(malePage, "male", "男生邀请已发出，等待女生选择", "邀请等待晴禾独立决定；等待阶段没有地点或相遇码。");
    state = await operatorSnapshot();
    expect(state.invitations).toHaveLength(1);
    expect(state.invitations[0].status).toBe("SENT");
    expect(state.invitations[0].encounterCodes).toBeUndefined();
    expect(state.invitations[0].code).toBe("");

    const waitingLink = femalePage.getByRole("link", { name: /查看你的相遇任务/ });
    await expect(waitingLink).toBeVisible();
    await waitingLink.click();
    await expect(femalePage.getByRole("button", { name: "确认认识", exact: true })).toBeVisible();
    await recordShot(femalePage, "female", "女生收到邀请并阅读共同话题", "女生自行确认是否认识星河；未替对方接受。");
    await femalePage.getByRole("button", { name: "确认认识", exact: true }).click();
    await expect(femalePage).toHaveURL(/08-mutual/);
    await expect(malePage).toHaveURL(/08-mutual/);

    const codeList: string[] = [];
    for (const [index, page] of userPages.entries()) {
      const guide = page.getByRole("region", { name: "相遇点指引" });
      await expect(guide).toBeVisible();
      const pointRegion = page.getByRole("region", { name: "你的相遇地点" });
      const ownCode = page.getByTestId("own-encounter-code");
      await expect(pointRegion).toContainText("Meet 01");
      await expect(pointRegion).toContainText(testLocation);
      await expect(ownCode).toHaveText(/^\d{3}$/);
      const code = (await ownCode.innerText()).trim();
      codeList.push(code);
      await expect(page.locator('[aria-label="对方相遇码隐藏"]')).toHaveText("???");
      for (const avatar of await page.locator(".mutual-person .avatar").all()) {
        const box = await avatar.boundingBox();
        expect(box).not.toBeNull();
        expect(Math.abs(box!.width - box!.height)).toBeLessThan(1);
      }
      const ownSnapshot = await participantSnapshot(userContexts[index]);
      expect(ownSnapshot.actor).toBe(actorIds[index]);
      expect(ownSnapshot.state.invitations).toHaveLength(1);
      const privateInvite = ownSnapshot.state.invitations[0];
      expect(Object.keys(privateInvite.encounterCodes || {})).toEqual([actorIds[index]]);
      expect(privateInvite.encounterCodes?.[actorIds[index]]).toBe(code);
      expect(privateInvite.pointId).toBe("meet-1");
      await recordShot(page, people[index].gender, "双方确认认识后获得地点与本人相遇码", `同一地点Meet01（${testLocation}），本人的相遇码为${code}；对方码保持隐藏。`);

      const guide08Text = await guide.innerText();
      await page.goto(`/mobile/09-meet?activity=${activity}`);
      await expect(page.getByRole("region", { name: "相遇点指引" })).toBeVisible();
      expect(await page.getByRole("region", { name: "相遇点指引" }).innerText()).toBe(guide08Text);
      const visibleGuideText = await page.locator("body").innerText();
      expect(visibleGuideText).not.toMatch(/确认出发|确认到达|我已到达|我已经到了|等待对方到达|等待 TA 到达/);
      await page.goto(`/mobile/08-mutual?activity=${activity}`);
      await expect(page.getByRole("region", { name: "相遇点指引" })).toBeVisible();

      for (const width of [320, 375, 390, 430]) {
        await page.setViewportSize({ width, height: 844 });
        const metrics = await page.evaluate(() => {
          const pointName = document.querySelector(
            '[aria-label="你的相遇地点"] > div:nth-of-type(2)',
          );
          return {
            viewport: window.innerWidth,
            scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
            fontPx: pointName ? Number.parseFloat(getComputedStyle(pointName).fontSize) : 0,
          };
        });
        expect(metrics.scrollWidth, `${people[index].gender} at ${width}px`).toBeLessThanOrEqual(width);
        expect(metrics.fontPx).toBeGreaterThanOrEqual(48);
        expect(metrics.fontPx).toBeLessThanOrEqual(56);
        responsiveChecks.push({ owner: people[index].gender, ...metrics, overflow: false });
      }
      await page.setViewportSize({ width: 390, height: 667 });
      const shortMetrics = await page.evaluate(() => ({
        viewport: window.innerWidth,
        height: window.innerHeight,
        scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      }));
      expect(shortMetrics.scrollWidth).toBeLessThanOrEqual(390);
      responsiveChecks.push({ owner: people[index].gender, ...shortMetrics, overflow: false });
      await page.setViewportSize({ width: 390, height: 844 });
      const aboveFold = await page.evaluate(() => {
        const location = document.querySelector(
          '[aria-label="你的相遇地点"] .mutual-place-copy',
        );
        const code = document.querySelector('[data-testid="own-encounter-code"]');
        return {
          locationBottom: location?.getBoundingClientRect().bottom ?? Number.POSITIVE_INFINITY,
          codeBottom: code?.getBoundingClientRect().bottom ?? Number.POSITIVE_INFINITY,
          height: window.innerHeight,
        };
      });
      expect(aboveFold.locationBottom).toBeLessThanOrEqual(aboveFold.height);
      expect(aboveFold.codeBottom).toBeLessThanOrEqual(aboveFold.height);
      result[`${people[index].gender}GuideAboveFold`] = aboveFold;
    }
    expect(new Set(codeList).size).toBe(2);
    expect(Number(codeList[0]) + Number(codeList[1])).toBe(520);
    for (const [index, page] of userPages.entries())
      await expect(page.getByRole("region", { name: "相遇点指引" })).not.toContainText(codeList[1 - index]);
    encounterCodes = codeList;
    result.people = people.map((person, index) => ({
      role: person.role,
      name: person.name,
      avatar: `${person.gender}_${person.avatar}`,
      ownCode: codeList[index],
      point: "Meet01",
      location: testLocation,
    }));
    expect((await worldSnapshot()).totalMeetings).toBe(0);

    await femalePage.getByRole("button", { name: "暂时不见面", exact: true }).click();
    const exitDialog = femalePage.getByRole("dialog");
    await expect(exitDialog).toContainText("结束这次相遇安排？");
    await recordShot(femalePage, "female", "打开暂时不见面的确认窗口", "只查看取消说明，不执行取消；点击继续后保留本次安排。");
    await exitDialog.getByRole("button", { name: "继续这次相遇", exact: true }).click();
    await expect(femalePage.getByRole("region", { name: "相遇点指引" })).toBeVisible();
    state = await operatorSnapshot();
    const invitationId = state.invitations[0].id;
    const occupiedPointId = state.invitations[0].pointId!;
    expect(state.invitations[0].departures).toEqual({});
    expect(state.invitations[0].arrivals).toEqual({});
    const occupiedRow = pointPanel.getByRole("row").filter({ hasText: "Meet01" });
    const removeOccupied = occupiedRow.getByRole("button", { name: "删除", exact: true });
    await expect(removeOccupied).toBeDisabled();
    await expect(occupiedRow).toContainText("请先结束相关安排");
    const rejectedRemove = await adminContext!.request.post(api("command"), {
      headers: {
        ...protocol,
        Origin: configured.origin,
        "Idempotency-Key": randomUUID(),
      },
      data: {
        epoch: state.epoch,
        command: { type: "point-remove", pointId: occupiedPointId },
      },
    });
    expect(rejectedRemove.status()).toBe(409);
    result.occupiedDelete = { uiDisabled: true, operatorCommandStatus: rejectedRemove.status() };

    await malePage.getByRole("button", { name: "我已遇见 TA", exact: true }).click();
    await expect(malePage).toHaveURL(/10-next-step/);
    await expect(malePage.getByRole("heading", { name: /相遇后的/ })).toBeVisible();
    await recordShot(malePage, "male", "男生记录本人相遇并立即进入下一站", "男生只提交一次本人相遇记录；无需女生确认即可进入自己的下一站。");
    state = await operatorSnapshot();
    expect(state.invitations[0].confirmations[actorIds[0]]).toEqual(expect.any(Number));
    expect(state.invitations[0].confirmations[actorIds[1]]).toBeUndefined();
    expect(state.invitations[0].status).not.toBe("CONFIRMED");
    expect((await worldSnapshot()).totalMeetings).toBe(0);
    result.firstRecord = { maleRecorded: true, femaleRecorded: false, pairCount: 0 };

    await femalePage.close();
    femalePage = await userContexts[1].newPage();
    userPages[1] = femalePage;
    observePageErrors(femalePage);
    await femalePage.goto(`/mobile/08-mutual?activity=${activity}`);
    await expect(femalePage.getByRole("region", { name: "相遇点指引" })).toBeVisible();
    await expect(femalePage.getByTestId("own-encounter-code")).toHaveText(codeList[1]);
    const femaleRestored = await participantSnapshot(userContexts[1]);
    expect(femaleRestored.actor).toBe(actorIds[1]);
    expect(femaleRestored.state.invitations[0].confirmations[actorIds[1]]).toBeUndefined();
    expect(Object.keys(femaleRestored.state.invitations[0].encounterCodes || {})).toEqual([actorIds[1]]);
    await recordShot(femalePage, "female", "女生关闭再打开后恢复自己的相遇指引", "女生的地点和本人码仍在；系统没有替她写入相遇记录。");

    await femalePage.getByRole("button", { name: "我已遇见 TA", exact: true }).click();
    await expect(femalePage).toHaveURL(/10-next-step/);
    await expect(femalePage.getByRole("heading", { name: /相遇后的/ })).toBeVisible();
    await recordShot(femalePage, "female", "女生独立记录本人相遇并进入下一站", "女生自己的记录保存后进入下一站，不需要男生再次操作。");
    await expect.poll(async () => (await worldSnapshot()).totalMeetings).toBe(1);
    state = await operatorSnapshot();
    const finalInvite = state.invitations.find((item) => item.id === invitationId)!;
    expect(finalInvite.status).toBe("CONFIRMED");
    expect(finalInvite.realMeetAt).toEqual(expect.any(Number));
    expect(finalInvite.confirmations[actorIds[0]]).toEqual(expect.any(Number));
    expect(finalInvite.confirmations[actorIds[1]]).toEqual(expect.any(Number));
    expect(finalInvite.departures).toEqual({});
    expect(finalInvite.arrivals).toEqual({});
    for (const [index, context] of userContexts.entries()) {
      const snapshot = await participantSnapshot(context);
      expect(snapshot.actor).toBe(actorIds[index]);
      expect(snapshot.state.invitations[0].confirmations[actorIds[index]]).toEqual(expect.any(Number));
      expect(Object.keys(snapshot.state.invitations[0].encounterCodes || {})).toEqual([actorIds[index]]);
    }
    await Promise.all(userContexts.map((context) => context.pages()[0].reload()));
    for (const page of userPages) {
      await expect(page).toHaveURL(/10-next-step/);
      await expect(page.getByRole("heading", { name: /相遇后的/ })).toBeVisible();
    }
    await recordShot(malePage, "male", "刷新后仍停留在男生的下一站", "刷新不会丢失男生自己的下一站进度。");
    await recordShot(femalePage, "female", "刷新后仍停留在女生的下一站", "刷新不会丢失女生自己的下一站进度。");

    await adminPage.goto(`/admin/participants?activity=${activity}`);
    await adminPage.getByLabel("筛选参与阶段").selectOption("all");
    await expect(adminPage.getByText("共 2 人", { exact: true })).toBeVisible();
    await recordShot(adminPage, "admin", "后台参与者列表显示两人", "独立的男生与女生记录均在后台参与者列表中。");
    await adminPage.goto(`/admin/encounters?activity=${activity}`);
    await expect(adminPage.locator(".encounter-card")).toHaveCount(1);
    await expect(adminPage.locator(".encounter-card")).toContainText("双方已记录");
    await recordShot(adminPage, "admin", "后台相遇卡片显示一对双方已记录", "一对配对只计一次；个人记录分别显示且配对状态为双方已记录。");

    result.adminUrl = `${configured.origin}/admin/encounters?activity=${activity}`;
    result.startUrl = `${configured.origin}/mobile/01-start?activity=${activity}`;
    result.final = {
      participantCount: state.participants.length,
      pairCount: state.invitations.filter((item) => Boolean(item.realMeetAt)).length,
      meetingCount: (await worldSnapshot()).totalMeetings,
      pointId: occupiedPointId,
      pointName: "Meet01",
      departures: Object.keys(finalInvite.departures).length,
      arrivals: Object.keys(finalInvite.arrivals).length,
    };
    result.assertions = [
      "dedicated private LAN origin and exact local test database guard",
      "isolated activity prepared with one legacy missing capacity and one explicit 2-pair capacity",
      "Meet31 added at 30 pairs, soft-deleted, kept in history, and Meet32 suggested next",
      "capacity backfill set only missing Meet01 to 30 and preserved Meet02 at 2",
      "two independent actors completed all six questions and met through the H5 UI",
      "the male and female participant projections each contain only their own 520 code",
      "08-mutual and 09-meet render equivalent guides with no departure or arrival actions",
      "responsive widths 320/375/390/430 and short 390x667 had no horizontal overflow",
      "male confirmation alone opened his next step and left female unrecorded with pair count zero",
      "female context reopen restored her guide and own code without a synthetic confirmation",
      "female independently recorded and both reloads restored next-step progress; pair count became one",
      "occupied Meet01 delete was disabled with a reason and operator API delete returned 409",
      "state retained empty legacy departure and arrival maps; admin showed 2 people and 1 pair",
    ];
    expect(errors, "participant and admin pages should not emit uncaught errors").toEqual([]);
    result.status = "PASS";
  } catch (error) {
    result.status = "FAIL";
    result.error = safeError(error);
    throw error;
  } finally {
    result.finishedAt = new Date().toISOString();
    result.testStatus = testInfo.status;
    result.pageErrors = errors.map((message) => safeError(new Error(message)));
    writeFileSync(join(folder, "result.json"), JSON.stringify(result, null, 2), { mode: 0o600 });
    writeFileSync(join(folder, "index.html"), galleryHtml(false), { mode: 0o600 });
    writeFileSync(join(folder, "双人相遇流程图册.html"), galleryHtml(true), { mode: 0o600 });
    await Promise.allSettled(contexts.map((context) => context.close()));
    await pool.end().catch(() => {});
  }
});
