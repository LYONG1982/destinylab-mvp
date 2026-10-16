import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
async function main(){
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage(),results:unknown[]=[],errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  const origin=process.env.WALL_VISUAL_ORIGIN||'http://127.0.0.1:3217';
  const out=process.env.WALL_VISUAL_OUT||'docs/verification/member-wall/window';mkdirSync(out,{recursive:true});
  try{
    for(const [width,height]of [[900,600],[1024,640],[1024,768],[1280,640],[1280,720],[1366,668],[1440,760],[1920,1080],[2560,1440],[3840,2160]]){
      await page.setViewportSize({width,height});
      for(const side of ['front','back']){
        await page.goto(origin+'/display/member-wall/preview?state='+side+'&count=50');
        await expect(page.locator('[data-member]')).toHaveCount(24);
        assert.equal(await page.getByText('为保持头像与昵称清晰，此窗口暂不展示卡牌。',{exact:true}).count(),0);
        await page.locator('[data-member] h2').evaluateAll(es=>es.forEach(e=>{e.textContent='春风拂过山间明月'}));
        const measured=await page.evaluate(()=>{
          const faces=[...document.querySelectorAll('[data-member] section[aria-hidden=false]')];
          return {overflow:document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight,
            clipped:faces.flatMap(face=>[...face.querySelectorAll('h2,dl,dt,dd,[class*=age],[class*=tags], [class*=genderBadge], [class*=backMeta]')].filter(el=>{const a=el.getBoundingClientRect(),b=face.getBoundingClientRect();return a.right>b.right+1||a.bottom>b.bottom+1||a.left<b.left-1||el.scrollWidth>el.clientWidth+1}).map(e=>e.tagName)),
            nicknameSize:parseFloat(getComputedStyle(faces[0].querySelector('h2')!).fontSize)};
        });
        await page.screenshot({path:`${out}/${side}-${width}-${height}.png`});
        assert.equal(measured.overflow,false);assert.deepEqual(measured.clipped,[],`${width}x${height} ${side}`);
        if(width===1920&&side==='front')assert.equal(measured.nicknameSize,32);
        if(side==='back'){await expect(page.locator('[data-member]').first().locator('dt')).toHaveText(['周末偏好','见面看重','沟通方式','关系期待']);}
        results.push({width,height,side,...measured});
      }
    }
    await page.setViewportSize({width:390,height:844});await page.goto(origin+'/display/member-wall/preview?state=front');
    await expect(page.locator('[data-member]')).toHaveCount(0);await expect(page.getByText('为保持头像与昵称清晰，此窗口暂不展示卡牌。',{exact:true})).toBeVisible();
    assert.deepEqual(errors,[]);writeFileSync(out+'/browser.json',JSON.stringify({at:new Date().toISOString(),results,narrowPhoneGuard:true,errors},null,2));console.log(JSON.stringify({checks:results.length,narrowPhoneGuard:true,errors}));
  }finally{await browser.close()}
}
void main().catch(e=>{console.error(e);process.exitCode=1});
