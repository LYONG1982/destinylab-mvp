// Real mini React/Taro page and real local API, hosted by a small Chromium adapter.
// This validates app logic and protocol headers; it does not emulate wx.login or WeChat devices.
import { build } from "esbuild";
import { createRequire } from "node:module";
import { createServer, request as proxyRequest } from "node:http";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";

const root = process.cwd();
const evidenceDir = "docs/verification/2026-10-26-520-uat";
const baseURL = process.env.DESTINY_520_BASE_URL || "http://127.0.0.1:3244";
if (new URL(baseURL).origin !== "http://127.0.0.1:3244")
  throw Error(
    "520 mini journey requires the isolated local service on port 3244",
  );
const dbUrl = new URL(process.env.DATABASE_URL || "http://invalid");
if (!dbUrl.pathname.endsWith("_test") || dbUrl.hostname !== "127.0.0.1")
  throw Error("520 mini journey requires a dedicated local _test database");

// Seed synthetic identities in a server-condition child, keeping the browser build in normal React.
const seedCode = `
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { database } = require('./src/server/db.ts');
const { emptyActivity } = require('./src/server/state.ts');
const { miniEnter, miniLogin } = require('./src/server/wechat-service.ts');
const activity = 'mini520-' + crypto.randomUUID().replaceAll('-', '').slice(0, 16);
await database().query('INSERT INTO dl_activities(id,state) VALUES($1,$2::jsonb)', [activity, JSON.stringify(emptyActivity())]);
const users = [];
for (const name of ['松风','晚晴']) {
  const auth = await miniLogin(activity, crypto.randomUUID(), async () => ({ appid: process.env.DESTINY_WECHAT_APPID, openid: crypto.randomUUID() }));
  const joined = await miniEnter(auth.identity, activity);
  users.push({ name, token: auth.token, actor: joined.actor });
}
await database().end();
process.stdout.write(JSON.stringify({ activity, users }));
`;
const seeded = spawnSync(
  process.execPath,
  [
    "--conditions=react-server",
    "--import",
    "tsx",
    "--input-type=module",
    "-e",
    seedCode,
  ],
  { encoding: "utf8", env: process.env },
);
if (seeded.status !== 0)
  throw Error(`Synthetic mini fixture setup failed: ${seeded.stderr}`);
const { activity, users } = JSON.parse(seeded.stdout);
const adminLogin = JSON.parse(
  readFileSync(process.env.DESTINY_LIVE_TEST_LOGIN, "utf8"),
);
const loginResponse = await fetch(
  `${baseURL}/api/live/login?activity=${activity}&audience=operator`,
  {
    method: "POST",
    headers: { Origin: baseURL, "Content-Type": "application/json" },
    body: JSON.stringify(adminLogin),
  },
);
if (!loginResponse.ok)
  throw Error(`Operator login failed (${loginResponse.status})`);
const cookie = loginResponse.headers
  .getSetCookie()
  .map((part) => part.split(";", 1)[0])
  .join("; ");
const initial = await fetch(
  `${baseURL}/api/live/snapshot?activity=${activity}&audience=operator`,
  { headers: { Cookie: cookie } },
);
if (!initial.ok) throw Error(`Operator snapshot failed (${initial.status})`);
const current = await initial.json();
const configured = await fetch(
  `${baseURL}/api/live/command?activity=${activity}&audience=operator`,
  {
    method: "POST",
    headers: {
      Origin: baseURL,
      Cookie: cookie,
      "Content-Type": "application/json",
      "X-Destiny-Protocol": "520-v1",
      "Idempotency-Key": randomUUID(),
    },
    body: JSON.stringify({
      epoch: current.state.epoch,
      command: {
        type: "point-config",
        pointId: "meet-1",
        location: "北厅·木窗旁",
        capacity: 2,
      },
    }),
  },
);
if (!configured.ok)
  throw Error(`Point configuration failed (${configured.status})`);

