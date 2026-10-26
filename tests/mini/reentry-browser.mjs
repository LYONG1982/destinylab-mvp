// Actual React/Taro pages and API, with native components adapted to Chromium.
// This does not validate wx.login, native QR scanning, or physical devices.
import { build } from "esbuild";
import { createRequire } from "node:module";
import { createServer, request as proxyRequest } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { chromium, expect } from "@playwright/test";

const root = process.cwd(),
  out = process.env.REENTRY_UI_DIR;
if (!out?.startsWith("/tmp/destinylab-reentry-"))
  throw Error("Dedicated synthetic test directory required");
const origin = "http://127.0.0.1:3240",
  miniOrigin = "http://127.0.0.1:3241";
const fixtures = JSON.parse(readFileSync(`${out}/ui-fixture.json`, "utf8"));
const requireMini = createRequire(resolve(root, "miniapp/package.json"));
const shim = `import React,{useEffect} from 'react';
export const View=({children,...p})=>React.createElement('div',p,children);
export const Text=({children,...p})=>React.createElement('span',p,children);
export const Button=({children,...p})=>React.createElement('button',{type:'button',...p},children);
export const Image=({mode,...p})=>React.createElement('img',p);
export const Input=({onInput,maxlength,...p})=>React.createElement('input',{...p,maxLength:maxlength,onChange:e=>onInput?.({detail:{value:e.target.value}})});
export const Textarea=({onInput,maxlength,...p})=>React.createElement('textarea',{...p,maxLength:maxlength,onChange:e=>onInput?.({detail:{value:e.target.value}})});
export const Switch=({onChange,color,...p})=>React.createElement('input',{...p,type:'checkbox',onChange:e=>onChange?.({detail:{value:e.target.checked}})});
export const Picker=({range,value,onChange,disabled,children})=>React.createElement('div',{},children,React.createElement('select',{disabled,value,onChange:e=>onChange({detail:{value:e.target.value}})},range.map((x,n)=>React.createElement('option',{key:n,value:n},x))));
export const useLoad=fn=>useEffect(()=>{fn(Object.fromEntries(new URLSearchParams(location.search)))},[]);
export const useDidShow=fn=>useEffect(()=>{const show=()=>fn();window.addEventListener('test-show',show);return()=>window.removeEventListener('test-show',show)},[]);
export const useDidHide=fn=>useEffect(()=>{window.addEventListener('test-hide',fn);return()=>window.removeEventListener('test-hide',fn)},[]);
export const useUnload=fn=>useEffect(()=>()=>fn(),[]);
export const useShareAppMessage=()=>{};
const navigate=async({url})=>{location.href=url};
const Taro={getStorageSync:k=>localStorage.getItem(k),setStorageSync:(k,v)=>localStorage.setItem(k,v),removeStorageSync:k=>localStorage.removeItem(k),
request:async({url,method,data,header})=>{const r=await fetch(url,{method,headers:header,body:method==='GET'?undefined:JSON.stringify(data)});return {statusCode:r.status,data:await r.json()}},
getFileSystemManager:()=>({unlink:()=>{}}),redirectTo:navigate,reLaunch:async({url})=>{window.relaunches.push(url);location.href=url},navigateTo:navigate,
getEnterOptionsSync:()=>window.testEntryOptions||({path:'pages/encounter/index',query:{scene:new URLSearchParams(location.search).get('scene')}}),
getCurrentPages:()=>[{route:location.pathname.slice(1)}],
showModal:async()=>({confirm:true}),canIUse:()=>false,
downloadFile:async()=>{throw Error('Native download outside this adapter')},login:async()=>{throw Error('Native login outside this adapter')}};export default Taro;`;
const result = await build({
  stdin: {
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';import Encounter from './miniapp/src/pages/encounter/index';import Index from './miniapp/src/pages/index/index';import App from './miniapp/src/app';window.relaunches=[];const app=new App({});window.appShow=()=>app.componentDidShow();const page=location.pathname.includes('/pages/index/')?Index:Encounter;createRoot(document.getElementById('root')).render(React.createElement(page));`,
    resolveDir: root,
    loader: "tsx",
  },
  bundle: true,
  write: false,
  jsx: "automatic",
  format: "iife",
  define: {
    "process.env.TARO_APP_API_ORIGIN": JSON.stringify(miniOrigin),
    "process.env.TARO_APP_ACTIVITY_ID": '"reentry-uat"',
    "process.env.NODE_ENV": '"development"',
  },
  plugins: [
    {
      name: "native-test-adapter",
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
const css = [
  "miniapp/src/components/registration.scss",
  "miniapp/src/pages/index/index.scss",
]
  .map((p) =>
    requireMini("sass")
      .compile(resolve(root, p))
      .css.replace(/([\d.]+)rpx/g, (_, n) => `${Number(n) / 2}px`),
  )
  .join("\n");
const server = createServer((req, res) => {
  if (req.url.startsWith("/api/") || req.url.startsWith("/assets/")) {
    const proxy = proxyRequest(
      {
        hostname: "127.0.0.1",
        port: 3240,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: "127.0.0.1:3240" },
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
    res.end(result.outputFiles[0].contents);
    return;
  }
  res.setHeader("Content-Type", "text/html");
  res.end(
    `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}button,input,select,textarea{font:inherit}*{box-sizing:border-box}${css}</style><div id="root"></div><script src="/app.js"></script>`,
  );
});
await new Promise((resolve) => server.listen(3241, "127.0.0.1", resolve));
expect.configure({ timeout: 20000 });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [],
  errors = [];
async function admin(f, path, data) {
  const r = await fetch(
    `${origin}/api/${path}?activity=${f.activity}&audience=operator`,
    {
      method: data ? "POST" : "GET",
      headers: {
        Cookie: `dl-operator-${f.activity}=${f.operatorToken}`,
        Origin: origin,
        "Content-Type": "application/json",
        "Idempotency-Key": randomUUID(),
      },
      body: data ? JSON.stringify(data) : undefined,
    },
  );
  const body = await r.json();
  if (!r.ok) throw Error(`${path}: ${JSON.stringify(body)}`);
  return body;
}
const snapshot = async (f) => (await admin(f, "live/snapshot")).state;
async function action(f, action) {
  const input = {
    action,
    epoch: (await snapshot(f)).epoch,
    ids: ["leave", "return", "remove"].includes(action) ? [f.actor] : [],
  };
  const preview = await admin(f, "field/preview", input);
  await admin(f, "field/action", { ...input, preview: preview.token });
}
try {
  for (const f of fixtures) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    const isMini = f.kind.startsWith("mini"),
      partial = f.kind.endsWith("partial");
    if (isMini)
      await context.addInitScript(
        ({ key, token }) => localStorage.setItem(key, token),
        { key: `destiny-mini:${miniOrigin}:${f.activity}`, token: f.token },
      );
    else
      await context.addCookies([
        { name: `dl-participant-${f.activity}`, value: f.token, url: origin },
      ]);
    const before = await snapshot(f),
      original = before.participants.find((p) => p.id === f.actor);
    await action(f, "leave");
    const start = isMini
      ? `${miniOrigin}/pages/encounter/index?scene=${f.scene}`
      : `${origin}/mobile/01-start?activity=${f.activity}`;
    let reentries = 0;
    page.on("request", (r) => {
      if (r.url().includes("/reenter?") && r.method() === "POST") reentries++;
    });
    await page.goto(start);
    const enter = page.getByRole("button", {
      name: isMini ? "进入现场互动" : "继续参与",
      exact: true,
    });
    await expect(enter).toBeVisible();
    await page.reload();
    await expect(enter).toBeVisible();
    expect(reentries).toBe(0);
    expect((await snapshot(f)).participants[0].present).toBe(false);
    if (!partial) {
      await page.route("**/reenter?**", (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "合成测试：暂时无法恢复，请重试" }),
        }),
      );
      await enter.click();
      await expect(
        page
          .getByText("合成测试：暂时无法恢复，请重试", { exact: true })
          .first(),
      ).toBeVisible();
      expect((await snapshot(f)).participants[0].present).toBe(false);
      await page.unroute("**/reenter?**");
    }
    const count = reentries;
    await enter.click();
    if (isMini) await page.waitForURL("**/pages/index/index?**");
    else
      await page.waitForURL(
        partial ? "**/mobile/04-question?**" : "**/mobile/05-discover?**",
      );
    if (!partial && isMini)
      await expect(
        page.getByText("发现同频的人", { exact: true }),
      ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "继续参与", exact: true }),
    ).toHaveCount(0);
    expect(reentries - count).toBe(1);
    let after = await snapshot(f);
    expect(after.participants.length).toBe(1);
    expect(after.scans).toEqual(before.scans);
    expect(after.participants[0]).toEqual({
      ...original,
      present: true,
      ready: false,
      currentId: null,
    });
    if (partial)
      expect(Object.keys(after.participants[0].answers)).toHaveLength(3);
    await page.screenshot({
      path: `${out}/${f.kind}-restored.png`,
      fullPage: true,
    });
    if (!partial) {
      await action(f, "leave");
      await expect(
        page.getByRole("button", { name: "继续参与", exact: true }),
      ).toBeVisible();
      const idleCount = reentries;
      if (isMini)
        await page.evaluate(() => window.dispatchEvent(new Event("test-show")));
      await page.reload();
      await expect(
        page.getByRole("button", { name: "继续参与", exact: true }),
      ).toBeVisible();
      expect(reentries).toBe(idleCount);
      // Repeated scanning of the same code retains an actionable entry.
      if (isMini) {
        await page.evaluate(
          ({ scene }) => {
            window.testEntryOptions = {
              path: "pages/encounter/index",
              query: { scene },
            };
            window.appShow();
          },
          { scene: f.scene },
        );
        await page.waitForURL("**/pages/encounter/index?scene=**");
        await expect(
          page.getByRole("button", { name: "进入现场互动", exact: true }),
        ).toBeVisible();
        await page.evaluate(() => window.appShow());
        await expect(
          page.getByRole("button", { name: "进入现场互动", exact: true }),
        ).toBeVisible();
      }
      expect((await snapshot(f)).participants[0].present).toBe(false);
      await page
        .getByRole("button", {
          name: isMini ? "进入现场互动" : "继续参与",
          exact: true,
        })
        .click();
      await expect
        .poll(async () => (await snapshot(f)).participants[0].present)
        .toBe(true);
      await action(f, "close");
      await expect(page.getByText(/现场暂未开放/).first()).toBeVisible();
      await expect(
        page.getByRole("button", { name: "继续参与", exact: true }),
      ).toHaveCount(0);
      await action(f, "open");
      await action(f, "remove");
      await page.goto(start);
      if (isMini)
        await page
          .getByRole("button", { name: "进入现场互动", exact: true })
          .click();
      await expect(page.getByText(/你已从本场移除/).first()).toBeVisible();
      expect((await snapshot(f)).participants.length).toBe(0);
    }
    results.push({
      kind: f.kind,
      oneClick: true,
      identityAndAnswersPreserved: true,
      noImplicitRestore: true,
      partialAnswers: partial,
    });
    await context.close();
  }
  expect(errors).toEqual([]);
  writeFileSync(
    `${out}/ui-results.json`,
    JSON.stringify(
      {
        results,
        pageErrors: errors,
        miniRuntime:
          "Real React/Taro components in Chromium adapter; not physical WeChat",
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: H5 and mini complete/partial flows, error retry, reload, repeated entry, closed field and removal.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
