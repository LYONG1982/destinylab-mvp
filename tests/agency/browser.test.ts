import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import jsQR from "jsqr";
import { chromium, expect } from "@playwright/test";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
const origin = process.env.DESTINY_PUBLIC_URL!,
  dir = process.env.DESTINY_AGENCY_TEST_CREDENTIALS!;
if (
  origin !== "http://127.0.0.1:3217" ||
  !dir ||
  !new URL(process.env.DATABASE_URL!).pathname.endsWith("agency_20261011_test")
)
  throw Error("Isolated test environment required");
const fixture = JSON.parse(readFileSync(dir + "/fixture.json", "utf8")),
  credentials = JSON.parse(readFileSync(dir + "/agency.json", "utf8"));
const out = "docs/verification/public-profile-v2";
test("desktop and phone UI: login, drawer, note, field controls, preview and publication", async () => {
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    context.setDefaultTimeout(15000);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(origin + "/agency/tongzhou?activity=" + fixture.activity);
    await expect(
      page.getByRole("button", { name: "登录", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /同舟婚恋\s*机构用户管理平台/ }),
    ).toBeVisible();
    await expect(
      page.getByText("copyright by lvyong", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "退出登录" })).toHaveCount(0);
    await expect(page.getByText("自愿填报资料", { exact: true })).toHaveCount(
      0,
    );
    await page.getByLabel("账号", { exact: true }).fill(credentials.username);
    await page.getByLabel("密码", { exact: true }).fill(credentials.password);
    await page.getByRole("button", { name: "显示密码" }).click();
    await expect(page.locator("input[name=password]")).toHaveAttribute(
      "type",
      "text",
    );
    await page.getByRole("button", { name: "隐藏密码" }).click();
    await page.locator("input[name=password]").fill("");
    await page.screenshot({ path: out + "/login-desktop.png" });
    await page.locator("input[name=password]").fill(credentials.password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page.getByRole("heading", { name: "用户资料" })).toBeVisible();
    await expect(page.locator("tbody tr").first()).toBeVisible();
    await page.screenshot({ path: out + "/list-desktop.png" });
    const statHeight = await page
      .getByText("全部资料", { exact: true })
      .locator("..")
      .evaluate((el) => el.getBoundingClientRect().height);
    assert.ok(statHeight <= 66);
    await page.getByLabel("搜索用户").fill("虚构资料1");
    await page.getByRole("button", { name: "虚构资料1", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "虚构资料1", exact: true }),
    ).toBeVisible();
    assert.ok(Math.abs((await dialog.boundingBox())!.width - 1008) < 2);
    await dialog
      .getByLabel("工作人员备注", { exact: true })
      .fill("测试跟进第一行\n第二行 <script>window.bad=true</script>");
    await dialog.getByLabel("签约状态", { exact: true }).selectOption("true");
    await dialog.getByLabel("服务状态", { exact: true }).selectOption("active");
    await dialog.getByRole("tab", { name: "宣传设置" }).click();
    await expect(dialog.getByLabel("真实姓名", { exact: true })).toHaveCount(0);
    await expect(dialog.getByLabel("手机号", { exact: true })).toHaveCount(0);
    await dialog.getByRole("button", { name: "取消全选", exact: true }).click();
    await expect(dialog.getByLabel("真实姓名", { exact: true })).toHaveCount(0);
    await dialog.getByRole("button", { name: "全选", exact: true }).click();
    await expect(dialog.getByLabel("手机号", { exact: true })).toHaveCount(0);
    await dialog.getByLabel("公开昵称", { exact: true }).fill("清风");
    await dialog
      .getByRole("textbox", { name: "个人介绍", exact: true })
      .fill("喜欢阅读、旅行，也期待真诚的相遇。");
    await dialog.getByLabel("所在城市", { exact: true }).check();
    await dialog.getByLabel("性别", { exact: true }).check();
    await dialog
      .getByRole("checkbox", { name: "个人介绍", exact: true })
      .check();
    await dialog.getByRole("tab", { name: "基本资料" }).click();
    await dialog.getByRole("button", { name: "保存跟进", exact: true }).click();
    await expect(dialog.getByRole("status")).toHaveText("已保存");
    await page.waitForTimeout(5500);
    await expect(
      dialog.getByLabel("工作人员备注", { exact: true }),
    ).toHaveValue("测试跟进第一行\n第二行 <script>window.bad=true</script>");
    assert.equal(await page.evaluate(() => "bad" in window), false);
    await dialog.getByRole("tab", { name: "用户照片" }).click();
    await expect(
      dialog
        .getByRole("tabpanel", { name: "用户照片" })
        .getByText("用户上传", { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "移除照片 1", exact: true }),
    ).toHaveCount(0);
    for (const [i, color] of ["#9db8ab", "#b8a8c4"].entries()) {
      const buffer = await sharp({
        create: {
          width: i ? 400 : 300,
          height: i ? 300 : 500,
          channels: 3,
          background: color,
        },
      })
        .png()
        .toBuffer();
      await dialog.getByLabel("上传用户照片", { exact: true }).setInputFiles({
        name: "fictional-" + i + ".png",
        mimeType: "image/png",
        buffer,
      });
      await expect(dialog.getByRole("status")).toHaveText(
        "照片已上传，仅机构可见",
      );
      await expect(
        dialog.getByRole("button", { name: `查看照片 ${i + 2}`, exact: true }),
      ).toBeVisible();
    }
    await dialog
      .getByRole("checkbox", { name: "宣传候选", exact: true })
      .nth(0)
      .check();
    await dialog
      .getByRole("checkbox", { name: "宣传候选", exact: true })
      .nth(1)
      .check();
    await dialog
      .getByRole("button", { name: "查看照片 1", exact: true })
      .click();
    await expect(dialog.getByAltText("用户生活照片大图")).toBeVisible();
    await dialog.getByRole("button", { name: "关闭大图" }).click();
    await page.screenshot({ path: out + "/album-desktop.png" });
    await dialog.getByRole("tab", { name: "宣传设置" }).click();
    await expect(dialog.getByLabel("公开昵称", { exact: true })).toHaveValue(
      "清风",
    );
    await expect(dialog.getByLabel("真实姓名", { exact: true })).toHaveCount(0);
    await expect(dialog.getByLabel("手机号", { exact: true })).toHaveCount(0);
    await dialog.getByRole("button", { name: "保存设置", exact: true }).click();
    await expect(dialog.getByRole("status")).toHaveText("已保存");
    await dialog.getByRole("button", { name: "预览", exact: true }).click();
    await expect(
      dialog.getByRole("heading", { name: "发布预览" }),
    ).toBeVisible();
    await expect(dialog.locator("[data-profile-page]")).not.toContainText(
      "13812345678",
    );
    await expect(dialog.locator("[data-profile-page]")).not.toContainText(
      "虚构资料1",
    );
    await dialog.getByRole("button", { name: "电脑预览", exact: true }).click();
    await expect(
      dialog.getByRole("button", { name: "电脑预览", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await dialog.getByRole("button", { name: "手机预览", exact: true }).click();
    const publicationConsent = dialog.getByRole("checkbox", {
      name: "已取得本人对本次所选内容及照片的公开许可，并确认预览内容。",
    });
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(publicationConsent).toBeInViewport({ ratio: 1 });
      await expect(
        dialog.getByRole("button", { name: "发布", exact: true }),
      ).toBeDisabled();
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await publicationConsent.check();
    await expect(
      dialog.getByRole("button", { name: "发布", exact: true }),
    ).toBeEnabled();
    await page.evaluate(`
      Object.defineProperty(document, "hidden", {configurable:true,get:()=>true});
      document.dispatchEvent(new Event("visibilitychange"));
      Object.defineProperty(document, "hidden", {configurable:true,get:()=>false});
      document.dispatchEvent(new Event("visibilitychange"));
    `);
    await expect(
      dialog.getByText("页面切换后预览已清除，请重新点击“预览”。", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "发布", exact: true }),
    ).toBeDisabled();
    await expect(publicationConsent).not.toBeChecked();
    await dialog.getByRole("button", { name: "预览", exact: true }).click();
    await expect(publicationConsent).toBeEnabled();
    await publicationConsent.check();
    await dialog.getByRole("button", { name: "发布", exact: true }).click();
    await expect(dialog.getByRole("status")).toHaveText("宣传页已发布");
    const url = await dialog
      .getByRole("link", { name: "打开个人主页 ↗" })
      .getAttribute("href");
    assert.ok(url);
    await expect(
      dialog.getByRole("link", { name: "个人主页专属链接" }),
    ).toHaveText(origin + url);
    await expect(
      dialog.getByRole("heading", { name: "个人主页已发布" }),
    ).toBeInViewport();
    const popupPromise = page.waitForEvent("popup");
    await dialog.getByRole("link", { name: "个人主页专属链接" }).click();
    const openedProfile = await popupPromise;
    await expect(openedProfile).toHaveURL(origin + url);
    await expect(
      openedProfile.getByRole("heading", { name: "清风", exact: true }),
    ).toBeVisible();
    await openedProfile.close();

    await dialog
      .getByRole("button", { name: "查看二维码", exact: true })
      .click();
    const qrSource = await dialog
      .getByAltText("个人宣传页二维码")
      .getAttribute("src");
    const decoded = await sharp(Buffer.from(qrSource!.split(",")[1], "base64"))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert.equal(
      jsQR(
        new Uint8ClampedArray(decoded.data),
        decoded.info.width,
        decoded.info.height,
      )?.data,
      origin + url,
    );
    await dialog.getByRole("button", { name: "关闭详情" }).click();
    await page.getByLabel("搜索用户").fill("");
    await page.screenshot({ path: out + "/list-managed.png" });
    const publicPage = await context.newPage();
    await publicPage.goto(origin + url!);
    await expect(
      publicPage.getByRole("heading", { name: "清风", exact: true }),
    ).toBeVisible();
    assert.equal(
      (await publicPage.content()).includes("测试跟进第一行"),
      false,
    );
    assert.equal((await publicPage.content()).includes("13812345678"), false);
    await expect(publicPage).toHaveTitle("清风 · 同舟婚恋");
    for (const title of [
      "基本资料",
      "关于我",
      "生活相册",
      "生活与家庭",
      "期待的你",
      "方便联系时段",
    ])
      await expect(
        publicPage.getByRole("heading", { name: title, exact: true }),
      ).toBeVisible();
    for (const text of [
      "165 cm",
      "本科",
      "产品设计",
      "未育",
      "自有住房",
      "工作日 18:00 后",
    ])
      await expect(publicPage.getByText(text, { exact: true })).toBeVisible();
    await publicPage
      .getByRole("button", { name: "查看生活照片 1", exact: true })
      .click();
    await expect(
      publicPage.getByRole("dialog", { name: "生活照片查看器" }),
    ).toBeVisible();
    await publicPage.keyboard.press("ArrowRight");
    await expect(publicPage.getByAltText("完整照片 2")).toBeVisible();
    await publicPage.keyboard.press("Escape");
    await expect(
      publicPage.getByRole("dialog", { name: "生活照片查看器" }),
    ).not.toBeVisible();
    await expect(
      publicPage.getByRole("button", { name: "查看生活照片 1", exact: true }),
    ).toBeFocused();
    for (const width of [1440, 1024, 768, 390, 320]) {
      await publicPage.setViewportSize({ width, height: 900 });
      await publicPage.screenshot({
        path: out + `/public-${width}.png`,
        fullPage: true,
      });
      assert.ok(
        await publicPage.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
    }
    await publicPage
      .getByRole("button", { name: "微信转发", exact: true })
      .click();
    await expect(publicPage.getByRole("status")).toContainText("右上角");
    // HTTP clients without a Clipboard API retain a selectable link.
    await publicPage.evaluate(() =>
      Object.defineProperty(navigator, "clipboard", {
        value: undefined,
        configurable: true,
      }),
    );
    await publicPage
      .getByRole("button", { name: "复制链接", exact: true })
      .last()
      .click();
    await expect(publicPage.getByLabel("宣传页链接")).toHaveValue(origin + url);
    await publicPage.close();
    for (const width of [1024, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.getByLabel("搜索用户").fill("清风");
      if (width > 600)
        await page
          .getByRole("button", { name: "虚构资料1", exact: true })
          .click();
      else await page.getByRole("button", { name: /虚构资料1.*清风/ }).click();
      await expect(dialog).toBeVisible();
      assert.ok(
        Math.abs(
          (await dialog.boundingBox())!.width -
            (width < 900 ? width : width * 0.7),
        ) < 2,
      );
      await dialog.getByRole("tab", { name: "用户照片" }).click();
      await page.screenshot({ path: out + `/album-${width}.png` });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await dialog.getByRole("button", { name: "关闭详情" }).click();
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: out + "/list-mobile.png", fullPage: true });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    await page.getByLabel("搜索用户").fill("清风");
    await page.getByRole("button", { name: /虚构资料1.*清风/ }).click();
    await expect(dialog).toBeVisible();
    await dialog
      .getByLabel("工作人员备注", { exact: true })
      .fill("未保存的草稿");
    await page.waitForTimeout(5500);
    await expect(
      dialog.getByLabel("工作人员备注", { exact: true }),
    ).toHaveValue("未保存的草稿");
    await page.screenshot({ path: out + "/drawer-mobile.png" });
    page.once("dialog", (d) => d.dismiss());
    await dialog.getByRole("button", { name: "关闭详情" }).click();
    await expect(dialog).toBeVisible();
    page.once("dialog", (d) => d.accept());
    await dialog.getByRole("button", { name: "关闭详情" }).click();
    await expect(dialog).toHaveCount(0);
    await page.goto(origin + url!);
    await page.screenshot({ path: out + "/public-mobile.png", fullPage: true });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    await page.goto(origin + "/agency/tongzhou?activity=" + fixture.activity);
    await page.getByRole("button", { name: "退出登录" }).click();
    await expect(
      page.getByRole("button", { name: "登录", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "用户资料" })).toHaveCount(
      0,
    );
    await page.screenshot({ path: out + "/login-mobile.png" });
    await page.setViewportSize({ width: 320, height: 568 });
    await expect(
      page.getByRole("heading", { name: /同舟婚恋\s*机构用户管理平台/ }),
    ).toBeVisible();
    await expect(
      page.getByText("copyright by lvyong", { exact: true }),
    ).toBeVisible();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({ path: out + "/login-320.png" });
    assert.deepEqual(errors, []);
    writeFileSync(
      out + "/browser-result.json",
      JSON.stringify(
        {
          desktop: true,
          mobile: true,
          note: true,
          publication: true,
          dirtyDraft: true,
          logout: true,
          errors,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
});