const requireMini = createRequire(resolve(root, "miniapp/package.json"));
const shim = `import React,{useEffect} from 'react';
export const View=({children,...p})=>React.createElement('div',p,children);
export const Text=({children,...p})=>React.createElement('span',p,children);
export const Button=({children,...p})=>React.createElement('button',{type:'button',...p},children);
export const Image=({mode,...p})=>React.createElement('img',p);
export const Input=({onInput,maxlength,...p})=>React.createElement('input',{...p,maxLength:maxlength,onChange:e=>onInput?.({detail:{value:e.target.value}})});
export const Textarea=({onInput,maxlength,...p})=>React.createElement('textarea',{...p,maxLength:maxlength,onChange:e=>onInput?.({detail:{value:e.target.value}})});
export const Switch=({onChange,color,checked,...p})=>React.createElement('input',{...p,type:'checkbox',defaultChecked:checked,onChange:e=>onChange?.({detail:{value:e.target.checked}})});
export const Picker=({range,value,onChange,disabled,children})=>React.createElement('div',{},children,React.createElement('select',{disabled,value,onChange:e=>onChange({detail:{value:e.target.value}})},range.map((x,n)=>React.createElement('option',{key:n,value:n},x))));
export const useLoad=fn=>useEffect(()=>{fn(Object.fromEntries(new URLSearchParams(location.search)))},[]);
export const useDidShow=fn=>useEffect(()=>{const show=()=>fn();window.addEventListener('test-show',show);return()=>window.removeEventListener('test-show',show)},[]);
export const useDidHide=fn=>useEffect(()=>{window.addEventListener('test-hide',fn);return()=>window.removeEventListener('test-hide',fn)},[]);
export const useUnload=fn=>useEffect(()=>()=>fn(),[]);
const navigate=async({url})=>{location.href=url};
const Taro={getStorageSync:k=>localStorage.getItem(k),setStorageSync:(k,v)=>localStorage.setItem(k,v),removeStorageSync:k=>localStorage.removeItem(k),
request:async({url,method,data,header})=>{const r=await fetch(url,{method,headers:header,body:method==='GET'?undefined:JSON.stringify(data)});return {statusCode:r.status,data:await r.json()}},
getFileSystemManager:()=>({unlink:()=>{}}),redirectTo:navigate,reLaunch:navigate,navigateTo:navigate,getEnterOptionsSync:()=>({path:'pages/index/index',query:{}}),getCurrentPages:()=>[{route:location.pathname.slice(1)}],showModal:async()=>({confirm:true}),canIUse:()=>false,downloadFile:async()=>{throw Error('Native download outside adapter')},login:async()=>{throw Error('Native login outside adapter')}};export default Taro;`;
const bundled = await build({
  stdin: {
    contents: `import React from 'react';import{createRoot}from'react-dom/client';import Index from './miniapp/src/pages/index/index';createRoot(document.getElementById('root')).render(React.createElement(Index));`,
    resolveDir: root,
    loader: "tsx",
  },
  bundle: true,
  write: false,
  jsx: "automatic",
  format: "iife",
  define: {
    "process.env.TARO_APP_API_ORIGIN": "window.__API_ORIGIN__",
    "process.env.TARO_APP_ACTIVITY_ID": JSON.stringify(activity),
    "process.env.NODE_ENV": '"development"',
  },
  plugins: [
    {
      name: "mini-browser-adapter",
      setup(b) {
        b.onResolve({ filter: /^@tarojs\/(taro|components)$/ }, () => ({
          path: "shim",
          namespace: "test",
        }));
        b.onLoad({ filter: /.*/, namespace: "test" }, () => ({
          contents: shim,
          loader: "js",
          resolveDir: root,
        }));
        b.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, (args) => ({
          path: requireMini.resolve(args.path),
        }));
        b.onResolve({ filter: /^@\// }, (args) => ({
          path: resolve(root, "src", args.path.slice(2) + ".ts"),
        }));
        b.onLoad({ filter: /\.scss$/ }, () => ({ contents: "", loader: "js" }));
      },
    },
  ],
});
const css = requireMini("sass")
  .compile(resolve(root, "miniapp/src/pages/index/index.scss"))
  .css.replace(/([\d.]+)rpx/g, (_, n) => `${Number(n) / 2}px`);
