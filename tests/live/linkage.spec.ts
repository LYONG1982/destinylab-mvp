import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { Pool } from "pg";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import { QUESTIONS } from "../../src/data/questions";
import type { LiveSnapshot } from "../../src/lib/api/live-types";
import type { Command } from "../../src/domain/types";

const origin = "http://127.0.0.1:3212";
let activity: string;
const login = () =>
  JSON.parse(readFileSync(process.env.DESTINY_LIVE_TEST_LOGIN!, "utf8"));
const url = (path: string, audience = "participant") =>
  `/api/live/${path}?activity=${activity}&audience=${audience}`;
async function read(
  request: APIRequestContext,
  role = "participant",
): Promise<LiveSnapshot> {
  const response = await request.get(url("snapshot", role));
  expect(response.status()).toBe(200);
  return response.json();
}
async function send(
  request: APIRequestContext,
  epoch: string,
  command: unknown,
  role = "participant",
  id = randomUUID(),
) {
  return request.post(url("command", role), {
    headers: { Origin: origin, "Idempotency-Key": id },
    data: { epoch, command },
  });
}
async function command(
  request: APIRequestContext,
  epoch: string,
  value: unknown,
  role = "participant",
  id = randomUUID(),
) {
  const response = await send(request, epoch, value, role, id);
  expect(response.status(), await response.text()).toBe(200);
  return response.json() as Promise<LiveSnapshot>;
}
test.beforeEach(async () => {
  activity = `test-${randomUUID().slice(0, 12)}`;
  const now = Date.now();
  const state = {
    schema: 1,
    epoch: randomUUID(),
    revision: 0,
    now,
    wallAt: now,
    scenario: "live",
    activityPaused: false,
    participants: [],
    invitations: [],
    points: [],
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
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(
      "INSERT INTO dl_activities(id,state) VALUES($1,$2::jsonb)",
      [activity, JSON.stringify(state)],
    );
  } finally {
    await pool.end();
  }
});

