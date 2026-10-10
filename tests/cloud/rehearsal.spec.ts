import {
  test,
  expect,
  type BrowserContext,
  type APIRequestContext,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import { QUESTIONS } from "../../src/data/questions";
import type { LiveSnapshot } from "../../src/lib/api/live-types";
import {
  cloudTestTarget,
  verifyCloudTestBinding,
} from "../../scripts/lib/cloud-test-guard.mjs";
const NAMES = [
  "山风",
  "小满",
  "清河",
  "暖阳",
  "春雨",
  "秋月",
  "夏云",
  "冬雪",
  "青竹",
  "白露",
  "朝霞",
  "夕照",
  "星河",
  "明月",
  "溪水",
  "远山",
  "海风",
  "花语",
  "飞鸟",
  "晴天",
];
const target = cloudTestTarget(process.env);
const soakSeconds = Number(process.env.DESTINY_CLOUD_SOAK_SECONDS || "0");
if (
  !Number.isInteger(soakSeconds) ||
  (soakSeconds !== 0 && (soakSeconds < 1800 || soakSeconds > 3600))
)
  throw new Error("Cloud rehearsal soak must be 1800–3600 seconds or disabled");
const url = (path: string, audience = "participant") =>
  `/api/live/${path}?activity=${target.activity}&audience=${audience}`;
const login = () =>
  JSON.parse(readFileSync(process.env.DESTINY_CLOUD_TEST_LOGIN!, "utf8"));
async function read(
  r: APIRequestContext,
  role = "participant",
): Promise<LiveSnapshot> {
  const response = await r.get(url("snapshot", role));
  expect(response.status()).toBe(200);
  return response.json();
}
async function send(
  r: APIRequestContext,
  epoch: string,
  command: unknown,
  role = "participant",
  id = randomUUID(),
) {
  return r.post(url("command", role), {
    headers: { Origin: target.origin, "Idempotency-Key": id },
    data: { epoch, command },
  });
}
async function command(
  r: APIRequestContext,
  epoch: string,
  value: unknown,
  role = "participant",
  id = randomUUID(),
): Promise<LiveSnapshot> {
  const result = await send(r, epoch, value, role, id);
  expect(result.status()).toBe(200);
  return result.json();
}
test("10 then 20 independent browsers, two pairs, permissions and reconnect", async ({
  browser,
  request,
}) => {
  test.setTimeout(600000 + soakSeconds * 1000);
  // The first request is read-only. No login, session or participant creation before proof.
  const ready = await request.get("/api/health/ready", {
    headers: { "x-destiny-test-token": target.token },
  });
  expect(ready.status()).toBe(200);
  verifyCloudTestBinding(target, await ready.json());
  const contexts: BrowserContext[] = [];
  const errors: string[] = [];
  const times: number[] = [];
  try {
    async function context() {
      const c = await browser.newContext({
        baseURL: target.origin,
        viewport: { width: 390, height: 844 },
        reducedMotion: "reduce",
      });
      contexts.push(c);
      return c;
    }
    const adminContext = await context(),
      screenContext = await context();
    const admin = await adminContext.newPage(),
      screen = await screenContext.newPage();
    for (const p of [admin, screen])
      p.on("pageerror", (e) => errors.push(e.message));
    await admin.setViewportSize({ width: 1440, height: 1024 });
    await screen.setViewportSize({ width: 1920, height: 1080 });
    await admin.goto(`/admin/dashboard?activity=${target.activity}`);
    await admin.getByLabel("运营账号").fill(login().username);
    await admin.getByLabel("密码", { exact: true }).fill(login().password);
    await admin.getByRole("button", { name: "登录", exact: true }).click();
    await expect(admin.getByTestId("real-count")).toHaveText("0");
    expect(
      (await read(adminContext.request, "operator")).state!.participants,
    ).toHaveLength(0);
    await screen.goto(`/screen?activity=${target.activity}`);
    const world = screen.getByTestId("destiny-world");
    await expect(world).toHaveAttribute("data-total", "0");
    const qr = screen.getByTestId("world-qr").locator("img");
    await expect(qr).toBeVisible();
    const png = PNG.sync.read(
      Buffer.from((await qr.getAttribute("src"))!.split(",")[1], "base64"),
    );
    expect(
      jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data,
    ).toBe(`${target.origin}/mobile/01-start?activity=${target.activity}`);
    const users: { context: BrowserContext; actor: string; epoch: string }[] =
      [];
    // All twenty contexts stay open, with actual mobile pages and EventSource connections.
    for (let batch = 0; batch < 2; batch++) {
      for (let i = batch * 10; i < (batch + 1) * 10; i++) {
        const c = await context(),
          page = await c.newPage();
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto(`/mobile/01-start?activity=${target.activity}`);
        await expect
          .poll(async () => (await c.request.get(url("snapshot"))).status())
          .toBe(200);
        const snap = await read(c.request);
        const epoch = snap.state!.epoch;
        users.push({ context: c, actor: snap.actor!, epoch });
        if (i < 4) {
          await page.getByRole("button", { name: /一起逛逛/ }).click();
          await page
            .getByRole("button", { name: "看看现场还有谁和我一样" })
            .click();
          await page.getByLabel("怎么称呼你？").fill(NAMES[i]);
          if (i % 2)
            await page
              .getByRole("button", { name: "女生", exact: true })
              .click();
          await page
            .getByRole("button", { name: "26–29", exact: true })
            .click();
          await page
            .getByRole("button", { name: "可以，现在就能见面" })
            .click();
          await page
            .getByRole("radio", {
              name: `${i % 2 ? "女生" : "男生"}虚拟头像 03`,
            })
            .check();
          await page.getByRole("button", { name: "继续答题" }).click();
          for (const q of QUESTIONS.slice(1))
            await page
              .getByRole("button", { name: q.options[0], exact: true })
              .click();
          await expect(page).toHaveURL(/05-discover/);
        } else {
          await command(c.request, epoch, {
            type: "profile",
            name: NAMES[i],
            gender: i % 2 ? "female" : "male",
            avatarId: i % 2 ? "female_03" : "male_03",
            age: "26–29",
            ready: true,
          });
          for (const q of QUESTIONS)
            await command(c.request, epoch, {
              type: "answer",
              questionId: q.id,
              value: q.options[0],
            });
        }
      }
      const started = Date.now();
      await Promise.all(
        users.map((u, i) =>
          command(u.context.request, u.epoch, {
            type: "answer",
            questionId: "q1",
            value: QUESTIONS[0].options[i % 3],
          }),
        ),
      );
      times.push(Date.now() - started);
      await expect(world).toHaveAttribute("data-total", String(users.length));
      expect(
        (await read(adminContext.request, "operator")).state!.participants,
      ).toHaveLength(users.length);
    }
    expect(new Set(users.map((u) => u.actor)).size).toBe(20);
    const epoch = users[0].epoch;
    // Normalize answers for the two pair journeys; no direct database/fixture writes.
    for (const u of users.slice(0, 4))
      await command(u.context.request, epoch, {
        type: "answer",
        questionId: "q1",
        value: QUESTIONS[0].options[0],
      });
    expect(
      (
        await users[0].context.request.get(url("snapshot", "operator"))
      ).status(),
    ).toBe(401);
    expect(
      (
        await send(users[0].context.request, epoch, {
          type: "pause",
          value: true,
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await users[0].context.request.post(url("session"), {
          headers: { Origin: "https://invalid.example" },
          data: {},
        })
      ).status(),
    ).toBe(403);
    await command(
      adminContext.request,
      epoch,
      { type: "point-add", name: "Meet01" },
      "operator",
    );
    const invites: string[] = [];
    for (const start of [0, 2]) {
      const snap = await command(users[start].context.request, epoch, {
        type: "invite",
        targetId: users[start + 1].actor,
      });
      const id = snap.state!.invitations[0].id;
      invites.push(id);
      await command(users[start + 1].context.request, epoch, {
        type: "accept",
        invitationId: id,
      });
    }
    const pending = (await read(adminContext.request, "operator")).state!
      .invitations;
    expect(pending.filter((i) => i.pointId)).toHaveLength(1);
    await command(
      adminContext.request,
      epoch,
      { type: "point-add", name: "Meet02" },
      "operator",
    );
    for (let pair = 0; pair < 2; pair++) {
      const id = invites[pair];
      const pairUsers = users.slice(pair * 2, pair * 2 + 2);
      for (const u of pairUsers) {
        await command(u.context.request, epoch, {
          type: "depart",
          invitationId: id,
        });
        await command(u.context.request, epoch, {
          type: "arrive",
          invitationId: id,
        });
      }
      await command(pairUsers[0].context.request, epoch, {
        type: "confirm",
        invitationId: id,
      });
      await expect(admin.getByTestId("real-count")).toHaveText(String(pair));
      const key = randomUUID();
      await command(
        pairUsers[1].context.request,
        epoch,
        { type: "confirm", invitationId: id },
        "participant",
        key,
      );
      await command(
        pairUsers[1].context.request,
        epoch,
        { type: "confirm", invitationId: id },
        "participant",
        key,
      );
      await expect(admin.getByTestId("real-count")).toHaveText(
        String(pair + 1),
      );
      await expect(world).toHaveAttribute("data-meetings", String(pair + 1));
      for (const u of pairUsers)
        await command(u.context.request, epoch, {
          type: "display-consent",
          invitationId: id,
          allow: true,
        });
    }
    expect(
      (await read(screenContext.request, "screen")).world!.meetScene!
        .qualifiedPairs,
    ).toHaveLength(2);
    await command(users[0].context.request, epoch, {
      type: "display-consent",
      invitationId: invites[0],
      allow: false,
    });
    expect(
      (await read(screenContext.request, "screen")).world!.meetScene!
        .qualifiedPairs,
    ).toHaveLength(1);
    await screenContext.setOffline(true);
    await expect(screen.locator(".live-screen-status")).toBeVisible();
    await command(users[0].context.request, epoch, {
      type: "answer",
      questionId: "q1",
      value: QUESTIONS[0].options[2],
    });
    await screenContext.setOffline(false);
    await expect(screen.locator(".live-screen-status")).not.toBeVisible();
    await admin.getByText("题目统计与相遇点配置", { exact: true }).click();
    await admin.getByLabel("查看题目统计").selectOption("q1");
    const sync: number[] = [];
    for (let i = 0; i < 12; i++) {
      const index = i % 2;
      await command(users[0].context.request, epoch, {
        type: "answer",
        questionId: "q1",
        value: QUESTIONS[0].options[index],
      });
      const committed = Date.now();
      const data = await read(screenContext.request, "screen");
      const count = data.world!.question.options[index].count;
      await expect(
        screen.locator(`[data-field-id="q1:${index}"] [data-field-count]`),
      ).toContainText(`${count} 人`);
      await expect(
        admin
          .locator(".live-settings li")
          .filter({ hasText: QUESTIONS[0].options[index] }),
      ).toContainText(`：${count} 人`);
      sync.push(Date.now() - committed);
    }
    await users[0].context.pages()[0].reload();
    expect((await read(users[0].context.request)).actor).toBe(users[0].actor);
    const soakStarted = Date.now();
    let soakSamples = 0;
    while (Date.now() - soakStarted < soakSeconds * 1000) {
      const index = soakSamples % 2;
      await command(users[0].context.request, epoch, {
        type: "answer",
        questionId: "q1",
        value: QUESTIONS[0].options[index],
      });
      const worldState = await read(screenContext.request, "screen");
      const count = worldState.world!.question.options[index].count;
      await expect(
        screen.locator(`[data-field-id="q1:${index}"] [data-field-count]`),
      ).toContainText(`${count} 人`);
      const state = await read(adminContext.request, "operator");
      expect(state.state!.participants).toHaveLength(20);
      expect(state.state!.live!.metrics.real).toBe(2);
      const participant = users[soakSamples % users.length];
      expect((await read(participant.context.request)).actor).toBe(
        participant.actor,
      );
      expect(errors).toEqual([]);
      soakSamples++;
      writeFileSync(
        join(process.env.DESTINY_CLOUD_TEST_OUTPUT!, "soak-progress.json"),
        JSON.stringify({
          elapsedSeconds: Math.floor((Date.now() - soakStarted) / 1000),
          samples: soakSamples,
          contexts: users.length,
          pageErrors: errors.length,
        }),
        { mode: 0o600 },
      );
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.min(
            30000,
            Math.max(0, soakSeconds * 1000 - (Date.now() - soakStarted)),
          ),
        ),
      );
    }
    const final = await read(adminContext.request, "operator");
    expect(final.state!.live!.metrics.real).toBe(2);
    expect(final.state!.participants).toHaveLength(20);
    expect(errors).toEqual([]);
    const directory = process.env.DESTINY_CLOUD_TEST_OUTPUT!;
    writeFileSync(
      join(directory, "restart-session.json"),
      JSON.stringify(await users[0].context.storageState()),
      { mode: 0o600 },
    );
    writeFileSync(
      join(directory, "restart-expected.json"),
      JSON.stringify({
        activity: target.activity,
        actor: users[0].actor,
        revision: final.revision,
      }),
      { mode: 0o600 },
    );
    const sorted = [...sync].sort((a, b) => a - b);
    writeFileSync(
      join(directory, "result.json"),
      JSON.stringify(
        {
          origin: target.origin,
          activity: target.activity,
          independentBrowserContexts: 20,
          realDevices: 0,
          pairs: 2,
          apiAnswerBatchMs: times,
          syncSamplesMs: sync,
          syncP95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
          pageErrors: errors.length,
          soakSeconds,
          soakSamples,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
