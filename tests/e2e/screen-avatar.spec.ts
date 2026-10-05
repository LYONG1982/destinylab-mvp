import { test, expect, type Page } from "@playwright/test";
import jsQR from "jsqr";
import { PNG } from "pngjs";
async function scenario(page: Page, name: string) {
  await page.goto("/demo");
  await page.getByTestId(`scenario-${name}`).click();
  await page.getByRole("button", { name: "确认载入", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function profile(page: Page) {
  await scenario(page, "fresh");
  await page.goto("/mobile/01-start");
  await page.getByRole("button", { name: "开始今天的遇见" }).click();
  await page.getByRole("button", { name: "看看现场还有谁和我一样" }).click();
  await expect(page.getByRole("radio")).toHaveCount(10);
}
const saved = (page: Page) =>
  page.evaluate(() =>
    JSON.parse(localStorage.getItem("destinylab:v1.1:state")!),
  );

test("avatar is required, gender changes clear selection, keyboard works, refresh and narrow layouts retain selection", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await profile(page);
  await page.getByRole("button", { name: "继续答题" }).click();
  await expect(page.locator("#avatar-message")).toHaveText(
    "选一个本次活动头像吧。",
  );
  await page.getByRole("radio", { name: "男生虚拟头像 03" }).check();
  await expect(
    page.locator('.person-card [data-avatar-id="male_03"]'),
  ).toBeVisible();
  await page.getByRole("button", { name: "男生", exact: true }).click();
  await expect(
    page.getByRole("radio", { name: "男生虚拟头像 03" }),
  ).toBeChecked();
  await page.getByRole("button", { name: "女生", exact: true }).click();
  await expect(page.getByRole("radio", { name: /男生/ })).toHaveCount(0);
  await expect(page.locator('input[name="avatar"]:checked')).toHaveCount(0);
  await expect(page.locator("#avatar-message")).toContainText("女生头像");
  await page.getByRole("radio", { name: "女生虚拟头像 07" }).check();
  await page.getByRole("button", { name: "男生", exact: true }).click();
  await expect(page.locator('input[name="avatar"]:checked')).toHaveCount(0);
  await page.getByRole("radio", { name: "男生虚拟头像 03" }).focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("radio", { name: "男生虚拟头像 04" }),
  ).toBeChecked();
  for (const width of [320, 360, 390, 393, 430]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    for (const box of await page.getByRole("radio").evaluateAll((inputs) =>
      inputs.map((input) => ({
        width: input.getBoundingClientRect().width,
        height: input.getBoundingClientRect().height,
      })),
    )) {
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  }
  await page.screenshot({
    path: "docs/verification/avatars/M03-selected.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "继续答题" }).click();
  await expect(page).toHaveURL(/04-question/);
  await expect(
    page.getByRole("status").filter({ hasText: "欢迎进入缘分实验室" }),
  ).toBeVisible();
  expect((await saved(page)).participants[0].avatarId).toBe("male_04");
  await page.goto("/mobile/03-profile");
  await page.reload();
  await expect(
    page.getByRole("radio", { name: "男生虚拟头像 04" }),
  ).toBeChecked();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("radio", { name: "男生虚拟头像 09" }).check();
  await expect(
    page.locator('.person-card [data-avatar-id="male_09"]'),
  ).toBeVisible();
});

test("chosen avatars agree on candidate, invitation, mutual, meet, operator list/modal and operator pair", async ({
  page,
}) => {
  await scenario(page, "discover");
  for (const route of ["05-discover", "06-common?target=p-xiaoman"]) {
    await page.goto(`/mobile/${route}`);
    await expect(
      page.locator('[data-avatar-id="female_07"]').first(),
    ).toBeVisible();
  }
  for (const [name, route] of [
    ["waiting", "07-invitation"],
    ["mutual", "08-mutual"],
    ["arrival", "09-meet"],
  ]) {
    await scenario(page, name);
    await page.goto(`/mobile/${route}?actor=p-shanfeng`);
    await expect(
      page.locator('[data-avatar-id="female_07"]').first(),
    ).toBeVisible();
    if (name !== "waiting")
      await expect(
        page.locator('[data-avatar-id="male_03"]').first(),
      ).toBeVisible();
  }
  await page.goto("/admin/encounters");
  await expect(
    page.locator('[data-avatar-id="male_03"]').first(),
  ).toBeVisible();
  await expect(
    page.locator('[data-avatar-id="female_07"]').first(),
  ).toBeVisible();
  await page.goto("/admin/participants");
  const row = page.getByRole("row").filter({ hasText: "山风" });
  await expect(row.locator('[data-avatar-id="male_03"]')).toBeVisible();
  await row.getByRole("button", { name: "查看详情" }).click();
  await expect(
    page.getByRole("dialog").locator('[data-avatar-id="male_03"]'),
  ).toBeVisible();
});

test("legacy state loads safely and image failure gives neutral fallback", async ({
  page,
}) => {
  await scenario(page, "confirmed");
  const original = await saved(page);
  await page.evaluate(() => {
    const key = "destinylab:v1.1:state";
    const s = JSON.parse(localStorage.getItem(key)!);
    s.participants.forEach((p: { avatarId?: string }) => delete p.avatarId);
    localStorage.setItem(key, JSON.stringify(s));
  });
  await page.goto("/admin/participants");
  await page.reload();
  await expect(
    page.locator('[data-avatar-id="male_03"]').first(),
  ).toBeVisible();
  const loaded = await saved(page);
  expect(loaded.invitations).toEqual(original.invitations);
  expect(loaded.responses).toEqual(original.responses);
  expect(loaded.epoch).toBe(original.epoch);
  await page.route("**/_next/image*", (route) => route.abort());
  await page.reload();
  await expect(page.locator(".avatar-placeholder").first()).toBeVisible();
});

test("screen preserves QR, layout, canvas identity across dissolve and stops motion when reduced or hidden", async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await scenario(page, "discover");
  await page.goto("/screen");
  const qr = page.locator(".screen-qr img");
  await expect(qr).toBeVisible();
  const src = await qr.getAttribute("src"),
    box = await qr.boundingBox();
  await page.waitForTimeout(1600);
  await page.evaluate(
    'window.__ambient = document.querySelector("[data-layer=ambient]")',
  );
  await expect(page.locator('[data-scene-current="presence"]')).toBeVisible({
    timeout: 16000,
  });
  expect(
    await page.evaluate(
      'window.__ambient === document.querySelector("[data-layer=ambient]")',
    ),
  ).toBe(true);
  await expect(page.locator(".screen-scene-outgoing")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  await expect(page.locator(".screen-qr img")).toHaveCount(1);
  expect(await qr.getAttribute("src")).toBe(src);
  expect(await qr.boundingBox()).toEqual(box);
  const png = PNG.sync.read(await qr.screenshot());
  expect(
    jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data,
  ).toBe("http://localhost:3210/mobile/01-start");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.getByTestId("screen-motion")).toHaveAttribute(
    "data-running",
    "false",
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.getAnimations().filter((a) => a.playState === "running")
            .length,
      ),
    )
    .toBe(0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByTestId("screen-motion")).toHaveAttribute(
    "data-running",
    "false",
  );
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByTestId("screen-motion")).toHaveAttribute(
    "data-running",
    "true",
  );
  for (const mode of ["question", "presence", "mutual", "real-meet"]) {
    await page.goto(`/screen/${mode}`);
    await expect(qr).toBeVisible();
    await page.waitForTimeout(1400);
    const image = PNG.sync.read(await qr.screenshot());
    expect(
      jsQR(new Uint8ClampedArray(image.data), image.width, image.height)?.data,
    ).toBe("http://localhost:3210/mobile/01-start");
    expect(await qr.boundingBox()).toEqual(box);
    expect(
      await qr.evaluate((el) => ({
        transform: getComputedStyle(el).transform,
        opacity: getComputedStyle(el).opacity,
      })),
    ).toEqual({ transform: "none", opacity: "1" });
    await page.screenshot({
      path: `docs/verification/screen-motion/${mode}.png`,
    });
  }
  await page.setViewportSize({ width: 3840, height: 2160 });
  await page.goto("/screen/question");
  await page.waitForTimeout(1600);
  await page.screenshot({
    path: "docs/verification/screen-motion/question-4k.png",
  });
  const png4k = PNG.sync.read(await qr.screenshot());
  expect(
    jsQR(new Uint8ClampedArray(png4k.data), png4k.width, png4k.height)?.data,
  ).toBe("http://localhost:3210/mobile/01-start");
  const html = await page.locator("main").innerHTML();
  for (const word of ["p-shanfeng", "山风", "小满", "4721", "Meet01"])
    expect(html).not.toContain(word);
  await expect(page.getByText("虚构动效预览")).toHaveCount(0);
});

test("mobile choice reaches screen as the same avatar and JOIN/ANSWER cues cannot change actual counts", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await profile(page);
  const screen = await context.newPage();
  await screen.setViewportSize({ width: 1920, height: 1080 });
  await screen.addInitScript(
    `(() => { window.__drawnAvatars = []; const draw = CanvasRenderingContext2D.prototype.drawImage; CanvasRenderingContext2D.prototype.drawImage = function(img, ...args) { if (img.src && !window.__drawnAvatars.includes(img.src)) window.__drawnAvatars.push(img.src); return draw.call(this, img, ...args); }; })()`,
  );
  await screen.goto("/screen/question");
  await expect(screen.getByTestId("screen-motion")).toBeVisible();
  const before = await saved(page);
  await page.getByRole("radio", { name: "男生虚拟头像 08" }).check();
  await page.getByRole("button", { name: "继续答题" }).click();
  await expect
    .poll(() =>
      screen.evaluate(
        'window.__drawnAvatars.some(src => decodeURIComponent(src).includes("male_08.png"))',
      ),
    )
    .toBe(true);
  await expect
    .poll(() =>
      screen.getByTestId("screen-motion").getAttribute("data-effects"),
    )
    .not.toBe("0");
  expect(
    (await saved(page)).participants.filter(
      (p: { present: boolean }) => p.present,
    ).length,
  ).toBe(
    before.participants.filter((p: { present: boolean }) => p.present).length,
  );
  expect((await saved(page)).invitations).toEqual(before.invitations);
  await expect
    .poll(() =>
      screen.getByTestId("screen-motion").getAttribute("data-effects"),
    )
    .toBe("0");
  await screen.close();
});