let apiOrigin = "";
const seen = [];
const server = createServer((req, res) => {
  if (req.url.startsWith("/api/") || req.url.startsWith("/assets/")) {
    const headers = { ...req.headers, host: "127.0.0.1:3244", origin: baseURL };
    if (req.url.startsWith("/api/"))
      seen.push({
        url: req.url,
        protocol: req.headers["x-destiny-protocol"] || "",
      });
    const proxy = proxyRequest(
      {
        hostname: "127.0.0.1",
        port: 3244,
        path: req.url,
        method: req.method,
        headers,
      },
      (r) => {
        res.writeHead(r.statusCode, r.headers);
        r.pipe(res);
      },
    );
    proxy.on("error", () => {
      res.writeHead(502);
      res.end("{}");
    });
    req.pipe(proxy);
    return;
  }
  if (req.url === "/app.js") {
    res.setHeader("Content-Type", "text/javascript");
    res.end(bundled.outputFiles[0].contents);
    return;
  }
  res.setHeader("Content-Type", "text/html");
  res.end(
    `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}button,input,select,textarea{font:inherit}*{box-sizing:border-box}${css}</style><script>window.__API_ORIGIN__=${JSON.stringify(apiOrigin)}</script><div id="root"></div><script src="/app.js"></script>`,
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
apiOrigin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const failures = [];
const browserDiagnostics = [];
try {
  const pages = [];
  for (const user of users) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    await context.addInitScript(
      ({ key, token }) => localStorage.setItem(key, token),
      {
        key: `destiny-mini:${apiOrigin}:${activity}`,
        token: user.token,
      },
    );
    const page = await context.newPage();
    page.on("pageerror", (error) =>
      failures.push(error.stack || error.message),
    );
    page.on("console", (message) => {
      if (message.type() === "error") browserDiagnostics.push(message.text());
    });
    page.on("requestfailed", (request) =>
      browserDiagnostics.push(
        `${request.url()} ${request.failure()?.errorText}`,
      ),
    );
    await page.goto(`${apiOrigin}/pages/index/index?activity=${activity}`);
    pages.push({ context, page, actor: user.actor, name: user.name });
  }
  async function completeJourney(item, female) {
    const { page } = item;
    await page.waitForTimeout(1000);
    if (!(await page.getByRole("button", { name: /轻松聊聊/ }).count()))
      console.error(
        JSON.stringify({
          miniPageText: await page.locator("body").innerText(),
          requests: seen,
          pageErrors: failures,
          browserDiagnostics,
        }),
      );
    await expect(page.getByRole("button", { name: /轻松聊聊/ })).toBeVisible();
    await page.getByRole("button", { name: /轻松聊聊/ }).click();
    await page
      .getByRole("button", { name: "完善活动资料", exact: true })
      .click();
    await page.getByPlaceholder("1–5 个汉字").fill(item.name);
    if (female)
      await page.getByRole("button", { name: "女生", exact: true }).click();
    await page.locator(".permission input[type=checkbox]").check();
    await page
      .getByRole("button", { name: "保存，继续探索", exact: true })
      .click();
    for (let i = 1; i < 6; i++) {
      const option = page
        .getByRole("button", {
          name: /美食与探店|出去走走|聊得来|主动找话题|先做朋友/,
        })
        .first();
      await expect(option).toBeVisible();
      await option.click();
    }
    await expect(page.getByText("发现同频的人", { exact: true })).toBeVisible();
  }
  await completeJourney(pages[0], false);
  await completeJourney(pages[1], true);
  const [a, b] = pages;
  await a.page.locator(".candidate").click();
  await a.page
    .getByRole("button", { name: "发出相遇邀请", exact: true })
    .click();
  await expect(a.page.getByText("邀请已送出", { exact: true })).toBeVisible();
  await expect(
    b.page.getByRole("button", { name: "确认认识", exact: true }),
  ).toBeVisible();
  await b.page.getByRole("button", { name: "确认认识", exact: true }).click();
  await expect(a.page.locator(".meeting-code")).toContainText(
    /我的相遇码\s+\d{3}/,
  );
  await expect(b.page.locator(".meeting-code")).toContainText(
    /我的相遇码\s+\d{3}/,
  );
  await expect(a.page.locator(".card")).toContainText("在 Meet01 相遇");
  await expect(a.page.locator(".card")).toContainText("北厅·木窗旁");
  const codes = await Promise.all(
    pages.map(
      async ({ page }) =>
        (await page.locator(".meeting-code").innerText()).match(
          /\b(\d{3})\b/,
        )?.[1] || "",
    ),
  );
  expect(codes[0]).not.toBe(codes[1]);
  expect(Number(codes[0]) + Number(codes[1])).toBe(520);
  expect(seen.length).toBeGreaterThan(0);
  expect(
    seen.every((entry) => entry.protocol === "520-v1"),
    JSON.stringify(seen.filter((entry) => entry.protocol !== "520-v1")),
  ).toBe(true);
  expect(failures).toEqual([]);
  mkdirSync(evidenceDir, { recursive: true });
  await Promise.all(
    pages.map(({ page }, index) =>
      page.screenshot({
        path: `${evidenceDir}/mini-personal-code-${index + 1}.png`,
        fullPage: true,
      }),
    ),
  );
  writeFileSync(
    `${evidenceDir}/mini-520-results.json`,
    JSON.stringify(
      {
        activity,
        actors: pages.map((x) => x.actor),
        codes,
        protocolHeaders: seen.length,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify(
      {
        result: "PASS",
        activity,
        actors: pages.map((x) => x.actor),
        codes,
        protocolHeaders: seen.length,
        runtime:
          "React/Taro Chromium adapter using local mini API; no physical WeChat verification",
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
