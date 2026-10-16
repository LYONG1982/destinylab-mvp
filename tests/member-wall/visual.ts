import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
async function main() {
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const results:unknown[]=[],errors:string[]=[];
  const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
  const origin=process.env.WALL_VISUAL_ORIGIN || 'http://127.0.0.1:3241';
  try {
    for(const [width,height] of [[1366,768],[1920,1080],[2560,1440],[3840,2160]]) {
      await page.setViewportSize({width,height});
      for(const state of ['front','back','low','empty','offline']) {
        await page.goto(`${origin}/display/member-wall/preview?state=${state}`);
        await page.waitForTimeout(1700);
        const result=await page.evaluate(()=>{
          const root=document.querySelector('[data-testid="member-wall"]')!;
          const faces=[...document.querySelectorAll('[data-member] section[aria-hidden="false"]')];
          return {columns:Number(root.getAttribute('data-columns')),cards:faces.length,
            overflow:document.documentElement.scrollWidth>innerWidth || document.documentElement.scrollHeight>innerHeight,
            clipped:faces.flatMap(face=>[...face.querySelectorAll('h2,dl,.code')].filter(e=>e.getBoundingClientRect().bottom>face.getBoundingClientRect().bottom+1).map(e=>e.tagName)),
            rows:new Set(faces.map(e=>Math.round(e.getBoundingClientRect().top))).size};
        });
        assert.equal(result.overflow,false);assert.deepEqual(result.clipped,[]);
        if(state==='front'||state==='back')assert.equal(result.rows,4);
        await page.screenshot({path:`docs/verification/member-wall/${state}-${width}.png`});
        results.push({width,height,state,...result});
      }
      // Deliberately replace only fixture labels to check the permitted longest glyph width.
      await page.goto(origin+'/display/member-wall/preview?state=back');
      await page.waitForTimeout(1700);
      await page.locator('[data-member]').evaluateAll(els=>els.forEach((e,i)=>e.querySelectorAll('h2').forEach(h=>h.textContent=i%2?'清禾Alex':'春风拂过山间明月')));
      const long=await page.locator('[data-member] section[aria-hidden="false"]').evaluateAll(faces=>faces.map(face=>({
        overflow:face.scrollHeight>face.clientHeight+2,
        nickOverflow:(face.querySelector('h2')?.getBoundingClientRect().right||0)>face.getBoundingClientRect().right-2,
        lastBottom:face.querySelector('dl')!.getBoundingClientRect().bottom-face.getBoundingClientRect().bottom,
      })));
      results.push({width,height,state:'long-nickname',long});
      await page.screenshot({path:`docs/verification/member-wall/long-back-${width}.png`});
      assert.ok(long.every(x=>!x.overflow&&!x.nickOverflow&&x.lastBottom<=0));
    }
    assert.deepEqual(errors,[]);
    writeFileSync('docs/verification/member-wall/visual.json',JSON.stringify({results,errors},null,2));
    console.log(JSON.stringify({screenshots:24,errors,longProblems:results.filter(x=>JSON.stringify(x).includes('"overflow":true'))}));
  } finally {await browser.close();}
}
void main().catch(e=>{console.error(e);process.exitCode=1});
