import { chromium, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
async function main() {
const work = readFileSync('/tmp/destinylab-wall-work','utf8').trim();
const fixture = JSON.parse(readFileSync(work+'/secrets/fixture.json','utf8'));
const origin='http://127.0.0.1:3241';
const output='docs/verification/member-wall/soak.json';
const browser=await chromium.launch({channel:'chrome',headless:true});
const errors:string[]=[];
const samples:unknown[]=[];
const pages:Page[]=[];
for(const mode of ['real','demo']) {
  const context=await browser.newContext({viewport:{width:1920,height:1080}});
  if(mode==='real') {
    const login=await context.request.post(origin+'/api/live/login?activity='+fixture.activity,{headers:{Origin:origin},data:JSON.parse(readFileSync(work+'/secrets/operator.json','utf8'))});
    assert.equal(login.status(),200);
  }
  const page=await context.newPage(); pages.push(page);
  page.on('pageerror',e=>errors.push(mode+':'+e.message));
  await page.addInitScript(`(() => {
    const stats={frames:0,slowFrames:0,maxFrame:0,longTasks:0,longTaskMs:0};
    let last=performance.now();
    function frame(now){const dt=now-last;last=now;stats.frames++;if(dt>34)stats.slowFrames++;stats.maxFrame=Math.max(stats.maxFrame,dt);requestAnimationFrame(frame)}
    requestAnimationFrame(frame);
    new PerformanceObserver(list=>{for(const item of list.getEntries()){stats.longTasks++;stats.longTaskMs+=item.duration}}).observe({type:'longtask',buffered:true});
    Object.assign(window,{wallSoak:stats});
  })();`);
  await page.goto(origin+(mode==='real'?'/display/member-wall?activity='+fixture.activity:'/display/member-wall/preview?state=motion&count=200'));
  if(mode==='real') await page.getByRole('button',{name:'启动主屏'}).click();
  await page.locator('[data-member]').first().waitFor();
  assert.ok(await page.evaluate(()=>!!(window as unknown as {wallSoak:object}).wallSoak));
  assert.equal(errors.length,0);
}
const start=Date.now(), startedAt=new Date(start).toISOString();
const seen=[new Set<string>(),new Set<string>()], changes=[0,0], lastIds=['',''];
try {
  while(Date.now()-start<30*60*1000) {
    for(let i=0;i<pages.length;i++) {
      const page=pages[i];
      const sample=await page.evaluate(()=>{
        const root=document.querySelector('[data-testid="member-wall"]')!;
        const ids=[...document.querySelectorAll('[data-member]')].map(e=>e.getAttribute('data-member')!);
        return {ids,side:root.getAttribute('data-side'),status:root.getAttribute('data-status'),columns:root.getAttribute('data-columns'),cards:ids.length,
          duplicate:ids.length!==new Set(ids).size,overflow:document.documentElement.scrollWidth>innerWidth,
          performance:(window as unknown as {wallSoak:object}).wallSoak,
          heap:(performance as unknown as {memory?:{usedJSHeapSize:number}}).memory?.usedJSHeapSize};
      });
      assert.equal(sample.duplicate,false);assert.equal(sample.overflow,false);assert.equal(sample.cards,24);
      assert.ok(sample.performance);
      assert.equal(sample.status,'ready');
      sample.ids.forEach(id=>seen[i].add(id));const key=sample.ids.join(',');
      if(lastIds[i]&&lastIds[i]!==key)changes[i]++;lastIds[i]=key;
      samples.push({elapsedMs:Date.now()-start,mode:i?'demo-200':'real-48',...sample});
    }
    writeFileSync(output,JSON.stringify({startedAt,elapsedMs:Date.now()-start,complete:false,coverage:seen.map(s=>s.size),changes,errors,samples},null,2));
    await new Promise(r=>setTimeout(r,5000));
  }
  assert.equal(errors.length,0); assert.equal(seen[0].size,48);assert.equal(seen[1].size,200);
  for(let i=0;i<pages.length;i++) await pages[i].screenshot({path:`docs/verification/member-wall/soak-${i?'demo':'real'}-final.png`});
  const result={startedAt,endedAt:new Date().toISOString(),elapsedMs:Date.now()-start,complete:true,coverage:seen.map(s=>s.size),changes,errors,samples};
  writeFileSync(output,JSON.stringify(result,null,2));
  console.log(JSON.stringify({complete:true,elapsedMs:result.elapsedMs,coverage:result.coverage,changes,errors}));
} finally {await browser.close();}
}
void main().catch(e=>{console.error(e);process.exitCode=1});
