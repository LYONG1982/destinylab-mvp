import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as pathJoin } from "node:path";
import { database } from "../../src/server/db";
import { emptyActivity, newParticipant, worldProjection, mobileProjection } from "../../src/server/state";
import { join, execute, readState } from "../../src/server/service";
import { fieldAction, fieldPreview } from "../../src/server/field-service";
import { migrateMeetPoints } from "../../src/server/meet-points-migration";
import { pointOccupants } from "../../src/domain/encounters";
import { QUESTIONS } from "../../src/data/questions";
import type { DemoState } from "../../src/domain/types";

const db = new URL(process.env.DATABASE_URL || "http://invalid");
if (!['127.0.0.1','localhost'].includes(db.hostname) || !db.pathname.endsWith('_test')) throw Error('Isolated test database required');
after(() => database().end());
const op={role:"operator" as const,actor:"operator"};
async function fixture(pairs=0, points=true) {
  const activity=`service520-${randomUUID().slice(0,8)}`, state=emptyActivity();
  state.points = state.points.map(point => ({ ...point, capacity: 1 }));
  if(!points)state.points=[];
  state.participants=Array.from({length:pairs*2},(_,n)=>({...newParticipant(),name:n%2?"清禾":"山风",gender:n%2?"female" as const:"male" as const,avatarId:n%2?"female_01":"male_01",age:"26–29",ready:true,profileComplete:true,answers:Object.fromEntries(QUESTIONS.map(q=>[q.id,q.options[0]]))}));
  await database().query('INSERT INTO dl_activities(id,state) VALUES($1,$2)',[activity,state]);return {activity,state};
}
const cmd=(activity:string,state:DemoState,actor:string,command:unknown,id=randomUUID())=>execute(activity,{role:"participant",actor},command,id,state.epoch);
test("lost entry response and eight concurrent retries share one identity without a plaintext token ledger",async()=>{
  const f=await fixture(),key=randomUUID();const req=()=>new Request('http://localhost',{headers:{'X-Destiny-Entry-Key':key}});
  const results=await Promise.all(Array.from({length:8},()=>join(req(),f.activity)));
  assert.equal(new Set(results.map(r=>r.session.actor)).size,1);assert.equal(new Set(results.map(r=>r.token)).size,1);
  const s=await readState(f.activity);assert.equal(s.participants.length,1);assert.equal(s.scans.length,1);
  const ledger=(await database().query('SELECT payload FROM dl_commands WHERE activity_id=$1',[f.activity])).rows;
  assert.ok(!JSON.stringify(ledger).includes(results[0].token));assert.ok(!JSON.stringify(ledger).includes(key));
  const input={action:'remove',ids:[results[0].session.actor],epoch:s.epoch};const preview=await fieldPreview(f.activity,input);
  await fieldAction(f.activity,{...input,preview:preview.token},randomUUID());
  await assert.rejects(join(req(),f.activity),(e:unknown)=>!!e&&typeof e==='object'&&'status' in e&&e.status===410);
  assert.equal((await readState(f.activity)).participants.length,0);
});
test("entry request keys cannot silently create a new identity across an activity reset",async()=>{
  const f=await fixture(),key=randomUUID(),req=()=>new Request('http://localhost',{headers:{'X-Destiny-Entry-Key':key}});
  await join(req(),f.activity);
  const fresh=emptyActivity();await database().query('UPDATE dl_activities SET state=$2,revision=0 WHERE id=$1',[f.activity,fresh]);
  await assert.rejects(join(req(),f.activity),/轮次已变化/);assert.equal((await readState(f.activity)).participants.length,0);
});
test("50 concurrent acceptances allocate 30 unique places and 50 globally distinct complementary code pairs",async()=>{
  const f=await fixture(50);
  await Promise.all(Array.from({length:50},(_,n)=>cmd(f.activity,f.state,f.state.participants[n*2].id,{type:'invite',targetId:f.state.participants[n*2+1].id})));
  let s=await readState(f.activity);assert.ok(s.invitations.every(i=>!i.encounterCodes && !i.code));
  await Promise.all(s.invitations.map(i=>cmd(f.activity,s,i.to,{type:'accept',invitationId:i.id})));
  s=await readState(f.activity);assert.equal(s.invitations.filter(i=>i.pointId).length,30);assert.equal(s.invitations.filter(i=>i.status==='ACCEPTED').length,20);
  const codes=s.invitations.flatMap(i=>Object.values(i.encounterCodes!));assert.equal(new Set(codes).size,100);
  for(const i of s.invitations)assert.equal(Object.values(i.encounterCodes!).reduce((a,b)=>a+Number(b),0),520);
  const first=s.points[0];await execute(f.activity,op,{type:'point-config',pointId:first.id,location:'东侧花墙',capacity:3},randomUUID(),s.epoch);
  s=await readState(f.activity);assert.equal(pointOccupants(s.points[0]).length,3);assert.equal(s.invitations.filter(i=>i.pointId).length,32);
  const revision=s.revision;assert.equal((await readState(f.activity)).revision,revision);
  const inv=s.invitations.find(i=>i.pointId===first.id)!;
  const view=mobileProjection(s,inv.from,f.activity);assert.deepEqual(Object.keys(view.invitations[0].encounterCodes!),[inv.from]);
  assert.equal(view.points.find(p=>p.id===first.id)!.occupants!.length,1);
  const world=worldProjection(s,f.activity);assert.ok(world.meetScene!.qualifiedPairs.length>0);
  assert.ok(!JSON.stringify(world).includes('encounterCodes'));assert.ok(!JSON.stringify(world).includes(inv.from));
  const beforeTotal=world.totalMeetings;
  await assert.rejects(cmd(f.activity,s,inv.from,{type:'display-consent',invitationId:inv.id,allow:false}),/默认展示/);
  assert.equal(worldProjection(await readState(f.activity),f.activity).totalMeetings,beforeTotal);
});
test("backfilling old zero-point activity immediately assigns waiting invitations; read recovery only writes once",async()=>{
  const f=await fixture(1,false);await cmd(f.activity,f.state,f.state.participants[0].id,{type:'invite',targetId:f.state.participants[1].id});
  let s=await readState(f.activity);await cmd(f.activity,s,s.invitations[0].to,{type:'accept',invitationId:s.invitations[0].id});
  s=await readState(f.activity);assert.equal(s.invitations[0].pointId,null);
  const dir=await mkdtemp(pathJoin(tmpdir(),'destiny520-backup-'));
  try {const result=await migrateMeetPoints(f.activity,dir);assert.equal(result.added,30);assert.ok((await readState(f.activity)).invitations[0].pointId);}
  finally{await rm(dir,{recursive:true,force:true});}
  s=await readState(f.activity);const inv=s.invitations[0];inv.status='ACCEPTED';inv.pointId=null;s.points.forEach(p=>{p.occupant=null;p.occupants=[];});
  await database().query('UPDATE dl_activities SET state=$2 WHERE id=$1',[f.activity,s]);
  const recovered=await readState(f.activity);assert.ok(recovered.invitations[0].pointId);const rev=recovered.revision;assert.equal((await readState(f.activity)).revision,rev);
});
test("old clients cannot start 520 tasks while existing shared-code tasks keep their code",async()=>{
  const f=await fixture(1);const a=f.state.participants[0],b=f.state.participants[1];
  await assert.rejects(execute(f.activity,{role:'participant',actor:a.id},{type:'invite',targetId:b.id},randomUUID(),f.state.epoch,''),/规则已更新/);
  await cmd(f.activity,f.state,a.id,{type:'invite',targetId:b.id});let s=await readState(f.activity);
  const inv=s.invitations[0];delete inv.codeVersion;inv.code='4721';
  await database().query('UPDATE dl_activities SET state=$2 WHERE id=$1',[f.activity,s]);
  await execute(f.activity,{role:'participant',actor:b.id},{type:'accept',invitationId:inv.id},randomUUID(),s.epoch,'');
  s=await readState(f.activity);assert.equal(s.invitations[0].code,'4721');assert.equal(s.invitations[0].encounterCodes,undefined);
});
test("archiving a departed pair holds its codes privately until the physical location is cleared",async()=>{
  const f=await fixture(1);const a=f.state.participants[0],b=f.state.participants[1];
  await cmd(f.activity,f.state,a.id,{type:'invite',targetId:b.id});let s=await readState(f.activity);const inv=s.invitations[0];
  await cmd(f.activity,s,b.id,{type:'accept',invitationId:inv.id});s=await readState(f.activity);
  const assigned=s.invitations[0],codes=Object.values(assigned.encounterCodes!);
  await cmd(f.activity,s,a.id,{type:'depart',invitationId:inv.id});
  const input={action:'remove',ids:[a.id],epoch:s.epoch};const preview=await fieldPreview(f.activity,input);
  await fieldAction(f.activity,{...input,preview:preview.token},randomUUID());
  s=await readState(f.activity);const point=s.points.find(p=>p.id===assigned.pointId)!;
  assert.deepEqual(point.retainedCodes?.sort(),codes.sort());assert.equal(point.closed,true);
  assert.ok(!JSON.stringify(mobileProjection(s,b.id,f.activity)).includes('retainedCodes'));
  await assert.rejects(execute(f.activity,op,{type:'point-status',pointId:point.id,enabled:true},randomUUID(),s.epoch),/确认归档/);
  await execute(f.activity,op,{type:'release',pointId:point.id},randomUUID(),s.epoch);
  const released=(await readState(f.activity)).points.find(p=>p.id===point.id)!;
  assert.equal(released.closed,false);assert.deepEqual(released.retainedCodes,[]);
});
