import { chromium, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
async function main(){
  const dir=process.env.WALL_UAT_CONFIG_DIR;
  if(!dir)throw Error('Protected UAT configuration directory required');
  const loginDir=process.env.WALL_UAT_LOGIN_DIR || dir;
  const credentials=(role:string)=>{const d=JSON.parse(readFileSync(loginDir+'/'+role+'.json','utf8'));if(typeof d.username!=='string'||typeof d.password!=='string')throw Error('Protected login file must contain credentials, not metadata');return {username:d.username,password:d.password}};
  process.loadEnvFile(dir+'/member-wall-uat.env');
  const origin=process.env.DESTINY_PUBLIC_URL!;
  assert.equal(new URL(origin).port,'3216');
  assert.match(new URL(origin).hostname,/^192\.168\.\d+\.\d+$/);
  assert.equal(new URL(process.env.DATABASE_URL!).pathname,'/destiny_lan_uat_20261011');
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const errors:string[]=[];
  try{
    const publicContext=await browser.newContext({viewport:{width:1920,height:1080}});
    const req=publicContext.request;
    for(const path of ['/api/health/live','/api/health/ready','/mobile/01-start?activity=meet'])assert.equal((await req.get(origin+path)).status(),200);
    const snapshot=await (await req.get(origin+'/api/member-wall/snapshot?activity=meet')).json();
    assert.equal(snapshot.cards.length,0);assert.equal(snapshot.eligible,0);assert.equal(snapshot.config.mode,'real');
    assert.equal((await req.get(origin+'/api/member-wall/admin?activity=meet')).status(),401);
    const page=await publicContext.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin+'/display/member-wall?activity=meet');
    await expect(page.getByText('让下一次遇见，从这里开始',{exact:true})).toBeVisible();
    const qr=page.getByAltText('扫码参与活动');await expect(qr).toBeVisible();
    const png=PNG.sync.read(Buffer.from((await qr.getAttribute('src'))!.split(',')[1],'base64'));
    assert.equal(jsQR(new Uint8ClampedArray(png.data),png.width,png.height)?.data,origin+'/mobile/01-start?activity=meet');
    await page.screenshot({path:'docs/verification/member-wall/uat-real-empty.png'});
    await page.goto(origin+'/display/member-wall/preview?state=front');
    await expect(page.locator('[data-member]')).toHaveCount(24);
    await page.getByRole('button',{name:'全屏',exact:true}).click();
    assert.equal(await page.evaluate(()=>!!document.fullscreenElement),true);
    await page.screenshot({path:'docs/verification/member-wall/uat-preview.png'});
    const operator=await browser.newContext();const agency=await browser.newContext();
    assert.equal((await operator.request.post(origin+'/api/live/login?activity=meet',{headers:{Origin:origin},data:credentials('operator')})).status(),200);
    assert.equal((await operator.request.get(origin+'/api/member-wall/admin?activity=meet')).status(),200);
    assert.equal((await agency.request.post(origin+'/api/tongzhou/login?activity=meet',{headers:{Origin:origin},data:credentials('agency')})).status(),200);
    assert.equal((await agency.request.get(origin+'/api/tongzhou/records?activity=meet')).status(),200);
    assert.deepEqual(errors,[]);
    await QRCode.toFile('docs/verification/member-wall/uat-join-qr.png',origin+'/mobile/01-start?activity=meet',{width:512,margin:4,errorCorrectionLevel:'M'});
    const result={at:new Date().toISOString(),origin,buildId:readFileSync((process.env.DESTINY_DIST_DIR || '.next-memberwall-six')+'/BUILD_ID','utf8').trim(),healthy:true,operatorLogin:true,agencyLogin:true,anonymousAdminDenied:true,realCandidates:snapshot.eligible,realCards:snapshot.cards.length,previewCards:24,fullscreen:true,decodedQr:origin+'/mobile/01-start?activity=meet',errors,realPhoneTested:false,realWechatTested:false};
    writeFileSync('docs/verification/member-wall/uat.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  }finally{await browser.close()}
}
void main().catch(e=>{console.error(e);process.exitCode=1});
