import { chromium, expect } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

async function main() {
  const origin='http://127.0.0.1:3241';
  const dir=process.env.WALL_TEST_SECRETS;
  if(!dir)throw Error('Dedicated test fixture directory required');
  const fixture=JSON.parse(readFileSync(dir+'/fixture.json','utf8'));
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const out='docs/verification/member-wall/six';mkdirSync(out,{recursive:true});
  const errors:string[]=[],results:unknown[]=[];
  const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
  const numbers=()=>page.locator('header dl dd').allTextContents();
  try {
    for(const [width,height] of [[1366,768],[1920,1080],[2560,1440],[3840,2160]]) {
      await page.setViewportSize({width,height});
      for(const state of ['front','back','empty','low']) {
        await page.goto(`${origin}/display/member-wall/preview?state=${state}&count=50`);
        if(state!=='empty')await expect(page.locator('[data-member]').first()).toBeVisible();
        await expect(page.locator('header dl dt')).toHaveText(['总人数','男生人数','女生人数']);
        assert.deepEqual(await numbers(),state==='empty'?['0','0','0']:state==='low'?['8','4','4']:['50','25','25']);
        assert.equal(await page.getByText('演示数据 · 非真实参与者',{exact:true}).count(),0);
        assert.equal(await page.getByText('仅展示用户主动公开的昵称、虚拟头像与互动偏好',{exact:true}).count(),0);
        assert.equal(await page.getByText('待配置',{exact:false}).count(),0);
        const bounds=await page.evaluate(()=>{
          const faces=[...document.querySelectorAll('[data-member] section[aria-hidden="false"]')];
          return {overflow:document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight,
            rows:new Set(faces.map(e=>Math.round(e.getBoundingClientRect().top))).size,
            clipped:faces.flatMap(face=>[...face.querySelectorAll('h2,dl,[class*=genderBadge],[class*=backMeta]' )].filter(el=>{
              const a=el.getBoundingClientRect(),b=face.getBoundingClientRect();return a.bottom>b.bottom+1||a.right>b.right+1||a.left<b.left-1;
            }).map(e=>e.tagName))};
        });
        const seats=await page.locator('[data-swap] > article').evaluateAll(els=>els.map((e,i)=>({index:i,gender:e.getAttribute('data-gender'),id:e.getAttribute('data-member'),left:e.getBoundingClientRect().left,top:e.getBoundingClientRect().top,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})));
        assert.equal(seats.length,24);seats.forEach((seat,i)=>{if(seat.id)assert.equal(seat.gender,i%6<3?'male':'female')});
        assert.equal(new Set(seats.map(s=>Math.round(s.top))).size,4);
        if(width===1920&&state==='front'){
          assert.ok(seats[0].width>285&&seats[0].height>=190);
          const sizes=await page.locator('[data-member] section[aria-hidden=false]').first().evaluate(e=>({nickname:parseFloat(getComputedStyle(e.querySelector('h2')!).fontSize),tag:parseFloat(getComputedStyle(e.querySelector('[class*=tags] span')!).fontSize)}));
          assert.ok(sizes.nickname>=30);assert.ok(sizes.tag>=17);results.push({cardSize:seats[0],fontSizes:sizes});
        }
        assert.equal(bounds.overflow,false);assert.deepEqual(bounds.clipped,[]);
        if(state==='front'||state==='back') {
          assert.equal(bounds.rows,4);
          const male=page.locator('[data-member][data-gender=male] section[aria-hidden=false]').first();
          const female=page.locator('[data-member][data-gender=female] section[aria-hidden=false]').first();
          await expect(male.getByText('♂ 男生',{exact:true})).toBeVisible();
          await expect(female.getByText('♀ 女生',{exact:true})).toBeVisible();
          assert.notEqual(await male.evaluate(e=>getComputedStyle(e).backgroundImage),await female.evaluate(e=>getComputedStyle(e).backgroundImage));
        }
        await page.screenshot({path:`${out}/${state}-${width}.png`});results.push({width,height,state,...bounds});
      }
      await page.goto(origin+'/display/member-wall/preview?state=back');
      await expect(page.locator('[data-member]')).toHaveCount(24);
      await page.locator('[data-member] h2').evaluateAll(els=>els.forEach(e=>{e.textContent='春风拂过山间明月'}));
      const clipped=await page.locator('[data-member] section[aria-hidden=false]').evaluateAll(faces=>faces.some(face=>face.scrollHeight>face.clientHeight+2||face.querySelector('dl')!.getBoundingClientRect().bottom>face.getBoundingClientRect().bottom||face.querySelector('h2')!.getBoundingClientRect().right>face.getBoundingClientRect().right));
      await page.screenshot({path:`${out}/long-back-${width}.png`});assert.equal(clipped,false);results.push({width,height,state:'long-back',clipped});
    }
    await page.setViewportSize({width:1920,height:1080});
    await page.goto(origin+'/display/member-wall/preview?state=motion&count=50');
    await expect(page.locator('[data-member]')).toHaveCount(24);
    const initial=await page.locator('[data-member]').evaluateAll(es=>es.map(e=>e.getAttribute('data-member')));
    await expect.poll(async()=>page.locator('[data-testid=member-wall]').getAttribute('data-side'),{timeout:13000}).toBe('back');
    await expect.poll(async()=>page.locator('[data-member]').evaluateAll(es=>es.map(e=>e.getAttribute('data-member')).join()),{timeout:38000}).not.toBe(initial.join());
    assert.deepEqual(await numbers(),['50','25','25']);results.push({motionRotation:true,countsStable:true});
    await page.emulateMedia({reducedMotion:'reduce'});await page.goto(origin+'/display/member-wall/preview?state=back');
    await expect(page.locator('[data-member]').first()).toHaveAttribute('data-reduced','true');
    assert.equal(await page.locator('[data-member]').first().locator(':scope > div').evaluate(e=>getComputedStyle(e).transform),'none');
    const op=JSON.parse(readFileSync(dir+'/operator.json','utf8'));
    assert.equal((await page.request.post(origin+'/api/live/login?activity='+fixture.activity,{headers:{Origin:origin},data:op})).status(),200);
    await page.goto(origin+'/display/member-wall?activity='+fixture.activity);
    await expect(page.locator('header dl dd')).toHaveText(['50','17','33']);
    await page.getByRole('button',{name:'启动主屏',exact:true}).click();
    await expect(page.locator('[data-member]')).toHaveCount(24);
    await expect(page.locator('header dl dd')).toHaveText(['50','17','33']);
    const realSlots=await page.locator('[data-swap] > article').evaluateAll(es=>es.map(e=>e.getAttribute('data-gender')));assert.deepEqual(realSlots,Array.from({length:24},(_,i)=>i%6<3?'male':'female'));
    assert.ok(await page.locator('[data-member][data-gender=male]').count()>0);
    await page.screenshot({path:out+'/real.png'});
    const phone=await browser.newContext({viewport:{width:390,height:844}});
    const [name,...value]=fixture.participantCookie.split('=');await phone.addCookies([{name,value:value.join('='),url:origin}]);
    const mobile=await phone.newPage();await mobile.goto(origin+'/mobile/member-wall-consent?activity='+fixture.activity);
    await expect(mobile.getByText('♀ 女生',{exact:true}).first()).toBeVisible();
    await expect(mobile.getByRole('checkbox')).not.toBeChecked();
    await expect(mobile.getByText('仅公开：昵称、性别标识、系统虚拟头像',{exact:false})).toBeVisible();
    await mobile.getByLabel('公开昵称').fill('春风拂过山间明月');await mobile.getByRole('button',{name:'看背面',exact:true}).click();
    assert.equal(await mobile.locator('[data-member] section[aria-hidden=false]').evaluate(e=>e.scrollHeight>e.clientHeight+2),false);
    await mobile.screenshot({path:out+'/phone-consent.png',fullPage:true});
    await mobile.getByRole('checkbox').check();await mobile.getByRole('button',{name:'自愿开启卡牌展示',exact:true}).click();
    await expect(mobile.getByText('已开启展示。',{exact:true})).toBeVisible();
    results.push({realCounts:[50,17,33],realCards:24,phoneGenderPreview:true,defaultUnchecked:true,consentSaved:true,reducedMotion:true});
    assert.deepEqual(errors,[]);writeFileSync(out+'/browser.json',JSON.stringify({at:new Date().toISOString(),results,errors},null,2));
    console.log(JSON.stringify({checks:results.length,errors}));
  } finally {await browser.close();}
}
void main().catch(e=>{console.error(e);process.exitCode=1});
