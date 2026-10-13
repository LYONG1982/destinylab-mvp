import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
async function main(){
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const context=await browser.newContext({viewport:{width:1920,height:1080},recordVideo:{dir:'docs/verification/member-wall/motion',size:{width:1920,height:1080}}});
  const page=await context.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript('globalThis.__name = (value) => value;');
  try{
    await page.goto('http://127.0.0.1:3241/display/member-wall/preview?state=motion&count=50');
    await page.locator('[data-member]').first().waitFor();
    await page.evaluate(()=>{
      const root=document.querySelector('[data-testid="member-wall"]')!,start=performance.now();
      const events:{at:number;side:string|null;flipping:string|null;swap:string|null;ids:string[]}[]=[];
      const capture=()=>{const state={at:performance.now()-start,side:root.getAttribute('data-side'),flipping:root.getAttribute('data-flipping'),swap:root.querySelector('[data-swap]')?.getAttribute('data-swap')||null,ids:[...root.querySelectorAll('[data-member]')].map(e=>e.getAttribute('data-member')!)};
        const old=events.at(-1);if(!old||old.side!==state.side||old.flipping!==state.flipping||old.swap!==state.swap||old.ids.join()!==state.ids.join())events.push(state)};
      capture();const observer=new MutationObserver(capture);observer.observe(root,{subtree:true,attributes:true,attributeFilter:['data-side','data-flipping','data-swap','data-member']});
      Object.assign(window,{wallMotion:{events,stop:()=>observer.disconnect()}});
    });
    await page.waitForTimeout(43500);
    const events=await page.evaluate(()=>{const m=(window as unknown as {wallMotion:{events:{at:number;side:string|null;flipping:string|null;swap:string|null;ids:string[]}[];stop:()=>void}}).wallMotion;m.stop();return m.events});
    const phases=events.filter((e,i)=>i===0||e.side!==events[i-1].side);
    assert.deepEqual(phases.map(e=>e.side),['front','back','front','back','front']);
    for(let i=1;i<phases.length;i++)assert.ok(Math.abs(phases[i].at-i*10000)<500);
    const changed=events.find(e=>e.ids.join()!==events[0].ids.join());assert.ok(changed);assert.ok(changed.at>=41000);assert.equal(changed.side,'front');assert.equal(changed.flipping,'false');
    assert.equal(changed.ids.filter(id=>!events[0].ids.includes(id)).length,6);
    assert.ok(events.filter(e=>e.swap==='out').every(e=>e.flipping==='false'&&e.side==='front'));
    await page.emulateMedia({reducedMotion:'reduce'});
    const transforms=await page.locator('[data-member]').evaluateAll(cards=>cards.map(c=>getComputedStyle(c.firstElementChild!).transform));
    assert.ok(transforms.every(x=>x==='none'));assert.deepEqual(errors,[]);
    writeFileSync('docs/verification/member-wall/motion.json',JSON.stringify({events,phases,changedAt:changed.at,replaced:6,reducedMotion:true,errors},null,2));
    await context.close();console.log(JSON.stringify({phases:phases.map(({at,side})=>({at,side})),changedAt:changed.at,replaced:6,reducedMotion:true,video:await page.video()!.path()}));
  }finally{await browser.close()}
}
void main().catch(e=>{console.error(e);process.exitCode=1});
