import {chromium,expect,type Page} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {randomBytes,createHash,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
async function checkLayout(page:Page){
  const clipped=await page.locator('section[aria-hidden=false]').evaluateAll(faces=>faces.flatMap(face=>[...face.querySelectorAll('h2,dt,dd')].filter(el=>{const a=el.getBoundingClientRect(),b=face.getBoundingClientRect();return a.bottom>b.bottom+1||a.right>b.right+1||el.scrollWidth>el.clientWidth+1}).map(el=>el.tagName)));
  assert.deepEqual(clipped,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
}
async function main(){
  const work=readFileSync('/tmp/destinylab-wall-work','utf8').trim();process.loadEnvFile(work+'/secrets/test.env');
  assert.equal(new URL(process.env.DATABASE_URL!).pathname,'/destiny_wall_test');
  const f=JSON.parse(readFileSync(work+'/secrets/fixture.json','utf8')),origin='http://127.0.0.1:3241';
  const db=new Pool({connectionString:process.env.DATABASE_URL}),browser=await chromium.launch({channel:'chrome',headless:true});
  const out=process.env.WALL_VISUAL_OUT||'docs/verification/member-wall/four';mkdirSync(out,{recursive:true});const checks:string[]=[],errors:string[]=[];
  try{
    const phone=await browser.newContext(),[name,value]=f.participantCookie.split('=');await phone.addCookies([{name,value,url:origin}]);
    const p=await phone.newPage();p.on('pageerror',e=>errors.push(e.message));
    for(const width of [320,390,430]){
      await p.setViewportSize({width,height:844});await p.goto(origin+'/mobile/member-wall-consent?activity='+f.activity);
      await p.getByLabel('公开昵称').fill('春风拂过山间明月');await expect(p.locator('section[aria-hidden=false]')).toContainText('26–29岁');assert.equal((await p.locator('[data-member]').innerText()).includes('MW-'),false);await p.getByRole('button',{name:'看背面',exact:true}).click();
      await expect(p.locator('dt')).toHaveText(['周末偏好','见面看重','沟通方式','关系期待']);await checkLayout(p);
      await p.screenshot({path:`${out}/phone-${width}.png`,fullPage:true});
    }
    checks.push('320/390/430 phone four-answer preview with eight-character nickname');
    const saved=(await db.query('SELECT state FROM dl_activities WHERE id=$1',[f.activity])).rows[0].state;
    for(const [label,answers,rows] of [['partial',{q6:'真诚表达'},1],['empty',{},0]] as const){
      const edited=structuredClone(saved);edited.participants.find((x:{id:string})=>x.id===f.actor).answers=answers;
      await db.query('UPDATE dl_activities SET state=$2 WHERE id=$1',[f.activity,JSON.stringify(edited)]);
      await p.reload();await p.getByRole('button',{name:'看背面',exact:true}).click();await expect(p.locator('dt')).toHaveCount(rows);await checkLayout(p);
      if(!rows)await expect(p.getByText('故事，留待相遇时慢慢说')).toBeVisible();
      await p.screenshot({path:`${out}/phone-${label}.png`,fullPage:true});
    }
    await db.query('UPDATE dl_activities SET state=$2 WHERE id=$1',[f.activity,JSON.stringify(saved)]);
    checks.push('partial and empty answers render without substitutions');
    await p.reload();await p.getByLabel('公开昵称').fill('春风拂过山间明月');await p.getByRole('checkbox').check();await p.getByRole('button',{name:'自愿开启卡牌展示'}).click();
    await expect(p.getByText('已开启；符合展示条件后，在下一换人周期加入。')).toBeVisible();
    checks.push('real HTTP current consent saved from phone UI');
    const operator=await browser.newContext({viewport:{width:1920,height:1080}});
    const login=await operator.request.post(origin+'/api/live/login?activity='+f.activity,{headers:{Origin:origin},data:JSON.parse(readFileSync(work+'/secrets/operator.json','utf8'))});assert.equal(login.status(),200);
    const wall=await operator.newPage();wall.on('pageerror',e=>errors.push(e.message));await wall.goto(origin+'/display/member-wall?activity='+f.activity);
    await wall.getByRole('button',{name:'启动主屏'}).click();await expect(wall.locator('[data-member]')).toHaveCount(24);
    const snapshot=await(await operator.request.get(origin+'/api/member-wall/snapshot?activity='+f.activity)).json();const card=snapshot.cards[0];
    assert.deepEqual(card.preferences.map((x:{label:string})=>x.label),['周末偏好','见面看重','沟通方式','关系期待']);
    const actor=(await db.query('SELECT participant_id FROM dl_member_wall_consents WHERE public_id=$1',[card.id])).rows[0].participant_id;
    const token=randomBytes(32).toString('base64url');await db.query("INSERT INTO dl_sessions(token_hash,activity_id,role,actor,expires_at) VALUES($1,$2,'participant',$3,now()+interval '1 hour')",[createHash('sha256').update(token).digest('hex'),f.activity,actor]);
    const next=card.preferences[3].value==='认真了解彼此'?'顺其自然':'认真了解彼此';
    const result=await phone.request.post(origin+'/api/live/command?audience=participant&activity='+f.activity,{headers:{Origin:origin,Cookie:`dl-participant-${f.activity}=${token}`,'Idempotency-Key':randomUUID()},data:{epoch:snapshot.epoch,command:{type:'answer',questionId:'q9',value:next}}});assert.equal(result.status(),200);
    await expect(wall.locator(`[data-member="${card.id}"] dd`).nth(3)).toHaveText(next,{timeout:25000});
    await expect(wall.locator('[data-testid=member-wall]')).toHaveAttribute('data-side','back',{timeout:15000});await checkLayout(wall);
    await wall.screenshot({path:out+'/live-back.png'});checks.push('phone answer update reaches real wall through server and event refresh');
    const ageChange=await phone.request.post(origin+'/api/live/command?audience=participant&activity='+f.activity,{headers:{Origin:origin,Cookie:`dl-participant-${f.activity}=${token}`,'Idempotency-Key':randomUUID()},data:{epoch:snapshot.epoch,command:{type:'profile',name:'清禾',gender:card.gender,avatarId:card.gender+'_01',age:'34–37',ready:true}}});assert.equal(ageChange.status(),200);
    await expect(wall.locator(`[data-member="${card.id}"] [class*=age]`)).toHaveText('34–37岁',{timeout:25000});
    await expect(wall.locator('[data-testid=member-wall]')).toHaveAttribute('data-side','front',{timeout:15000});await checkLayout(wall);
    assert.equal((await wall.locator('[data-member]').allTextContents()).some(t=>t.includes('MW-')),false);
    await wall.screenshot({path:out+'/live-age.png'});checks.push('profile age update reaches real wall; no MW code on either face');

    assert.deepEqual(errors,[]);writeFileSync(out+'/integration.json',JSON.stringify({at:new Date().toISOString(),checks,errors},null,2));console.log(JSON.stringify({checks,errors}));
  }finally{await browser.close();await db.end()}
}
void main().catch(e=>{console.error(e);process.exitCode=1});