test("independent mobile journeys, operator, public screen, permission withdrawal and reconnect agree", async ({
  browser,
}) => {
  const contexts = await Promise.all(
    Array.from({ length: 4 }, () =>
      browser.newContext({
        baseURL: origin,
        viewport: { width: 390, height: 844 },
        reducedMotion: "reduce",
      }),
    ),
  );
  const [phoneA, phoneB, operator, display] = await Promise.all(
    contexts.map((c) => c.newPage()),
  );
  const errors: string[] = [];
  for (const page of [phoneA, phoneB, operator, display])
    page.on("pageerror", (e) => errors.push(e.message));
  // LAN HTTP lacks randomUUID on some browsers; exercise its getRandomValues fallback.
  await contexts[0].addInitScript(() =>
    Object.defineProperty(crypto, "randomUUID", {
      value: undefined,
      configurable: true,
    }),
  );
  try {
    await operator.setViewportSize({ width: 1440, height: 1024 });
    await display.setViewportSize({ width: 1920, height: 1080 });
    await operator.goto(`/admin/dashboard?activity=${activity}`);
    await operator.getByLabel("运营账号").fill(login().username);
    await operator.getByLabel("密码", { exact: true }).fill(login().password);
    await operator.getByRole("button", { name: "登录", exact: true }).click();
    await expect(operator.getByTestId("real-count")).toHaveText("0");
    await operator.getByText("题目统计与相遇点配置", { exact: true }).click();
    await operator.getByLabel("添加现场已设置的相遇点").fill("Meet01");
    await operator
      .getByRole("button", { name: "添加相遇点", exact: true })
      .click();
    await expect(operator.getByRole("group").getByRole("status")).toHaveText("相遇点已添加。");
    await display.goto(`/screen?activity=${activity}`);
    const world = display.getByTestId("destiny-world");
    await expect(world).toHaveAttribute("data-total", "0");
    const qr = display.getByTestId("world-qr").locator("img");
    await expect(qr).toBeVisible();
    const png = PNG.sync.read(
      Buffer.from((await qr.getAttribute("src"))!.split(",")[1], "base64"),
    );
    expect(
      jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data,
    ).toBe(`${origin}/mobile/01-start?activity=${activity}`);
    async function profile(page: Page, name: string, female: boolean) {
      await page.goto(`/mobile/01-start?activity=${activity}&actor=operator`);
      await page.getByRole("button", { name: /一起逛逛/ }).click();
      await page
        .getByRole("button", { name: "看看现场还有谁和我一样" })
        .click();
      await page.getByLabel("怎么称呼你？").fill(name);
      if (female)
        await page.getByRole("button", { name: "女生", exact: true }).click();
      await page.getByRole("button", { name: "26–29", exact: true }).click();
      await page.getByRole("button", { name: "可以，现在就能见面" }).click();
      await page
        .getByRole("radio", { name: `${female ? "女生" : "男生"}虚拟头像 03` })
        .check();
      await page.getByRole("button", { name: "继续答题" }).click();
      for (const question of QUESTIONS.slice(1))
        await page
          .getByRole("button", { name: question.options[0], exact: true })
          .click();
      await expect(page).toHaveURL(/05-discover/);
    }
    await profile(phoneA, "山风", false);
    await expect(phoneA.locator(".recommend-card")).toHaveCount(0);
    await profile(phoneB, "小满", true);
    const a = await read(contexts[0].request),
      b = await read(contexts[1].request);
    expect(a.actor).not.toBe(b.actor);
    expect(a.actor).not.toBe("operator");
    expect(a.state!.live!.metrics.answered).toBe(2);
    await expect(world).toHaveAttribute("data-total", "2");
    await expect(
      world.locator("[data-world-player]").filter({ hasText: "山风" }),
    ).toHaveCount(1);
    await expect(
      operator.getByText("已回答 2 人", { exact: true }),
    ).toBeVisible();
    await operator.getByLabel("查看题目统计").selectOption("q10");
    await expect(
      operator.getByText("已回答 2 人", { exact: true }),
    ).toBeVisible();
    await phoneA.reload();
    expect((await read(contexts[0].request)).actor).toBe(a.actor);
    await expect(phoneA.locator(".recommend-card")).toHaveCount(1);
    await phoneA.getByRole("button", { name: "看看共同答案" }).click();
    await phoneA.getByRole("button", { name: "想认识 TA" }).click();
    await phoneA
      .getByRole("dialog")
      .getByRole("button", { name: "发出邀请", exact: true })
      .click();
    await expect(phoneA).toHaveURL(/07-invitation/);
    await phoneB.getByRole("link", { name: /查看你的相遇任务/ }).click();
    await expect(phoneB).toHaveURL(/07-invitation/);
    await phoneB.getByRole("button", { name: "我也愿意认识" }).click();
    await phoneA.getByRole("button", { name: "查看相遇任务" }).click();
    for (const page of [phoneA, phoneB]) {
      await expect(page).toHaveURL(/08-mutual/);
      await page.getByRole("button", { name: "查看见面指引" }).click();
      await page.getByRole("button", { name: "确认出发", exact: true }).click();
      await page
        .getByRole("button", { name: "我已经到了", exact: true })
        .click();
    }
    await phoneA
      .getByRole("button", { name: "我已经见到 TA", exact: true })
      .click();
    await expect(operator.getByTestId("real-count")).toHaveText("0");
    await expect(world).toHaveAttribute("data-meetings", "0");
    await phoneB
      .getByRole("button", { name: "我已经见到 TA", exact: true })
      .click();
    await expect(phoneA).toHaveURL(/10-next-step/);
    await expect(operator.getByTestId("real-count")).toHaveText("1");
    await expect(world).toHaveAttribute("data-meetings", "1");
    expect(
      (await read(contexts[3].request, "screen")).world!.meetScene!
        .qualifiedPairs,
    ).toHaveLength(0);
    await phoneA
      .getByRole("button", { name: "允许本次公开展示", exact: true })
      .click();
    expect(
      (await read(contexts[3].request, "screen")).world!.meetScene!
        .qualifiedPairs,
    ).toHaveLength(0);
    await phoneB
      .getByRole("button", { name: "允许本次公开展示", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await read(contexts[3].request, "screen")).world!.meetScene!
            .qualifiedPairs.length,
      )
      .toBe(1);
    await phoneA
      .getByRole("button", { name: "撤回本次公开展示", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await read(contexts[3].request, "screen")).world!.meetScene!
            .qualifiedPairs.length,
      )
      .toBe(0);
    await phoneA.getByRole("button", { name: /就到这里，也很好/ }).click();
    await expect(
      phoneA.getByRole("button", { name: /就到这里，也很好/ }),
    ).toHaveAttribute("aria-pressed", "true");
    const after = await read(contexts[1].request);
    expect(after.state!.invitations[0].choices[a.actor!]).toBeUndefined();
    await contexts[3].setOffline(true);
    await expect(display.locator(".live-screen-status")).toBeVisible();
    await command(contexts[0].request, a.state!.epoch, {
      type: "answer",
      questionId: "q1",
      value: "认真认识",
    });
    await contexts[3].setOffline(false);
    await expect(
      display.locator('[data-field-id="q1:2"] [data-field-count]'),
    ).toContainText("1 人");
    const latencies: number[] = [];
    await operator.getByLabel("查看题目统计").selectOption("q1");
    for (let i = 0; i < 12; i++) {
      const selected = i % 2 === 0;
      await command(contexts[0].request, a.state!.epoch, {
        type: "answer",
        questionId: "q1",
        value: selected ? "轻松聊聊" : "认真认识",
      });
      const committedAt = Date.now();
      await Promise.all([
        expect(
          display.locator('[data-field-id="q1:0"] [data-field-count]'),
        ).toContainText(`${selected ? 1 : 0} 人`),
        expect(
          operator.locator(".live-settings li").filter({ hasText: "轻松聊聊" }),
        ).toContainText(`：${selected ? 1 : 0} 人`),
      ]);
      latencies.push(Date.now() - committedAt);
    }
    const sorted = [...latencies].sort((x, y) => x - y),
      p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
    expect(p95).toBeLessThanOrEqual(2000);
    writeFileSync(
      "/private/tmp/destinylab-public-linkage-20261010/sync-result.json",
      JSON.stringify({ activity, samples: latencies, p95Ms: p95 }),
    );
    await phoneA.reload();
    await expect(
      phoneA.getByRole("button", { name: /就到这里，也很好/ }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(operator.getByTestId("real-count")).toHaveText("1");
    await phoneA
      .getByRole("button", { name: "允许本次公开展示", exact: true })
      .click();
    await phoneA
      .getByRole("button", { name: "我想继续探索", exact: true })
      .click();
    await expect(phoneA).toHaveURL(/05-discover/);
    await phoneA
      .getByText("管理之前相遇的公开展示许可", { exact: true })
      .click();
    await phoneA
      .getByRole("button", { name: "撤回公开展示", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await read(contexts[3].request, "screen")).world!.meetScene!
            .qualifiedPairs.length,
      )
      .toBe(0);
    await operator
      .getByRole("button", { name: "退出登录", exact: true })
      .click();
    await expect(
      operator.getByRole("heading", { name: "现场运营登录" }),
    ).toBeVisible();
    expect(
      (await contexts[2].request.get(url("snapshot", "operator"))).status(),
    ).toBe(401);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});

test("authorization, idempotency, 100 concurrent independent answers and durable records", async ({
  playwright,
}) => {
  const contexts: APIRequestContext[] = [];
  async function client() {
    const c = await playwright.request.newContext({
      baseURL: origin,
      extraHTTPHeaders: { Origin: origin },
    });
    contexts.push(c);
    return c;
  }
  try {
    const stranger = await client(),
      admin = await client();
    expect((await stranger.get(url("snapshot", "operator"))).status()).toBe(
      401,
    );
    expect(
      (
        await stranger.post(url("session"), {
          headers: { Origin: "http://evil.invalid" },
          data: {},
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await stranger.post(url("session"), { data: { actor: "operator" } })
      ).status(),
    ).toBe(400);
    expect((await admin.post(url("login"), { data: login() })).status()).toBe(
      200,
    );
    const users = await Promise.all(
      Array.from({ length: 100 }, async () => {
        const request = await client();
        const response = await request.post(url("session"), { data: {} });
        expect(response.status()).toBe(200);
        return { request, snap: (await response.json()) as LiveSnapshot };
      }),
    );
    expect(new Set(users.map((u) => u.snap.actor)).size).toBe(100);
    const first = users[0],
      epoch = first.snap.state!.epoch;
    const wrong = {
      type: "answer",
      questionId: "q1",
      value: "轻松聊聊",
      actor: users[1].snap.actor,
    };
    expect((await send(first.request, epoch, wrong)).status()).toBe(400);
    expect(
      (
        await send(first.request, epoch, { type: "pause", value: true })
      ).status(),
    ).toBe(400);
    expect(
      (await send(first.request, epoch, { type: "tongzhou-submit" })).status(),
    ).toBe(400);
    expect(
      (
        await first.request.get(
          `/api/live/snapshot?activity=another&audience=participant`,
        )
      ).status(),
    ).toBe(401);
    const started = Date.now();
    await Promise.all(
      users.map((u, i) =>
        command(u.request, epoch, {
          type: "answer",
          questionId: "q1",
          value: QUESTIONS[0].options[i % 3],
        }),
      ),
    );
    const durationMs = Date.now() - started;
    const id = randomUUID(),
      answer: Command = { type: "answer", questionId: "q1", value: "认真认识" };
    const committed = await command(
      first.request,
      epoch,
      answer,
      "participant",
      id,
    );
    await Promise.all(
      Array.from({ length: 10 }, () =>
        command(first.request, epoch, answer, "participant", id),
      ),
    );
    expect((await read(first.request)).revision).toBe(committed.revision);
    expect(
      (
        await send(
          first.request,
          epoch,
          { ...answer, value: "一起逛逛" },
          "participant",
          id,
        )
      ).status(),
    ).toBe(409);
    expect((await send(first.request, "old-epoch", answer)).status()).toBe(409);
    const publicData = await read(stranger, "screen"),
      privateData = await read(admin, "operator");
    expect(publicData.world!.totalParticipants).toBe(100);
    expect(
      publicData.world!.question.options.reduce((n, o) => n + o.count, 0),
    ).toBe(100);
    expect(privateData.state!.participants).toHaveLength(100);
    expect(privateData.state!.live!.questions[0].total).toBe(100);
    expect(JSON.stringify(publicData)).not.toContain(first.snap.actor!);
    expect(publicData.state).toBeUndefined();
    expect(
      (await read(first.request)).state!.live!.questions.map((q) => q.id),
    ).toEqual(["q1"]);
    const beforeRejoin = (await read(admin, "operator")).revision;
    const rejoin = await first.request.post(url("session"), { data: {} });
    expect((await rejoin.json()).actor).toBe(first.snap.actor);
    expect((await read(admin, "operator")).revision).toBe(beforeRejoin);
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const row = (
        await pool.query(
          "SELECT state,revision FROM dl_activities WHERE id=$1",
          [activity],
        )
      ).rows[0];
      expect(row.state.participants).toHaveLength(100);
      expect(Object.keys(row.state.responses)).toHaveLength(100);
      expect(Number(row.revision)).toBe(privateData.revision);
      const ledger = (
        await pool.query(
          "SELECT count(*)::int AS count FROM dl_commands WHERE activity_id=$1 AND command_id=$2",
          [activity, id],
        )
      ).rows[0];
      expect(ledger.count).toBe(1);
    } finally {
      await pool.end();
    }
    writeFileSync(
      "/private/tmp/destinylab-public-linkage-20261010/load-result.json",
      JSON.stringify({
        activity,
        concurrentParticipants: 100,
        answerBatchMs: durationMs,
        revision: privateData.revision,
        answers: 100,
      }),
    );
    writeFileSync(
      "/private/tmp/destinylab-public-linkage-20261010/runtime/restart-session.json",
      JSON.stringify(await first.request.storageState()),
      { mode: 0o600 },
    );
    writeFileSync(
      "/private/tmp/destinylab-public-linkage-20261010/runtime/restart-expected.json",
      JSON.stringify({
        activity,
        actor: first.snap.actor,
        revision: privateData.revision,
      }),
      { mode: 0o600 },
    );
  } finally {
    await Promise.all(contexts.map((c) => c.dispose()));
  }
});

test("competing invitations, last point, repeated confirmations and operator help remain transactional", async ({
  playwright,
}) => {
  const requests: APIRequestContext[] = [];
  try {
    const admin = await playwright.request.newContext({
      baseURL: origin,
      extraHTTPHeaders: { Origin: origin },
    });
    requests.push(admin);
    expect((await admin.post(url("login"), { data: login() })).status()).toBe(
      200,
    );
    const users: {
      request: APIRequestContext;
      actor: string;
      epoch: string;
    }[] = [];
    for (let i = 0; i < 4; i++) {
      const request = await playwright.request.newContext({
        baseURL: origin,
        extraHTTPHeaders: { Origin: origin },
      });
      requests.push(request);
      const snap = (await (
        await request.post(url("session"), { data: {} })
      ).json()) as LiveSnapshot;
      const epoch = snap.state!.epoch;
      await command(request, epoch, {
        type: "profile",
        name: ["山风", "小满", "清河", "暖阳"][i],
        gender: i % 2 ? "female" : "male",
        avatarId: i % 2 ? "female_03" : "male_03",
        age: "26–29",
        ready: true,
      });
      for (const q of QUESTIONS)
        await command(request, epoch, {
          type: "answer",
          questionId: q.id,
          value: q.options[0],
        });
      users.push({ request, actor: snap.actor!, epoch });
    }
    const epoch = users[0].epoch;
    await command(
      admin,
      epoch,
      { type: "point-add", name: "Meet01" },
      "operator",
    );
    const race = await Promise.all(
      [1, 3].map((i) =>
        send(users[0].request, epoch, {
          type: "invite",
          targetId: users[i].actor,
        }),
      ),
    );
    expect(race.map((r) => r.status()).sort()).toEqual([200, 409]);
    const invitation = (await read(users[0].request)).state!.invitations[0];
    const winner = users.find((u) => u.actor === invitation.to)!;
    const other = users.find((u, i) => i % 2 && u.actor !== winner.actor)!;
    const second = await command(users[2].request, epoch, {
      type: "invite",
      targetId: other.actor,
    });
    const otherInvitation = second.state!.invitations[0];
    await Promise.all([
      command(winner.request, epoch, {
        type: "accept",
        invitationId: invitation.id,
      }),
      command(other.request, epoch, {
        type: "accept",
        invitationId: otherInvitation.id,
      }),
    ]);
    const state = (await read(admin, "operator")).state!;
    expect(state.invitations.filter((i) => i.pointId)).toHaveLength(1);
    expect(
      state.invitations.filter((i) => i.status === "ACCEPTED"),
    ).toHaveLength(1);
    const assigned = state.invitations.find((i) => i.pointId)!;
    const pair = users.filter((u) =>
      [assigned.from, assigned.to].includes(u.actor),
    );
    for (const u of pair) {
      await command(u.request, epoch, {
        type: "depart",
        invitationId: assigned.id,
      });
      await command(u.request, epoch, {
        type: "arrive",
        invitationId: assigned.id,
      });
    }
    const helped = await command(pair[0].request, epoch, {
      type: "help",
      invitationId: assigned.id,
    });
    const helpId = helped.state!.helps[0].id;
    await command(
      admin,
      epoch,
      { type: "help-status", helpId, status: "ACK" },
      "operator",
    );
    expect((await read(pair[0].request)).state!.helps[0].status).toBe("ACK");
    await command(
      admin,
      epoch,
      { type: "help-status", helpId, status: "RESOLVED" },
      "operator",
    );
    const ids = pair.map(() => randomUUID());
    await Promise.all(
      pair.flatMap((u, i) =>
        Array.from({ length: 5 }, () =>
          command(
            u.request,
            epoch,
            { type: "confirm", invitationId: assigned.id },
            "participant",
            ids[i],
          ),
        ),
      ),
    );
    const final = (await read(admin, "operator")).state!;
    expect(final.live!.metrics.real).toBe(1);
    expect(final.invitations.filter((i) => i.realMeetAt)).toHaveLength(1);
    expect((await read(admin, "screen")).world!.totalMeetings).toBe(1);
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const audit = (
        await pool.query(
          "SELECT payload FROM dl_commands WHERE activity_id=$1 AND command_id=$2",
          [activity, ids[0]],
        )
      ).rows;
      expect(audit).toHaveLength(1);
      expect(audit[0].payload).toEqual({
        type: "confirm",
        invitationId: assigned.id,
      });
    } finally {
      await pool.end();
    }
  } finally {
    await Promise.all(requests.map((r) => r.dispose()));
  }
});
