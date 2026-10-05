import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
async function main() {
  const destination = path.resolve("docs/verification/screenshots");
  await mkdir(destination, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({
    baseURL: "http://localhost:3210",
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const manifest: {
    name: string;
    route: string;
    scenario: string;
    viewport: { width: number; height: number };
    actualRoute: string;
  }[] = [];
  async function scene(name: string) {
    await page.goto("/demo");
    await page.getByTestId(`scenario-${name}`).click();
    await page.getByRole("button", { name: "确认载入", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
  }
  const captures = [
    ["M01-start", "fresh", "/mobile/01-start?actor=p-shanfeng"],
    ["M02-result", "discover", "/mobile/02-result?actor=p-shanfeng"],
    ["M03-profile", "discover", "/mobile/03-profile?actor=p-shanfeng"],
    ["M04-question", "discover", "/mobile/04-question?actor=p-shanfeng"],
    ["M05-discover", "discover", "/mobile/05-discover?actor=p-shanfeng"],
    [
      "M06-common",
      "discover",
      "/mobile/06-common?actor=p-shanfeng&target=p-xiaoman",
    ],
    ["M07-received", "waiting", "/mobile/07-invitation?actor=p-xiaoman"],
    ["M08-mutual", "mutual", "/mobile/08-mutual?actor=p-shanfeng"],
    ["M09-meet", "arrival", "/mobile/09-meet?actor=p-shanfeng"],
    ["M10-next-step", "confirmed", "/mobile/10-next-step?actor=p-shanfeng"],
    ["A01-dashboard", "help", "/admin/dashboard"],
    ["A02-encounters", "broadcast", "/admin/encounters"],
    ["A03-participants", "discover", "/admin/participants"],
    ["A04-partners", "merchant", "/admin/partners"],
    ["S01-question", "discover", "/screen/question"],
    ["S02-presence", "discover", "/screen/presence"],
    ["S03-mutual", "broadcast", "/screen/mutual"],
    ["S04-real-meet", "confirmed", "/screen/real-meet"],
    ["E01-empty", "zero", "/mobile/05-discover?actor=p-shanfeng"],
    ["E02-waiting", "waiting", "/mobile/07-invitation?actor=p-shanfeng"],
    ["E03-busy", "busy", "/mobile/08-mutual?actor=p-shanfeng"],
    ["E04-help", "help", "/mobile/09-meet?actor=p-shanfeng"],
    ["D01-demo", "fresh", "/demo"],
  ];
  try {
    for (const [name, scenario, route] of captures) {
      await scene(scenario);
      const viewport =
        name.startsWith("M") || name.startsWith("E")
          ? { width: 390, height: 844 }
          : name.startsWith("S")
            ? { width: 1920, height: 1080 }
            : { width: 1440, height: 1024 };
      await page.setViewportSize(viewport);
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      if (name === "M04-question") {
        await page.getByRole("button", { name: "下一题", exact: true }).click();
        await page.waitForTimeout(300);
      }
      await page
        .locator("img")
        .evaluateAll((images) =>
          Promise.all(images.map((img) => (img as HTMLImageElement).decode())),
        );
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({
        path: path.join(destination, `${name}.png`),
        fullPage: !name.startsWith("A") && !name.startsWith("S"),
      });
      manifest.push({
        name,
        route,
        scenario,
        viewport,
        actualRoute: new URL(page.url()).pathname,
      });
      console.log(name);
    }
  } finally {
    await browser.close();
  }
  await writeFile(
    path.join(destination, "manifest.json"),
    JSON.stringify(
      { capturedAt: new Date().toISOString(), manifest, errors },
      null,
      2,
    ),
  );
  if (errors.length) throw new Error(errors.join("\n"));
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
