import test from "node:test";
import assert from "node:assert/strict";
import { createSeed } from "@/data/seed";
import { QUESTIONS } from "@/data/questions";
import { applyCommand } from "@/domain/commands";
import { CODE_PAIRS, pointOccupants, reconcileEncounters, hasEncounterWork, ownEncounterCode } from "@/domain/encounters";
import { defaultMeetPoints } from "@/domain/meet-points";
import type { Command, DemoState, Invitation } from "@/domain/types";

let seq = 0;
const run = (s: DemoState, actor: string, command: Command) => applyCommand(s, { actor, command, epoch: s.epoch, id: `e520-${seq++}` }, s.now);
function fixture(pairs = 1) {
  const s = createSeed("discover"); s.invitations = []; s.points = defaultMeetPoints(); s.events = [];
  const p = s.participants[0];
  s.participants = Array.from({ length: pairs * 2 }, (_, n) => ({ ...structuredClone(p), id: `actor-${n}`, name: n % 2 ? "清禾" : "山风", gender: n % 2 ? "female" as const : "male" as const, avatarId: n % 2 ? "female_01" : "male_01", currentId: null, present: true, ready: true, paused: false, answers: Object.fromEntries(QUESTIONS.map(q => [q.id, q.options[0]])) }));
  return s;
}
function pair(s: DemoState, n = 0) {
  s = run(s, `actor-${n * 2}`, { type: "invite", targetId: `actor-${n * 2 + 1}` });
  const i = s.invitations.at(-1)!;
  return run(s, i.to, { type: "accept", invitationId: i.id });
}
test("the complete code pool has 160 disjoint three-digit pairs and no self-pair", () => {
  assert.equal(CODE_PAIRS.length, 160);
  assert.equal(new Set(CODE_PAIRS.flat()).size, 320);
  for (const [a,b] of CODE_PAIRS) { assert.equal(a+b,520); assert.notEqual(a,b); assert.ok(a>=100 && b>=100 && a<1000 && b<1000); }
});
test("only mutual acceptance allocates personal codes; repeated and reciprocal actions preserve one task", () => {
  let s = fixture(); s=run(s,"actor-0",{type:"invite",targetId:"actor-1"});
  const id=s.invitations[0].id; assert.equal(s.invitations[0].code,""); assert.equal(s.invitations[0].encounterCodes,undefined);
  s=run(s,"actor-1",{type:"invite",targetId:"actor-0"});
  const first=structuredClone(s.invitations[0]); const codes=Object.values(first.encounterCodes!);
  assert.equal(codes.reduce((n,c)=>n+Number(c),0),520); assert.notEqual(codes[0],codes[1]);
  s=run(s,"actor-1",{type:"accept",invitationId:id});
  assert.deepEqual(s.invitations[0],first); assert.equal(s.invitations.length,1); assert.equal(s.points.flatMap(pointOccupants).length,1);
  assert.equal(ownEncounterCode(first,"stranger"),"");
});
test("same-location capacity is respected, unused locations are preferred, release wakes only one waiter", () => {
  let s=fixture(4);s.points=s.points.slice(0,2);s.points[0].capacity=2;s.points[1].capacity=1;
  s=pair(s,0);s=pair(s,1);s=pair(s,2);s=pair(s,3);
  assert.notEqual(s.invitations[0].pointId,s.invitations[1].pointId);
  assert.equal(pointOccupants(s.points[0]).length,2); assert.equal(s.invitations[3].status,"ACCEPTED");
  assert.equal(new Set(s.invitations.flatMap(i=>Object.values(i.encounterCodes!))).size,8);
  const held=s.invitations[0];s=run(s,held.from,{type:"depart",invitationId:held.id});
  assert.throws(()=>run(s,"operator",{type:"release",pointId:held.pointId!}),/先结束/);
  s=run(s,held.from,{type:"cancel",invitationId:held.id});
  assert.equal(pointOccupants(s.points[0]).length,2);
  assert.equal(s.invitations[3].status,"ACCEPTED");
  s=run(s,"operator",{type:"release",pointId:held.pointId!,invitationId:held.id});
  assert.equal(s.invitations[3].status,"MEET_ASSIGNED");
  assert.ok(pointOccupants(s.points[0]).includes(s.invitations[2].id));
  assert.equal(pointOccupants(s.points[0]).length,2);
});
test("30 pairs claim unique points, pair 31 waits and cancellation retains its point until physical release", () => {
  let s=fixture(31);s.points=s.points.map(point=>({...point,capacity:1}));for(let n=0;n<31;n++)s=pair(s,n);
  assert.equal(new Set(s.invitations.slice(0,30).map(i=>i.pointId)).size,30);
  assert.equal(s.invitations[30].pointId,null);
  const id=s.invitations[0].id;s=run(s,"actor-0",{type:"cancel",invitationId:id});
  assert.equal(s.invitations[30].status,"ACCEPTED");
  assert.ok(pointOccupants(s.points.find(point=>point.id===s.invitations[0].pointId)!).includes(id));
  s=run(s,"operator",{type:"release",pointId:s.invitations[0].pointId!,invitationId:id});
  assert.equal(s.invitations[30].status,"MEET_ASSIGNED");
});
test("exhausted code pool waits without duplicate numbers; paused state does not cause endless reconciliation", () => {
  const s=fixture(); const old=s.participants[0];
  s.invitations=CODE_PAIRS.map(([a,b],n)=>({id:`old-${n}`,from:`m-${n}`,to:`f-${n}`,status:"ARRIVING",acceptedAt:s.now,createdAt:s.now,pointId:null,departures:{},arrivals:{},confirmations:{},common:[],choices:{},pass:"x",code:"",codeVersion:"520",encounterCodes:{[`m-${n}`]:String(a),[`f-${n}`]:String(b)}} as Invitation));
  const next=run(s,old.id,{type:"invite",targetId:"actor-1"});const sent=next.invitations.at(-1)!;
  const accepted=run(next,sent.to,{type:"accept",invitationId:sent.id});
  assert.equal(accepted.invitations.at(-1)!.encounterCodes,undefined);assert.equal(hasEncounterWork(accepted),false);
  const paused=fixture();paused.invitations=[{...sent,status:"ACCEPTED",acceptedAt:s.now}];paused.participants[0].paused=true;
  assert.equal(hasEncounterWork(paused),false);assert.equal(reconcileEncounters(paused,paused.now),false);
});
test("point configuration keeps legacy occupancy and rejects reducing below used capacity", () => {
  let s=fixture(2);s.points=s.points.slice(0,1);s=run(s,"operator",{type:"point-config",pointId:s.points[0].id,location:"东侧集合区",capacity:2});
  s=pair(s,0);s=pair(s,1);
  assert.throws(()=>run(s,"operator",{type:"point-config",pointId:s.points[0].id,location:"新说明",capacity:1}),/不能小于/);
  assert.throws(()=>run(s,"actor-0",{type:"point-config",pointId:s.points[0].id,location:"",capacity:3}),/运营身份/);
});
