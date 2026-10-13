import { chromium, request as playwrightRequest } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
const root = process.env.REGISTRATION_TEST_DIR,
  base = "http://127.0.0.1:3241";
if (!root || process.env.DESTINY_PUBLIC_URL !== base)
  throw Error("Dedicated test environment required");
const fixture = JSON.parse(fs.readFileSync(root + "/fixture.json", "utf8")),
  activity = fixture.activity,
  auth = JSON.parse(fs.readFileSync(root + "/auth.json", "utf8"));
const out = "docs/verification/registration/receipt-six";
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const phone = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
const page = await phone.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const anon = await playwrightRequest.newContext({ baseURL: base });
const op = await playwrightRequest.newContext({
  baseURL: base,
  extraHTTPHeaders: { origin: base },
});
const agency = await playwrightRequest.newContext({
  baseURL: base,
  extraHTTPHeaders: { origin: base },
});
const api = (p) =>
  `/api/registration/${p}${p.includes("?") ? "&" : "?"}activity=${activity}`;
try {
  assert.equal((await anon.get(api("records"))).status(), 401);
  assert.equal((await anon.post(api("manage"), {
    headers: {origin:base,"Idempotency-Key":randomUUID()},
    data:{action:"checkin",id:randomUUID(),version:1,receipt:"123456"}
  })).status(),401);
  assert.equal(
    (
      await anon.post(api("session"), {
        data: {},
        headers: { origin: "https://wrong.example" },
      })
    ).status(),
    403,
  );
  assert.equal(
    (
      await op.post(`/api/live/login?activity=${activity}`, { data: auth })
    ).status(),
    200,
  );
  assert.equal(
    (
      await agency.post(`/api/tongzhou/login?activity=${activity}`, {
        data: auth,
      })
    ).status(),
    200,
  );
  const initial = await (
    await op.get(`/api/live/snapshot?activity=${activity}&audience=operator`)
  ).json();
  await page.goto(base + `/mobile/register?activity=${activity}`);
  await page.getByRole("button", { name: "我要报名", exact: true }).waitFor();
  await page.screenshot({ path: out + "/01-home-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "我要报名", exact: true }).click();
  await page.getByPlaceholder("希望大家怎样称呼你").fill("若棠");
  await page.getByRole("button", { name: "♀ 女生", exact: true }).click();
  await page.getByPlaceholder("如 1995").fill("1997");
  await page.getByPlaceholder("如 银川").fill("银川");
  await page
    .getByPlaceholder("用于活动联系，不会公开")
    .fill("139" + String(Date.now()).slice(-8));
  assert.equal(
    await page
      .getByRole("button", { name: "确认报名", exact: true })
      .isDisabled(),
    true,
  );
  await page.getByRole("checkbox").check();
  await page.screenshot({ path: out + "/02-basic-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "确认报名", exact: true }).click();
  await page.getByRole("heading", { name: "报名成功", exact: true }).waitFor();
  await page.screenshot({
    path: out + "/03-success-mobile.png",
    fullPage: true,
  });
  const current = await (await phone.request.get(base + api("me"))).json();
  let record = current.record;
  assert.ok(record.id);
  assert.match(record.receipt, /^[1-9][0-9]{5}$/);
  assert.equal(
    await page.locator(".reg-receipt strong").innerText(),
    record.receipt,
  );
  await page.setViewportSize({ width: 320, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  const after = await (
    await op.get(`/api/live/snapshot?activity=${activity}&audience=operator`)
  ).json();
  assert.equal(
    after.state.participants.length,
    initial.state.participants.length,
  );
  assert.equal(
    (
      await anon.get(
        record.photos[0]?.url || api("photo?photo=" + randomUUID()),
      )
    ).status(),
    401,
  );
  await page.getByRole("button", { name: /继续完善资料/ }).click();
  await page.getByLabel("婚姻状况").selectOption("未婚");
  await page.getByLabel("学历").selectOption("本科");
  await page.getByLabel("身高（cm）").fill("168");
  await page.getByLabel("职业").fill("品牌设计师");
  await page.screenshot({ path: out + "/04-life-mobile.png", fullPage: true });
  await page.getByRole("tab", { name: "择偶期待" }).click();
  await page
    .getByPlaceholder("期待怎样的相处？写下你在意的小事。")
    .fill("真诚相处，一起探索城市，也喜欢安静的周末。");
  await page
    .getByPlaceholder("简单介绍你的家庭与生活氛围。")
    .fill("家人相处融洽，彼此尊重。");
  await page.screenshot({
    path: out + "/05-expectations-mobile.png",
    fullPage: true,
  });
  await page.getByRole("tab", { name: "个人相册" }).click();
  const bytes = await sharp("public/assets/registration/city-dusk.png")
    .resize(300)
    .jpeg()
    .toBuffer();
  await page.locator("input[type=file]").setInputFiles({
    name: "生活照片.jpg",
    mimeType: "image/jpeg",
    buffer: bytes,
  });
  await page.getByAltText("我的生活照片").waitFor();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "保存资料", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "资料已保存" }).waitFor();
  await page.screenshot({ path: out + "/06-album-mobile.png", fullPage: true });
  record = (await (await phone.request.get(base + api("me"))).json()).record;
  assert.equal(record.fields.occupation, "品牌设计师");
  assert.equal(record.photos.length, 1);
  assert.equal(record.agencyAllowed, true);
  assert.equal((await anon.get(base + record.photos[0].url)).status(), 401);
  assert.equal(
    (await anon.get(base + record.photos[0].url + "&operator=1")).status(),
    401,
  );
  const ag = await agency.get(
    `/api/tongzhou/records?activity=${activity}&id=${encodeURIComponent("registration:" + record.id)}`,
  );
  assert.equal(ag.status(), 200);
  const ad = await ag.json();
  assert.equal(ad.record.fields.occupation, "品牌设计师");
  assert.equal(ad.gallery.photos.length, 1);
  await page.reload();
  await page
    .getByRole("button", { name: "查看我的报名", exact: true })
    .first()
    .waitFor();
  await page
    .getByRole("button", { name: "查看我的报名", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: /继续完善资料/ }).click();
  assert.equal(await page.getByLabel("职业").inputValue(), "品牌设计师");
  await page.getByText("更多个人信息", { exact: false }).click();
  await page.getByLabel("真实姓名").fill("测试姓名");
  await page.getByLabel("民族").fill("汉族");
  await page.screenshot({ path: out + "/07-more-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "保存资料", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "资料已保存" }).waitFor();
  record = (await (await phone.request.get(base + api("me"))).json()).record;
  const adminContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await adminContext.addCookies((await op.storageState()).cookies);
  const admin = await adminContext.newPage();
  await admin.goto(base + `/admin/registrations?activity=${activity}`);
  await admin.getByRole("cell", { name: "若棠", exact: true }).waitFor();
  await admin.screenshot({ path: out + "/08-admin-list.png", fullPage: true });
  await admin
    .getByRole("row")
    .filter({ hasText: "若棠" })
    .getByRole("button", { name: "查看详情" })
    .click();
  await admin.getByRole("dialog", { name: "报名详情" }).waitFor();
  await admin.screenshot({
    path: out + "/09-admin-detail.png",
    fullPage: true,
  });
  assert.equal(
    await admin.getByLabel("核验报名凭证").getAttribute("inputmode"),
    "numeric",
  );
  assert.equal(
    await admin.getByLabel("核验报名凭证").getAttribute("maxlength"),
    "6",
  );
  await admin.getByLabel("核验报名凭证").fill("12345");
  assert.ok(
    await admin.getByRole("button", { name: "核验并签到" }).isDisabled(),
  );
  await admin.getByLabel("核验报名凭证").fill(record.receipt);
  await admin.getByRole("button", { name: "核验并签到" }).click();
  await admin.getByRole("dialog").getByRole("status").waitFor();
  await admin.getByRole("button", { name: "关闭详情" }).click();
  await admin
    .getByRole("row")
    .filter({ hasText: fixture.legacy.nickname })
    .getByRole("button", { name: "查看详情" })
    .click();
  await admin
    .getByRole("button", { name: "使用旧版凭证", exact: true })
    .click();
  assert.equal(
    await admin.getByLabel("核验报名凭证").getAttribute("maxlength"),
    "16",
  );
  await admin
    .getByLabel("核验报名凭证")
    .fill(fixture.legacy.receipt.toLowerCase());
  await admin.getByRole("button", { name: "核验并签到" }).click();
  await admin
    .getByRole("dialog")
    .getByRole("status")
    .filter({ hasText: "签到已确认" })
    .waitFor();
  await admin.screenshot({
    path: out + "/11-legacy-checkin.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "稍后完善" }).click();
  await page.getByRole("button", { name: "刷新签到状态" }).click();
  await page.getByRole("button", { name: "进入活动", exact: true }).waitFor();
  await page.getByRole("button", { name: "进入活动", exact: true }).click();
  await page.waitForURL(/mobile\/01-start/);
  const entered = await (
    await op.get(`/api/live/snapshot?activity=${activity}&audience=operator`)
  ).json();
  assert.equal(
    entered.state.participants.length,
    initial.state.participants.length + 1,
  );
  assert.ok(!JSON.stringify(entered.state).includes(record.fields.phone));
  const publicState = await (
    await anon.get(`/api/live/snapshot?activity=${activity}&audience=screen`)
  ).json();
  assert.ok(!JSON.stringify(publicState).includes(record.fields.phone));
  assert.ok(!JSON.stringify(publicState).includes("品牌设计师"));
  const desktop = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await desktop.goto(base + `/mobile/register?activity=${activity}`);
  await desktop
    .getByRole("button", { name: "我要报名", exact: true })
    .waitFor();
  await desktop.screenshot({
    path: out + "/10-home-desktop.png",
    fullPage: true,
  });
  for (const width of [320, 390, 430, 768, 1440]) {
    await desktop.setViewportSize({ width, height: 900 });
    assert.ok(
      await desktop.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `overflow at ${width}`,
    );
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    out + "/browser-result.json",
    JSON.stringify(
      {
        passed: true,
        checks: [
          "anonymous and origin denied",
          "consent required",
          "no event participation before entry",
          "optional details and reload persistence",
          "private photos and agency opt-in",
          "six-digit display, numeric input and incomplete input denied",
          "operator six-digit and legacy drawer check-in",
          "exactly one participant after entry",
          "public state excludes private fields",
          "five responsive widths",
        ],
        screenshots: 11,
      },
      null,
      2,
    ),
  );
  console.log("Registration browser flow passed; 11 screenshots saved");
  await adminContext.close();
} finally {
  await phone.close();
  await browser.close();
  await Promise.all([anon.dispose(), op.dispose(), agency.dispose()]);
}
