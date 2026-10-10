import { test, expect, type Page } from "@playwright/test";
import { createSeed } from "../../src/data/seed";
import { applyCommand } from "../../src/domain/commands";
import type { DemoState } from "../../src/domain/types";
import jsQR from "jsqr";
import { PNG } from "pngjs";
const evidence = "docs/verification/destiny-field-act3-v2";
async function seed(page: Page, state = createSeed("discover")) {
  await page.addInitScript((s) => {
    if (!localStorage.getItem("destinylab:v1.1:state"))
      localStorage.setItem("destinylab:v1.1:state", JSON.stringify(s));
  }, state);
}
async function write(page: Page, s: DemoState) {
  await page.evaluate((state) => {
    localStorage.setItem("destinylab:v1.1:state", JSON.stringify(state));
    window.dispatchEvent(
      new StorageEvent("storage", { key: "destinylab:v1.1:state" }),
    );
  }, s);
}
async function qr(page: Page) {
  const img = page.getByTestId("world-qr").locator("img");
  const png = PNG.sync.read(await img.screenshot());
  expect(
    jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data,
  ).toBe("http://localhost:3210/mobile/01-start");
}

test("profiled mobile answer joins selected field 59 to 60 with nickname; QR pixels and rectangle stay unchanged", async ({
  page,
  context,
}) => {
  const fresh = createSeed("fresh");
  const state = applyCommand(
    fresh,
    {
      actor: "p-shanfeng",
      id: "prepare",
      epoch: fresh.epoch,
      command: {
        type: "profile",
        name: "晚风",
        gender: "male",
        age: "26–29",
        ready: true,
        avatarId: "male_08",
      },
    },
    fresh.now,
  );
  await seed(page, state);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/screen/question");
  const stage = page.getByTestId("destiny-world");
  await expect(stage).toHaveAttribute("data-renderer", "webgl");
  const field = page.locator('[data-field-id="q1:1"]');
  await expect(field.locator("p [data-number]")).toHaveText("59");
  const code = page.getByTestId("world-qr").locator("img");
  const before = await code.screenshot();
  const box = await code.boundingBox();
  const phone = await context.newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.goto("/mobile/01-start");
  await phone.getByRole("button", { name: /一起逛逛/ }).click();
  await expect(
    page
      .locator('[data-world-player][data-avatar$="male_08.png"]')
      .filter({ hasText: "晚风" }),
  ).toBeVisible();
  await expect(field.locator("p [data-number]")).toHaveText("60");
  await expect(field.locator(":scope > span [data-number]")).toHaveText("42");
  await page.screenshot({ path: `${evidence}/join.png` });

  expect(
    PNG.sync
      .read(await code.screenshot())
      .data.equals(PNG.sync.read(before).data),
  ).toBe(true);
  expect(await code.boundingBox()).toEqual(box);
  await qr(page);

  await phone.close();
});

// Size, persistent-world, Reduced Motion and WebGL failure coverage lives in destiny-field.spec.ts.
test("zero state shows waiting without misleading zero percentages; low counts emphasize people", async ({
  page,
}) => {
  const state = createSeed("fresh");
  state.responses = {};
  state.participants = state.participants.map((p) => ({ ...p, answers: {} }));
  await seed(page, state);
  await page.goto("/screen/question");
  await expect(page.getByText("等待第一个选择", { exact: true })).toHaveCount(
    3,
  );
  await expect(page.locator("[data-field-id] > span")).toHaveCount(0);
  const next = applyCommand(
    state,
    {
      actor: "p-shanfeng",
      id: "first",
      epoch: state.epoch,
      command: { type: "answer", questionId: "q1", value: "轻松聊聊" },
    },
    state.now,
  );
  await write(page, next);
  await expect(
    page.locator('[data-field-id="q1:0"] p [data-number]'),
  ).toHaveText("1");
  await expect(page.locator('[data-field-id="q1:0"] > span')).toHaveText(
    "100%",
  );
  await page.screenshot({ path: `${evidence}/cold-start.png` });
});

test("meet point label survives while direction/distance disappear and encounter code keeps its original value", async ({
  page,
}) => {
  await seed(page, createSeed("arrival"));
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ["08-mutual", "09-meet"]) {
    await page.goto(`/mobile/${route}?actor=p-shanfeng`);
    await expect(page.locator("main")).not.toContainText(
      "主屏右侧 · 1｜1 装置旁",
    );
    await expect(page.locator("main")).not.toContainText("步行约");
  }
  await expect(page.locator(".verification-code small")).toHaveText(
    "缘分相遇码",
  );
  const state = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("destinylab:v1.1:state")!) as DemoState,
  );
  const invitation = state.invitations.find(
    (i) => i.id === state.participants[0].currentId,
  )!;
  await expect(page.locator(".verification-code strong")).toHaveText(
    invitation.code,
  );
  await expect(page.locator(".pass-top > span strong")).toHaveText("01");
  await page.screenshot({
    path: `${evidence}/meet-simplified.png`,
    fullPage: true,
  });
});
