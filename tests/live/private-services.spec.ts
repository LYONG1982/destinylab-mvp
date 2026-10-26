import {
  test,
  expect,
  type BrowserContext,
  type APIRequestContext,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { Pool } from "pg";
import { AGES, QUESTIONS } from "../../src/data/questions";
import {
  emptyTongzhouProfile,
  TONGZHOU_CONSENT_VERSION,
} from "../../src/domain/tongzhou";
const origin = "http://127.0.0.1:3212";
let activity: string;
const proof = "/private/tmp/destinylab-tongzhou-avatar-20261011";
const route = (path: string) =>
  `${path}${path.includes("?") ? "&" : "?"}activity=${activity}`;
async function post(
  request: APIRequestContext,
  path: string,
  body: unknown,
  id = randomUUID(),
) {
  return request.post(route(path), {
    headers: { Origin: origin, "Idempotency-Key": id },
    data: body,
  });
}
async function join(context: BrowserContext, name = "测试甲", gender = "male") {
  const joined = await post(context.request, "/api/live/session", {});
  expect(joined.status()).toBe(200);
  const s = await joined.json();
  await command(context, s.state.epoch, {
    type: "answer",
    questionId: "q1",
    value: QUESTIONS[0].options[0],
  });
  await command(context, s.state.epoch, {
    type: "profile",
    name,
    gender,
    avatarId: gender === "male" ? "male_01" : "female_01",
    age: AGES[1],
    ready: true,
  });
  return s;
}
async function command(
  c: BrowserContext,
  epoch: string,
  command: unknown,
  path = "/api/live/command?audience=participant",
  id = randomUUID(),
) {
  const r = await post(c.request, path, { epoch, command }, id);
  expect(r.status(), await r.text()).toBe(200);
  return r.json();
}
const fields = {
  ...emptyTongzhouProfile(),
  realName: "虚构甲",
  phone: "13800000000",
  gender: "男",
  birthYear: "1995",
  city: "测试市",
  ethnicity: "汉族",
  maritalStatus: "未婚",
};
test.beforeEach(async () => {
  activity = `private-${randomUUID().slice(0, 12)}`;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const r = await pool.query(
      "SELECT state FROM dl_activities WHERE id='private-preview'",
    );
    const state = { ...r.rows[0].state, epoch: randomUUID() };
    await pool.query("INSERT INTO dl_activities(id,state) VALUES($1,$2)", [
      activity,
      JSON.stringify(state),
    ]);
  } finally {
    await pool.end();
  }
  mkdirSync(proof, { recursive: true });
});
test("real submission, role boundaries, retries, agency withdrawal and return to original question", async ({
  browser,
}) => {
  const phone = await browser.newContext({
      baseURL: origin,
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    }),
    agency = await browser.newContext({ baseURL: origin }),
    stranger = await browser.newContext({ baseURL: origin });
  try {
    const s = await join(phone);
    const epoch = s.state.epoch;
    const other = await join(stranger, "测试乙", "female");
    const page = await phone.newPage();
    await page.goto(route("/mobile/04-question"));
    for (const width of [320, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(
        page.getByRole("link", { name: "申请同舟专业婚恋服务" }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: `${proof}/question-entry.png`,
      fullPage: true,
    });
    await page.getByRole("link", { name: "申请同舟专业婚恋服务" }).click();
    await page.locator("#tongzhou-realName").fill(fields.realName);
    await page.locator("#tongzhou-phone").fill(fields.phone);
    await page.locator("#tongzhou-birthYear").fill(fields.birthYear);
    await page.locator("#tongzhou-city").fill(fields.city);
    await page.locator("#tongzhou-ethnicity").fill(fields.ethnicity);
    await page
      .locator("#tongzhou-maritalStatus")
      .selectOption(fields.maritalStatus);
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByRole("link", { name: "返回继续答题" }).first().click();
    await expect(page).toHaveURL(/tongzhou/);
    await expect(page.locator("#tongzhou-realName")).toHaveValue(
      fields.realName,
    );
    await expect(
      page.getByRole("button", { name: "确认授权并提交资料" }),
    ).toBeDisabled();
    await page.locator(".tongzhou-consent input").check();
    await page.getByRole("button", { name: "确认授权并提交资料" }).click();
    await expect(
      page.getByRole("heading", { name: "资料已提交" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "返回继续答题" }).last().click();
    await expect(page.locator(".question-transition")).toHaveAttribute(
      "data-question",
      "q2",
    );
    await page.locator(".answer-card").first().click();
    await expect(page.locator(".question-transition")).toHaveAttribute(
      "data-question",
      "q3",
    );
    await page.getByRole("button", { name: "返回上一题" }).click();
    await expect(page.locator(".question-transition")).toHaveAttribute(
      "data-question",
      "q2",
    );
    await page.getByRole("link", { name: "查看我的填报" }).click();
    await page.getByRole("link", { name: "返回继续答题" }).last().click();
    await expect(page.locator(".question-transition")).toHaveAttribute(
      "data-question",
      "q2",
    );
    expect(
      (await stranger.request.get(route("/api/tongzhou/records"))).status(),
    ).toBe(401);
    const otherState = await (
      await stranger.request.get(
        route("/api/live/snapshot?audience=participant"),
      )
    ).json();
    expect(otherState.state.tongzhouSubmissions).toEqual([]);
    expect(JSON.stringify(otherState)).not.toContain(fields.phone);
    const admin = await browser.newContext({ baseURL: origin });
    const login = JSON.parse(
      readFileSync(process.env.DESTINY_LIVE_TEST_LOGIN!, "utf8"),
    );
    expect((await post(admin.request, "/api/live/login", login)).status()).toBe(
      200,
    );
    expect(
      (await admin.request.get(route("/api/tongzhou/records"))).status(),
    ).toBe(401);
    expect(
      await (
        await admin.request.get(route("/api/live/snapshot?audience=operator"))
      ).text(),
    ).not.toContain(fields.phone);
    await admin.close();
    const ap = await agency.newPage();
    await ap.goto(route("/agency/tongzhou"));
    const account = JSON.parse(
      readFileSync(process.env.DESTINY_AGENCY_TEST_LOGIN!, "utf8"),
    );
    await ap.getByLabel("账号", { exact: true }).fill(account.username);
    await ap.getByLabel("密码", { exact: true }).fill(account.password);
    await ap.getByRole("button", { name: "登录机构后台" }).click();
    await expect(ap.getByText(fields.realName, { exact: true })).toBeVisible();
    const list = await (
      await agency.request.get(route("/api/tongzhou/records"))
    ).text();
    expect(list).not.toContain(fields.phone);
    expect(list).toContain("138****0000");
    await ap.getByText(fields.realName, { exact: true }).click();
    await expect(ap.getByText(fields.phone, { exact: true })).toBeVisible();
    await ap.screenshot({ path: `${proof}/agency-record.png`, fullPage: true });
    const update = {
      type: "tongzhou-submit",
      fields: { ...fields, city: "新测试市" },
      consent: true,
      consentVersion: TONGZHOU_CONSENT_VERSION,
      expectedVersion: 1,
    };
    const id = randomUUID();
    await command(phone, epoch, update, "/api/tongzhou/command", id);
    await command(phone, epoch, update, "/api/tongzhou/command", id);
    expect(
      (
        await post(phone.request, "/api/tongzhou/command", {
          epoch,
          command: update,
        })
      ).status(),
    ).toBe(409);
    expect(
      (
        await post(stranger.request, "/api/tongzhou/command", {
          epoch: other.state.epoch,
          command: { ...update, actor: s.actor },
        })
      ).status(),
    ).toBe(400);
    await command(
      phone,
      epoch,
      { type: "tongzhou-withdraw", expectedVersion: 2 },
      "/api/tongzhou/command",
    );
    await expect(ap.getByText(fields.phone, { exact: true })).toHaveCount(0);
    expect(
      (
        await agency.request.get(route(`/api/tongzhou/records?id=${s.actor}`))
      ).status(),
    ).toBe(404);
    await command(
      phone,
      epoch,
      { type: "tongzhou-delete", expectedVersion: 3 },
      "/api/tongzhou/command",
    );
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const r = await pool.query(
        "SELECT record FROM dl_tongzhou_submissions WHERE activity_id=$1 AND actor=$2",
        [activity, s.actor],
      );
      expect(r.rows[0].record.fields).toBeNull();
      const raw = await pool.query(
        "SELECT state FROM dl_activities WHERE id=$1",
        [activity],
      );
      expect(JSON.stringify(raw.rows)).not.toContain(fields.phone);
      const ledger = await pool.query(
        "SELECT payload FROM dl_commands WHERE activity_id=$1",
        [activity],
      );
      expect(JSON.stringify(ledger.rows)).not.toContain(fields.phone);
    } finally {
      await pool.end();
    }
    await ap.getByRole("button", { name: "退出登录" }).click();
    await expect(
      ap.getByRole("button", { name: "登录机构后台" }),
    ).toBeVisible();
  } finally {
    await phone.close();
    await agency.close();
    await stranger.close();
  }
});
test("system avatars persist and custom-photo endpoints remain closed", async ({
  browser,
}) => {
  const phone = await browser.newContext({
    baseURL: origin,
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  try {
    const joined = await join(phone),
      page = await phone.newPage();
    await page.goto(route("/mobile/04-question"));
    await page.getByRole("button", { name: "更换头像", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator('input[type="file"]')).toHaveCount(0);
    await expect(
      dialog.getByRole("button", { name: "从相册选择照片" }),
    ).toHaveCount(0);
    await dialog.getByRole("radio", { name: "男生虚拟头像 04" }).check();
    await dialog.getByRole("button", { name: "确认使用" }).click();
    await expect(dialog).toHaveCount(0);
    await page.reload();
    const snap = await (
      await phone.request.get(route("/api/live/snapshot?audience=participant"))
    ).json();
    const me = snap.state.participants.find(
      (p: { id: string }) => p.id === joined.actor,
    );
    expect(me.avatarId).toBe("male_04");
    expect(me.photo).toBeNull();
    const uploaded = await phone.request.post(route("/api/avatar/upload"), {
      headers: { Origin: origin, "Content-Type": "image/png" },
      data: Buffer.from("synthetic"),
    });
    expect(uploaded.status()).toBe(403);
    const photo = randomUUID();
    expect((await phone.request.get(`/api/avatar/${photo}`)).status()).toBe(
      404,
    );
    expect(
      (await phone.request.get(`/api/avatar/${photo}?screen=1`)).status(),
    ).toBe(404);
    const bound = await post(phone.request, "/api/avatar/command", {
      epoch: joined.state.epoch,
      command: {
        type: "avatar",
        assetId: photo,
        avatarId: "male_04",
        allowScreen: true,
        expectedVersion: 1,
      },
    });
    expect(bound.status()).toBe(403);
  } finally {
    await phone.close();
  }
});
test("first profile uses a system avatar without losing progress", async ({
  browser,
}) => {
  const phone = await browser.newContext({
    baseURL: origin,
    viewport: { width: 320, height: 844 },
    reducedMotion: "reduce",
  });
  try {
    const joined = await (
      await post(phone.request, "/api/live/session", {})
    ).json();
    await command(phone, joined.state.epoch, {
      type: "answer",
      questionId: "q1",
      value: QUESTIONS[0].options[1],
    });
    const p = await phone.newPage();
    await p.goto(route("/mobile/03-profile"));
    await p.getByLabel("怎么称呼你？").fill("测试女生");
    await p.getByRole("button", { name: AGES[1], exact: true }).click();
    await p.getByRole("button", { name: "女生", exact: true }).click();
    await p.getByRole("radio", { name: "女生虚拟头像 04" }).check();
    await expect(p.locator('input[type="file"]')).toHaveCount(0);
    await p.getByRole("button", { name: "继续答题" }).click();
    await expect(p).toHaveURL(/04-question/);
    await expect(p.locator(".question-transition")).toHaveAttribute(
      "data-question",
      "q2",
    );
    const snap = await (
      await phone.request.get(route("/api/live/snapshot?audience=participant"))
    ).json();
    const me = snap.state.participants.find(
      (x: { id: string }) => x.id === joined.actor,
    );
    expect(me.gender).toBe("female");
    expect(me.avatarId).toMatch(/^female_/);
    expect(me.photo).toBeNull();
    expect(me.answers.q1).toBe(QUESTIONS[0].options[1]);
    if (process.env.DESTINY_PRIVATE_RESTART_DIR) {
      await command(
        phone,
        joined.state.epoch,
        {
          type: "tongzhou-submit",
          fields,
          consent: true,
          consentVersion: TONGZHOU_CONSENT_VERSION,
          expectedVersion: 0,
        },
        "/api/tongzhou/command",
      );
      const dir = process.env.DESTINY_PRIVATE_RESTART_DIR;
      await phone.storageState({ path: `${dir}/restart-browser.json` });
      writeFileSync(
        `${dir}/restart-expected.json`,
        JSON.stringify({ activity, actor: joined.actor, photo: null, fields }),
        { mode: 0o600 },
      );
    }
  } finally {
    await phone.close();
  }
});
