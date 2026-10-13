// Browser adapter for the real React/Taro registration component. This verifies
// UI state and server integration, NOT WeChat native widgets or real wx.login.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { createServer, request } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = process.cwd(), out = process.env.MINI_UI_DIR;
if (!out || !out.startsWith('/tmp/destinylab-weapp-')) throw Error('Dedicated temporary output directory required');
const requireMini = createRequire(resolve(root, 'miniapp/package.json'));
const origin = 'http://127.0.0.1:3228';
const shim = `import React,{useEffect} from 'react';
export const View=({children,...p})=>React.createElement('view',p,children);
export const Text=({children,...p})=>React.createElement('text',p,children);
export const Button=({children,...p})=>React.createElement('button',{type:'button',...p},children);
export const Image=({mode,...p})=>React.createElement('img',p);
export const Input=({onInput,maxlength,...p})=>React.createElement('input',{...p,maxLength:maxlength,onChange:e=>onInput?.({detail:{value:e.target.value}})});
export const Textarea=({onInput,maxlength,...p})=>React.createElement('textarea',{...p,maxLength:maxlength,onChange:e=>onInput?.({detail:{value:e.target.value}})});
export const Switch=({onChange,color,...p})=>React.createElement('input',{...p,type:'checkbox',onChange:e=>onChange?.({detail:{value:e.target.checked}})});
export const Picker=({range,value,onChange,disabled,children})=>React.createElement('picker',{style:{position:'relative',display:'block'}},children,React.createElement('select',{style:{position:'absolute',inset:0,opacity:0,width:'100%',height:'100%'},disabled,value,onChange:e=>onChange({detail:{value:e.target.value}})},range.map((x,n)=>React.createElement('option',{key:n,value:n},x))));
export const useLoad=fn=>useEffect(()=>{fn(Object.fromEntries(new URLSearchParams(location.search)))},[]);
export const useDidShow=()=>{}; export const useDidHide=()=>{}; export const useUnload=()=>{};
export const useShareAppMessage=fn=>{window.sharePayload=fn};
const Taro={
getStorageSync:k=>localStorage.getItem(k),setStorageSync:(k,v)=>localStorage.setItem(k,v),removeStorageSync:k=>localStorage.removeItem(k),
request:async({url,method,data,header})=>{const r=await fetch(url,{method,headers:header,body:method==='GET'?undefined:JSON.stringify(data)});return{statusCode:r.status,data:await r.json()}},
getFileSystemManager:()=>({unlink:()=>{}}),
showModal:async()=>({confirm:true}),
redirectTo:async({url})=>{const parsed=new URL(url,location.origin);location.href='/?entry='+(parsed.pathname.includes('encounter')?'encounter':'registration')+'&'+parsed.searchParams.toString()},
navigateTo:async()=>{},
canIUse:()=>false,
downloadFile:async()=>{throw Error('Native photo preview is covered separately by API tests')},
login:async()=>{throw Error('Real WeChat login intentionally unavailable in browser harness')}
}; export default Taro;`;
const result = await build({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {RegistrationPage} from './miniapp/src/components/RegistrationPage'; const entry=new URLSearchParams(location.search).get('entry')==='encounter'?'encounter':'registration';createRoot(document.getElementById('root')).render(React.createElement(RegistrationPage,{entry}));`, resolveDir: root, loader: 'tsx' },
  bundle: true, write: false, jsx: 'automatic', format: 'iife',
  define: { 'process.env.TARO_APP_API_ORIGIN': JSON.stringify(origin), 'process.env.TARO_APP_ACTIVITY_ID': '"weapp-uat"', 'process.env.NODE_ENV': '"development"' },
  plugins: [{ name: 'native-test-adapter', setup(b) {
    b.onResolve({ filter: /^@tarojs\/(taro|components)$/ },()=>({path:'shim',namespace:'test'}));
    b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:shim,loader:'js',resolveDir:root}));
    b.onResolve({filter:/^react(?:-dom)?(?:\/.*)?$/},args=>({path:requireMini.resolve(args.path)}));
    b.onResolve({filter:/^@\//},args=>({path:resolve(root,'src',args.path.slice(2)+'.ts')}));
    b.onLoad({filter:/\.scss$/},()=>({contents:'',loader:'js'}));
  }}],
});
const js = result.outputFiles[0].contents;
const css = requireMini('sass').compile(resolve(root,'miniapp/src/components/registration.scss')).css.replace(/([\d.]+)rpx/g,(_,n)=>`${Number(n)/2}px`);
const server=createServer((req,res)=>{
 if(req.url.startsWith('/api/')){const proxy=request({hostname:'127.0.0.1',port:3227,path:req.url,method:req.method,headers:{...req.headers,host:'127.0.0.1:3227'}},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res)});proxy.on('error',()=>{res.writeHead(502);res.end('{}')});req.pipe(proxy);return;}
 if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(js);return;}
 res.setHeader('Content-Type','text/html');res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}view{display:block}button{display:block;width:100%;border:0}button,input,select,textarea{font:inherit}*{box-sizing:border-box}${css}</style><div id="root"></div><script src="/app.js"></script>`);
});
server.listen(3228,'127.0.0.1',()=>console.log('Local component adapter ready on 3228; not a WeChat runtime.'));
if(process.argv.includes('--test')){
 const {chromium,expect}=await import('@playwright/test');
 const fixture=JSON.parse(readFileSync(resolve(out,'ui-fixture.json'),'utf8'));
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 const context=await browser.newContext({viewport:{width:390,height:844}});
 await context.addInitScript(({key,token})=>localStorage.setItem(key,token),{key:`destiny-mini:${origin}:${fixture.activity}`,token:fixture.token});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const start=`${origin}/?activity=${fixture.activity}`;
 try {
  await page.goto(start);await expect(page.getByText('认识你，从这里开始',{exact:true})).toBeVisible();
  const field=name=>page.locator('.reg-field').filter({has:page.locator('text').filter({hasText:new RegExp(`^${name}$`)})});
  await field('姓名').locator('input').fill('测试姓名');await field('活动昵称').locator('input').fill('清禾');
  await field('性别').locator('select').selectOption({label:'女'});
  await page.locator('.reg-date select').nth(0).selectOption({label:'1995'});await page.locator('.reg-date select').nth(1).selectOption({label:'02'});await page.locator('.reg-date select').nth(2).selectOption({label:'18'});
  await expect(page.getByText('水瓶座',{exact:true})).toBeVisible();
  await field('所在城市').locator('input').fill('银川');await field('手机号').locator('input').fill('139'+String(Date.now()).slice(-8));await page.getByRole('checkbox').check();
  await page.screenshot({path:resolve(out,'01-mini-registration-adapter.png'),fullPage:true});
  await page.getByRole('button',{name:'领取邀请函',exact:true}).click();await expect(page.locator('.reg-digits')).toBeVisible();
  await page.getByRole('button',{name:'查看与完善遇见档案'}).click();
  await field('职业/行业').locator('input').fill('测试设计师');
  await page.route('**/api/mini/registration/profile?*',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'测试：暂时无法保存'})}));
  await page.getByRole('button',{name:'保存并继续'}).click();await expect(page.getByText('测试：暂时无法保存',{exact:true})).toBeVisible();await expect(page.locator('.reg-station.active')).toContainText('生活档案');
  await page.unroute('**/api/mini/registration/profile?*');await page.getByRole('button',{name:'重试本次操作'}).click();await expect(page.locator('.reg-station.active')).toContainText('我的期待');
  await page.locator('textarea').first().fill('真诚相处');await page.getByRole('button',{name:'保存并继续'}).click();await page.getByRole('button',{name:'保存并查看档案'}).click();
  await expect(page.getByText('✓ 已保存',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'保存修改',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'返回上一站',exact:true})).toHaveCount(0);
  await page.screenshot({path:resolve(out,'02-mini-profile-preview-adapter.png'),fullPage:true});
  await page.locator('.reg-card').filter({hasText:'生活档案'}).getByRole('button',{name:'编辑',exact:true}).click();await field('职业/行业').locator('input').fill('修改后的职业');await page.getByRole('button',{name:'保存并返回档案'}).click();await expect(page.getByText('修改后的职业',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'返回报名凭证',exact:true}).click();await expect(page.locator('.reg-digits')).toBeVisible();
  const writes=[];page.on('request',r=>{if(r.method()==='POST')writes.push(r.url())});await page.reload();await page.getByRole('button',{name:'查看与完善遇见档案'}).click();await expect(page.getByText('✓ 已保存',{exact:true})).toBeVisible();
  if(writes.length)throw Error('Re-entering saved preview must not submit');
  await page.goto(`${start}&entry=encounter`);await expect(page.getByText('出示凭证，完成签到',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'进入现场互动',exact:true})).toHaveCount(0);
  const share=await page.evaluate(()=>window.sharePayload());if(share.path.includes(fixture.token)||share.path.includes('139'))throw Error('Private share payload');
  await page.screenshot({path:resolve(out,'03-mini-encounter-entry-adapter.png'),fullPage:true});
  if(errors.length)throw Error(errors.join(';'));
  writeFileSync(resolve(out,'ui-result.json'),JSON.stringify({passed:true,runtime:'React browser adapter; not WeChat',scenarios:['first signup','save failure retry','edit returns to preview','repeat read without submit','return receipt','independent encounter entry'],pageErrors:0},null,2));
  console.log('PASS: 6 UI scenarios with actual API; native WeChat verification still pending.');
 } finally {await browser.close();server.close();}
}
