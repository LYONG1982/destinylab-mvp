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
  await page.getByRole("button", { name: /一起逛逛/ }).click();
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
  await expect(page.locator(".avatar-selector .field-error")).toHaveText(
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
  await expect(page.locator('.avatar-selector input:checked')).toHaveCount(0);
  await expect(page.locator(".avatar-selector .field-error")).toContainText("女生头像");
  await page.getByRole("radio", { name: "女生虚拟头像 07" }).check();
  await page.getByRole("button", { name: "男生", exact: true }).click();
  await expect(page.locator('.avatar-selector input:checked')).toHaveCount(0);
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
    path: "docs/verification/destiny-field-act3-v2/regression/answer-motion/M03-selected.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "继续答题" }).click();
  await expect(page).toHaveURL(/04-question/);
  await expect(
    page.getByRole("status").filter({ hasText: "欢迎进入遇见-缘分实验室" }),
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

// The old Canvas2D/PPT dissolve checks moved to destiny-field.spec.ts;
// these tests retain real mobile-to-world avatar and business-state integration.
test("a real mobile avatar selection enters the World without adding a second answer or meeting", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await profile(page);
  const screen = await context.newPage();
  await screen.setViewportSize({ width: 1920, height: 1080 });
  await screen.goto("/screen/question");
  const world = screen.getByTestId("destiny-world");
  await expect(world).toHaveAttribute("data-renderer", "webgl");
  const before = await saved(page);
  await expect(world).toHaveAttribute(
    "data-total",
    String(Object.keys(before.responses).length),
  );
  await page.getByRole("radio", { name: "男生虚拟头像 08" }).check();
  await page.getByRole("button", { name: "继续答题" }).click();
  const selectedAvatar = screen
    .locator('[data-world-player][data-avatar$="male_08.png"]')
    .filter({ hasText: "山风" })
    .locator("img");
  await expect(selectedAvatar).toBeVisible();
  await expect(selectedAvatar).toHaveAttribute("src", /male_08\.png$/);
  await expect
    .poll(() =>
      selectedAvatar.evaluate(
        (img) =>
          (img as HTMLImageElement).complete &&
          (img as HTMLImageElement).naturalWidth > 0,
      ),
    )
    .toBe(true);
  await expect(
    screen
      .locator('[data-world-player][data-avatar$="male_08.png"]')
      .filter({ hasText: "山风" }),
  ).toBeVisible();
  const after = await saved(page);
  expect(after.responses).toEqual(before.responses);
  await expect(world).toHaveAttribute(
    "data-total",
    String(Object.keys(before.responses).length),
  );
  await expect(world).toHaveAttribute(
    "data-current",
    String(
      before.participants.filter((p: { present: boolean }) => p.present).length,
    ),
  );
  expect(
    after.participants.filter((p: { present: boolean }) => p.present).length,
  ).toBe(
    before.participants.filter((p: { present: boolean }) => p.present).length,
  );
  expect(after.invitations).toEqual(before.invitations);
  await screen.close();
});
test("real selected avatar remains visible with reduced motion and 4K; hiding pauses the World", async ({
  page,
  context,
}) => {
  await profile(page);
  const screen = await context.newPage();
  await screen.emulateMedia({ reducedMotion: "reduce" });
  await screen.setViewportSize({ width: 1920, height: 1080 });
  await screen.goto("/screen/question");
  const world = screen.getByTestId("destiny-world");
  await expect(world).toHaveAttribute("data-renderer", "webgl");
  await page.getByRole("radio", { name: "男生虚拟头像 10" }).check();
  await page.getByRole("button", { name: "继续答题" }).click();
  const selectedAvatar = screen
    .locator('[data-world-player][data-avatar$="male_10.png"]')
    .filter({ hasText: "山风" })
    .locator("img");
  await expect(selectedAvatar).toBeVisible();
  await expect(selectedAvatar).toHaveAttribute("src", /male_10\.png$/);
  await expect
    .poll(() =>
      selectedAvatar.evaluate(
        (img) =>
          (img as HTMLImageElement).complete &&
          (img as HTMLImageElement).naturalWidth > 0,
      ),
    )
    .toBe(true);
  for (const size of [
    { width: 1920, height: 1080 },
    { width: 3840, height: 2160 },
  ]) {
    await screen.setViewportSize(size);
    await expect(world).toHaveAttribute("data-running", "false");
    await expect(
      screen
        .locator('[data-world-player][data-avatar$="male_10.png"]')
        .filter({ hasText: "山风" }),
    ).toBeVisible();
    const qr = screen.getByTestId("world-qr").locator("img");
    const png = PNG.sync.read(await qr.screenshot());
    expect(
      jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data,
    ).toBe("http://localhost:3210/mobile/01-start");
  }
  await screen.emulateMedia({ reducedMotion: "no-preference" });
  await expect(world).toHaveAttribute("data-running", "true");
  await screen.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(world).toHaveAttribute("data-running", "false");
  const frames = await world.getAttribute("data-frames");
  await screen.waitForTimeout(350);
  expect(await world.getAttribute("data-frames")).toBe(frames);
  await screen.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(world).toHaveAttribute("data-running", "true");
  await screen.close();
});
