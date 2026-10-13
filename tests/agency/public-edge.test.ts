import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { chromium, expect } from "@playwright/test";
const origin = process.env.DESTINY_PUBLIC_URL!;
const dir = process.env.DESTINY_AGENCY_TEST_CREDENTIALS!;
if (
  origin !== "http://127.0.0.1:3217" ||
  !new URL(process.env.DATABASE_URL!).pathname.endsWith(
    "agency_20261011_test",
  ) ||
  !dir
)
  throw Error("Isolated test environment required");
const fixture = JSON.parse(readFileSync(dir + "/fixture.json", "utf8"));
test("empty and long profiles, anonymous privacy, stable links and unavailable pages", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 320, height: 844 },
    });
    const api = context.request;
    const suffix = "?activity=" + fixture.activity;
    const login = await api.post(origin + "/api/tongzhou/login" + suffix, {
      headers: { Origin: origin },
      data: JSON.parse(readFileSync(dir + "/agency.json", "utf8")),
    });
    assert.equal(login.status(), 200);
    const detail = () =>
      api
        .get(origin + "/api/tongzhou/records" + suffix + "&id=fixture-2")
        .then((r) => r.json());
    let record = await detail();
    const draft = {
      note: "INTERNAL",
      signed: false,
      service: "none",
      nickname: "",
      code: record.management.code,
      intro: "",
      fields: ["realName", "phone"],
      photoIds: [],
    };
    async function manage(action: string) {
      const r = await api.post(origin + "/api/tongzhou/manage" + suffix, {
        headers: { Origin: origin, "Idempotency-Key": randomUUID() },
        data: {
          action,
          actor: "fixture-2",
          draft,
          expectedVersion: record.management.version,
          sourceVersion: record.record.version,
          expectedGalleryVersion: record.gallery.version,
          expectedUserPhoto: record.gallery.userPhotoId,
          confirmed: true,
        },
      });
      assert.equal(r.status(), 200, await r.text());
      record = await detail();
    }
    await manage("publish");
    const url = record.management.url;
    const p = await browser.newPage({ viewport: { width: 320, height: 844 } });
    let response = await p.goto(origin + url);
    assert.equal(response?.status(), 200);
    await expect(p.locator("h1")).toHaveCount(0);
    await expect(p.locator("body")).not.toContainText(draft.code);
    await expect(p).toHaveTitle("同舟婚恋 · 个人介绍");
    await expect(p.locator("h2")).toHaveCount(0);
    assert.ok(!(await p.content()).includes("虚构资料2"));
    assert.ok(!(await p.content()).includes("13812345678"));
    await p.screenshot({
      path: "docs/verification/public-profile-v2/no-photo.png",
      fullPage: true,
    });
    draft.nickname = "林间".repeat(20);
    draft.intro = "喜欢阅读、散步，也期待真诚的相遇。\n".repeat(20);
    draft.fields = ["intro", "contactTime"];
    await manage("publish");
    assert.equal(record.management.url, url);
    await p.reload();
    await expect(p.locator("h2")).toHaveText(["01关于我", "02方便联系时段"]);
    assert.ok(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await p
      .locator("[data-profile-page]")
      .evaluate((el) => ((el as HTMLElement).style.fontSize = "24px"));
    assert.ok(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await p.screenshot({
      path: "docs/verification/public-profile-v2/long-profile.png",
      fullPage: true,
    });
    await manage("unpublish");
    response = await p.reload();
    assert.equal(response?.status(), 404);
    await expect(
      p.getByRole("heading", { name: "页面暂不可访问" }),
    ).toBeVisible();
    assert.equal(
      (
        await api.get(origin + "/api/tongzhou-public/" + url.split("/").at(-1))
      ).status(),
      404,
    );
    response = await p.goto(origin + "/tongzhou/p/invalid");
    assert.equal(response?.status(), 404);
  } finally {
    await browser.close();
  }
});
