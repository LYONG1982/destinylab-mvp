import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { database } from "../../src/server/db";
import { emptyActivity } from "../../src/server/state";

test("operator browser: 20 defaults, disable/reload/enable, add a number without address", async () => {
  const url = new URL(process.env.DATABASE_URL || "http://invalid");
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    !url.pathname.endsWith("_test") ||
    process.env.DESTINY_PUBLIC_URL !== "http://127.0.0.1:3227"
  )
    throw Error("Isolated local UAT required");
  const loginFile = process.env.DESTINY_POINT_TEST_LOGIN;
  if (!loginFile?.startsWith("/tmp/destinylab-weapp-"))
    throw Error("Protected test access file required");
  const credentials = JSON.parse(await readFile(loginFile, "utf8"));
  const activity = `points-ui-${randomUUID().slice(0, 8)}`;
  await database().query("INSERT INTO dl_activities(id,state) VALUES($1,$2)", [
    activity,
    emptyActivity(),
  ]);
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1024 },
    });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(
      `http://127.0.0.1:3227/admin/dashboard?activity=${activity}`,
    );
    await page.getByLabel("运营账号").fill(credentials.operator);
    await page.getByLabel("密码", { exact: true }).fill(credentials.password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    const panel = page
      .locator("section.panel")
      .filter({
        has: page.getByRole("heading", { name: "相遇点状态", exact: true }),
      });
    const rows = panel.locator("tbody tr");
    await expect(rows).toHaveCount(20);
    const first = rows.filter({ hasText: "Meet01" });
    await expect(first.locator(".fine")).toHaveCount(0);
    await first.getByRole("button", { name: "停用", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "确认操作" })
      .click();
    await expect(first).toContainText("暂停开放");
    await page.reload();
    await expect(first).toContainText("暂停开放");
    await first.getByRole("button", { name: "启用", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "确认操作" })
      .click();
    await expect(first).toContainText("空闲");
    await page.locator(".live-operator summary").click();
    await page.getByLabel("添加现场已设置的相遇点").fill("Meet21");
    await page.getByRole("button", { name: "添加相遇点", exact: true }).click();
    await expect(rows).toHaveCount(21);
    await page.reload();
    await expect(rows).toHaveCount(21);
    expect(errors).toEqual([]);
    await panel.screenshot({
      path: "/tmp/destinylab-weapp-20261013/points-admin.png",
    });
  } finally {
    await browser.close();
    await database().query("DELETE FROM dl_sessions WHERE activity_id=$1", [
      activity,
    ]);
    await database().query("DELETE FROM dl_commands WHERE activity_id=$1", [
      activity,
    ]);
    await database().query("DELETE FROM dl_events WHERE activity_id=$1", [
      activity,
    ]);
    await database().query("DELETE FROM dl_activities WHERE id=$1", [activity]);
    await database().end();
  }
});
