// Real browser management UI + real dual-entry API, isolated synthetic identities.
// Does not claim native WeChat widget/login verification.
import { chromium, expect } from "@playwright/test";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
const dir = process.env.AGENCY_UAT_DIR,
  origin = process.env.DESTINY_PUBLIC_URL;
if (
  !dir?.startsWith("/tmp/destinylab-weapp-") ||
  origin !== "http://127.0.0.1:3230"
)
  throw Error("Isolated local UAT required");
const f = JSON.parse(readFileSync(dir + "/unified-fixture.json", "utf8"));
const credentials = JSON.parse(
  readFileSync(dir + "/agency-login.json", "utf8"),
);
if (!f.activity.startsWith("unified-"))
  throw Error("Synthetic fixture required");
const out = "docs/verification/agency-unified-20261013";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({
  baseURL: origin,
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const failures = [];
page.on("pageerror", (e) => failures.push(e.message));
const url = "/agency/tongzhou?activity=" + f.activity;
const endpoint = (p) => "/api/tongzhou/" + p + "?activity=" + f.activity;
const mini = (p) => "/api/mini/" + p + "?activity=" + f.activity;
const header = {
  Authorization: "Bearer " + f.token,
  "Idempotency-Key": randomUUID(),
};
const checks = [];
async function data(response) {
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
async function listing() {
  return data(await context.request.get(endpoint("records")));
}
async function detail() {
  return data(
    await context.request.get(
      endpoint("records") + "&id=" + encodeURIComponent(f.actor),
    ),
  );
}
try {
  await page.goto(url);
  await page.getByLabel("账号", { exact: true }).fill(credentials.username);
  await page.getByLabel("密码", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody")).toContainText("报名入口");
  expect((await listing()).total).toBe(1);
  checks.push("registration_source_visible");
  await data(
    await context.request.post(mini("tongzhou/command"), {
      headers: header,
      data: {
        epoch: f.epoch,
        command: {
          type: "tongzhou-submit",
          expectedVersion: 0,
          fields: { ...f.fields, occupation: "Playwright 活动职业" },
          consent: true,
          consentVersion: "tongzhou-2026-10-06-v1",
        },
      },
    }),
  );
  await page.reload();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody")).toContainText("活动遇见");
  await expect(page.locator("tbody")).toContainText("报名入口");
  const rows = await listing();
  expect(rows.stats.total).toBe(1);
  expect(rows.stats.female).toBe(1);
  await page.screenshot({ path: out + "/01-unified-list.png", fullPage: true });
  checks.push("same_identity_two_sources_one_row_one_count");
  await page
    .getByRole("button", { name: "测试统一档案", exact: true })
    .first()
    .click();
  await expect(
    page.getByText("Playwright 活动职业", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("工作人员备注")).toHaveValue(
    "Playwright 原备注",
  );
  await page
    .getByLabel("工作人员备注")
    .fill("Playwright 合并后跟进\n两个入口同一份档案");
  await page.getByLabel("服务状态", { exact: true }).selectOption("done");
  await page.getByRole("button", { name: "保存跟进", exact: true }).click();
  await expect
    .poll(async () => (await detail()).management.note)
    .toContain("合并后跟进");
  await page.reload();
  await page
    .getByRole("button", { name: "测试统一档案", exact: true })
    .first()
    .click();
  await expect(page.getByLabel("工作人员备注")).toHaveValue(
    "Playwright 合并后跟进\n两个入口同一份档案",
  );
  await expect(page.getByLabel("服务状态", { exact: true })).toHaveValue(
    "done",
  );
  checks.push("followup_save_reload_persists");
  const registration = await data(
    await context.request.get(mini("registration/me"), { headers: header }),
  );
  await data(
    await context.request.post(mini("registration/profile"), {
      headers: { ...header, "Idempotency-Key": randomUUID() },
      data: {
        section: "life",
        next: "preview",
        intent: "save",
        version: registration.record.version,
        fields: { occupation: "Playwright 报名再次完善" },
      },
    }),
  );
  await page.reload();
  await page
    .getByRole("button", { name: "测试统一档案", exact: true })
    .first()
    .click();
  await expect(
    page.getByText("Playwright 报名再次完善", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("工作人员备注")).toHaveValue(
    "Playwright 合并后跟进\n两个入口同一份档案",
  );
  const d = await detail();
  expect(d.latestSource).toBe("registration");
  expect(JSON.stringify(d)).not.toContain("1995-02-18");
  await page.screenshot({
    path: out + "/02-member-detail.png",
    fullPage: true,
  });
  checks.push("registration_update_synced_without_overwriting_followup");
  await page.getByRole("button", { name: "关闭详情" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: /测试统一档案/ }).last(),
  ).toBeVisible();
  await page.screenshot({ path: out + "/03-mobile-list.png", fullPage: true });
  checks.push("mobile_list_source_badges");
  expect(failures).toEqual([]);
  writeFileSync(
    out + "/result.json",
    JSON.stringify(
      {
        origin,
        activity: f.activity,
        checks,
        passed: checks.length,
        pageErrors: failures,
        nativeWechatDevice: false,
        submissionDriver: "Playwright APIRequestContext",
        managementDriver: "Playwright Chromium real Web UI",
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({ passed: checks.length, checks, artifacts: out }),
  );
} finally {
  await browser.close();
}