test("reduced-motion join and 4K resize keep the selected avatar visible without a queued effect; all canvas pixels leave QR clear", async ({
  page,
  context,
}) => {
  await profile(page);
  const screen = await context.newPage();
  await screen.emulateMedia({ reducedMotion: "reduce" });
  await screen.setViewportSize({ width: 1920, height: 1080 });
  await screen.addInitScript(
    `(() => { window.__drawnAvatars = []; const draw = CanvasRenderingContext2D.prototype.drawImage; CanvasRenderingContext2D.prototype.drawImage = function(img, ...args) { if (img.src && !window.__drawnAvatars.includes(img.src)) window.__drawnAvatars.push(img.src); return draw.call(this, img, ...args); }; })()`,
  );
  await screen.goto("/screen/question");
  await page.getByRole("radio", { name: "男生虚拟头像 10" }).check();
  await page.getByRole("button", { name: "继续答题" }).click();
  await expect
    .poll(() =>
      screen.evaluate(
        'window.__drawnAvatars.some(src => decodeURIComponent(src).includes("male_10.png"))',
      ),
    )
    .toBe(true);
  await expect(screen.getByTestId("screen-motion")).toHaveAttribute(
    "data-running",
    "false",
  );
  await expect(screen.getByTestId("screen-motion")).toHaveAttribute(
    "data-effects",
    "0",
  );
  for (const size of [
    { width: 1920, height: 1080 },
    { width: 3840, height: 2160 },
  ]) {
    await screen.setViewportSize(size);
    await screen.waitForTimeout(200);
    const pixels = await screen.evaluate(() => {
      const host = document.querySelector<HTMLElement>(
        '[data-testid="screen-motion"]',
      )!;
      const safe = JSON.parse(host.dataset.safe!);
      const area = JSON.parse(host.dataset.area!);
      return Array.from(host.querySelectorAll("canvas")).map((canvas) => {
        const scale = canvas.width / host.getBoundingClientRect().width;
        const c = canvas.getContext("2d")!;
        const qr = c.getImageData(
          Math.ceil(safe.x * scale) + 1,
          Math.ceil(safe.y * scale) + 1,
          Math.floor(safe.width * scale) - 3,
          Math.floor(safe.height * scale) - 3,
        ).data;
        let covered = 0;
        for (let i = 3; i < qr.length; i += 4) if (qr[i]) covered++;
        const field = c.getImageData(
          Math.ceil(area.x * scale),
          Math.ceil(area.y * scale),
          Math.floor(area.width * scale),
          Math.floor(area.height * scale),
        ).data;
        let drawn = 0;
        for (let i = 3; i < field.length; i += 4) if (field[i]) drawn++;
        return { layer: canvas.dataset.layer, covered, drawn };
      });
    });
    expect(pixels.every((p) => p.covered === 0)).toBe(true);
    expect(
      pixels.find((p) => p.layer === "relationship")!.drawn,
    ).toBeGreaterThan(200);
  }
  await screen.close();
});
