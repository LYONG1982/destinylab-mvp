import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_WALL_CONFIG, wallConfigErrors, wallAgeRange, wallAgeLabel, memberCard, rotateWall, safeWallCard, validateWallConfig, wallColumns, wallDemographics, wallNickname, rotateWallSlots, pruneWallSlots, wallCardSlots, wallSlotGender, type GenderCandidate, type WallCandidate } from "../../src/domain/member-wall";
import { WallClock } from "../../src/features/member-wall/scheduler";
import { demoMembers } from "../../src/features/member-wall/demo";
import type { Participant } from "../../src/domain/types";

test("wall privacy projection never uses uploaded photo, raw identity, or unlisted answers", () => {
  const p = { id: "PRIVATE_ACTOR", name: "PRIVATE_NAME", gender: "female", avatarId: "female_02",
    photo: { id: "PRIVATE_PHOTO", screen: true }, answers: { q1: "PRIVATE_ANSWER", q2: "安静咖啡馆", q3: "电影与音乐", q4: "先做朋友", q5: "在家充电", q6: "相处自在", q9: "认真了解彼此", q8: "认真听对方说", q10: "PRIVATE_PREFERENCE" } } as unknown as Participant;
  const card = memberCard(p, "public-id", "MW-1234ABCD", "清禾");
  assert.ok(safeWallCard(card)); assert.equal(card.tags.length, 2); assert.deepEqual(card.tags, ["电影与音乐", "在家充电"]);
  assert.deepEqual(card.preferences, [{label:"周末偏好",value:"在家充电"},{label:"见面看重",value:"相处自在"},{label:"沟通方式",value:"认真听对方说"},{label:"关系期待",value:"认真了解彼此"}]);
  assert.equal(JSON.stringify(card).includes("安静咖啡馆"),false);assert.equal(JSON.stringify(card).includes("先做朋友"),false);
  assert.equal(JSON.stringify(card).includes("PRIVATE"), false);
  assert.equal(safeWallCard({ ...card, avatarUrl: "/api/avatar/private?screen=1" }), false);
  assert.equal(safeWallCard({ ...card, consentToPublicDisplay: false } as never), false);
});
test("explicit nicknames reject contact and markup; config rejects unbounded timings", () => {
  for (const text of ["", "123456789", "13800138000", "微信abc", "a@b.cn", "<script>", "a\u202eb", "名字超过八个汉字限制"]) assert.throws(() => wallNickname(text));
  assert.equal(wallNickname(" 清禾Alex "), "清禾Alex");
  assert.throws(() => validateWallConfig({ ...DEFAULT_WALL_CONFIG, rotationSeconds: 10 }));
  assert.throws(() => validateWallConfig({ ...DEFAULT_WALL_CONFIG, maxColumns: 9 }));
  assert.deepEqual(validateWallConfig(DEFAULT_WALL_CONFIG), DEFAULT_WALL_CONFIG);
});
test("one monotonic timeline separates flips from swaps and survives suspension/reset", () => {
  const c = new WallClock(); c.reset(100);
  for (const [at, side, flipping] of [[0,"front",false],[10000,"back",true],[20000,"front",true],[30000,"back",true],[40000,"front",true],[41300,"front",false]] as const) {
    const f = c.frame(100 + at, DEFAULT_WALL_CONFIG, 7); assert.equal(f.side, side); assert.equal(f.flipping, flipping);
    assert.equal(f.rotate, at === 41300);
  }
  c.didRotate(41400, DEFAULT_WALL_CONFIG); assert.equal(c.frame(42100, DEFAULT_WALL_CONFIG, 7).rotate, false);
  assert.equal(c.frame(81400, DEFAULT_WALL_CONFIG, 7).rotate, true);
  c.reset(100000); assert.equal(c.frame(100000, DEFAULT_WALL_CONFIG, 7).side, "front");
  assert.equal(c.frame(200000, { ...DEFAULT_WALL_CONFIG, running: false }, 7).rotate, false);
  assert.equal(c.frame(110200, DEFAULT_WALL_CONFIG, 7, true).flipping, false);
});
for (const size of [10, 28, 50, 200]) test(`fair rotation covers ${size} users without duplicates or invented slots`, () => {
  const all: WallCandidate[] = Array.from({ length: size }, (_, i) => ({ id: String(i), seconds: 0, last: 0, joined: i }));
  let current = rotateWall(all, [], 28, 25, false); const seen = new Set(current); const firstSeen = new Map(current.map((id) => [id, 0]));
  for (let cycle = 1; cycle <= 40; cycle++) {
    for (const row of all) if (current.includes(row.id)) { row.seconds += 40; row.last = cycle * 40; }
    const next = rotateWall(all, current, 28, 25, true);
    assert.equal(new Set(next).size, next.length); assert.equal(next.length, Math.min(size, 28));
    if (size <= 28) assert.deepEqual(next, current);
    else assert.equal(next.filter((id) => !current.includes(id)).length, Math.min(7, size - 28));
    next.forEach((id) => { seen.add(id); if (!firstSeen.has(id)) firstSeen.set(id, cycle * 40); }); current = next;
  }
  assert.equal(seen.size, size); assert.ok(Math.max(...firstSeen.values()) <= Math.ceil(Math.max(0, size - 28) / 7) * 40);
});
test("revoked IDs disappear immediately; new entrants do not displace active cards until rotation", () => {
  const all = Array.from({ length: 35 }, (_, i) => ({ id: String(i), seconds: 0, last: 0, joined: i }));
  const current = all.slice(0,28).map((x) => x.id);
  assert.deepEqual(rotateWall(all, current, 28, 25, false), current);
  const repaired = rotateWall(all.filter((c) => c.id !== "4"), current, 28, 25, false);
  assert.equal(repaired.includes("4"), false); assert.equal(repaired.length, 28);
  for (const ratio of [25,50,100]) assert.equal(rotateWall(Array.from({length:70},(_,i)=>({id:String(i),seconds:0,last:0,joined:i})),current,28,ratio,true).filter(id=>!current.includes(id)).length,28*ratio/100);
});
test("layout is four-row capacity from measured area, demo has 20 known avatar assets", () => {
  assert.equal(wallColumns(1824, 747).columns, 6);
  assert.equal(wallColumns(320, 400).readable, false);
  assert.equal(wallColumns(3650, 1500).columns, 6);
  const demo = demoMembers(200); assert.equal(new Set(demo.map(c=>c.id)).size,200);
  assert.equal(new Set(demo.map(c=>c.avatarUrl)).size,20); assert.ok(demo.every(safeWallCard));
});

test("activity demographics include the whole roster without guessing missing gender", () => {
  assert.deepEqual(wallDemographics([]), {total:0,male:0,female:0});
  assert.deepEqual(wallDemographics([{gender:"male"},{gender:"male"},{gender:"female"},{},{gender:"unknown"}]), {total:5,male:2,female:1});
  assert.deepEqual(wallDemographics(demoMembers(50)), {total:50,male:25,female:25});
  assert.deepEqual(wallDemographics(demoMembers(9)), {total:9,male:4,female:5});
});
test("card gender follows the profile even when an opposite-gender avatar is selected", () => {
  const p = {id:"p",gender:"male",avatarId:"female_01",answers:{}} as Participant;
  const card=memberCard(p,"public","MW-12345678","山间");
  assert.equal(card.gender,"male");assert.match(card.avatarUrl,/female/);assert.ok(safeWallCard(card));
  assert.equal(safeWallCard({...card,gender:undefined} as never),false);
  assert.equal(safeWallCard({...card,gender:"unknown"} as never),false);
  assert.throws(()=>memberCard({...p,gender:"unknown"} as never,"public","MW-12345678","山间"));
});

for (const [male,female] of [[25,25],[20,4],[40,0],[0,40],[2,2],[0,0],[100,100]]) test(`grouped wall covers ${male} men and ${female} women within their reserved seats`, () => {
  const candidates:GenderCandidate[]=Array.from({length:male+female},(_,i)=>({id:String(i),gender:i<male?"male":"female",seconds:0,last:0,joined:i}));
  let slots=rotateWallSlots(candidates,[],25,false);const seen=new Set(slots.filter(Boolean));
  for(let cycle=0;cycle<70;cycle++) {
    assert.equal(slots.length,24);assert.equal(slots.filter(Boolean).length,Math.min(12,male)+Math.min(12,female));
    assert.equal(new Set(slots.filter(Boolean)).size,slots.filter(Boolean).length);
    slots.forEach((id,i)=>{if(id)assert.equal(candidates.find(c=>c.id===id)!.gender,wallSlotGender(i));});
    for(const c of candidates)if(slots.includes(c.id)){c.seconds+=40;c.last=cycle*40;}
    slots=rotateWallSlots(candidates,slots,25,true);slots.filter(Boolean).forEach(id=>seen.add(id));
  }
  assert.equal(seen.size,male+female);
});
test("each side rotates its own quota; revocation and gender changes leave a stable empty seat until rotation",()=>{
  const all:GenderCandidate[]=Array.from({length:60},(_,i)=>({id:String(i),gender:i<30?"male":"female",seconds:0,last:0,joined:i}));
  const initial=rotateWallSlots(all,[],25,false);
  for(const ratio of [25,50,100]){
    const next=rotateWallSlots(all,initial,ratio,true);
    for(const gender of ["male","female"])assert.equal(next.filter((id,i)=>id&&!initial.includes(id)&&wallSlotGender(i)===gender).length,12*ratio/100);
  }
  const changed=all.map(c=>c.id===initial[0]?{...c,gender:"female" as const}:c).filter(c=>c.id!==initial[4]);
  const pruned=pruneWallSlots(changed,initial);assert.equal(pruned[0],null);assert.equal(pruned[4],null);
  pruned.forEach((id,i)=>{if(id)assert.equal(id,initial[i]);});
  const cards=demoMembers(50),byId=new Map(cards.map(c=>[c.id,c]));
  const projected=rotateWallSlots(cards.map((c,i)=>({...c,seconds:0,last:0,joined:i})),[],25,false).flatMap((id,slot)=>id?[{...byId.get(id)!,slot}]:[]);
  const mapped=wallCardSlots(projected.filter(c=>c.slot!==0));assert.equal(mapped[0],undefined);assert.equal(mapped[1]?.id,projected.find(c=>c.slot===1)?.id);
  assert.deepEqual(validateWallConfig({...DEFAULT_WALL_CONFIG,minColumns:3,maxColumns:8}),DEFAULT_WALL_CONFIG);
});

test("six-column wall fits ordinary desktop content areas without changing large-screen typography",()=>{
  for(const [width,height] of [[852,390],[974,440],[1216,445],[1368,550]]){
    const layout=wallColumns(width,height);assert.equal(layout.columns,6);assert.equal(layout.readable,true);assert.ok(layout.scale>=.45);
  }
  assert.equal(wallColumns(1824,820).scale,1);
  assert.equal(wallColumns(800,600).readable,false);
  assert.equal(wallColumns(1280,300).readable,false);
});

test("four-answer projection omits unanswered choices and rejects excess fields",()=>{
  const p={id:"p",gender:"female",avatarId:"female_01",answers:{q2:"安静咖啡馆",q4:"慢慢靠近",q6:"真诚表达",q9:"invalid"}} as unknown as Participant;
  const card=memberCard(p,"public","MW-12345678","晴禾");
  assert.deepEqual(card.preferences,[{label:"见面看重",value:"真诚表达"}]);assert.deepEqual(card.tags,[]);
  assert.equal(safeWallCard({...card,preferences:Array(5).fill(card.preferences[0])}),false);
  assert.deepEqual(memberCard({...p,answers:{}},"public","MW-12345678","晴禾").preferences,[]);
});


test("wall age is a validated activity range and never an inferred exact age",()=>{
  for(const [age,label] of [["22–25","22–25岁"],["26–29","26–29岁"],["30–33","30–33岁"],["34–37","34–37岁"],["38+","38岁及以上"]]){
    const card=memberCard({id:"p",gender:"female",age,answers:{}} as Participant,"public","MW-12345678","清禾");
    assert.equal(card.ageRange,age);assert.equal(wallAgeLabel(card.ageRange),label);assert.ok(safeWallCard(card));
  }
  for(const age of [undefined,null,"",27,"27","1998-01-01","13800138000","26-29"]){
    assert.equal(wallAgeRange(age),null);assert.equal(wallAgeLabel(age),"");
    const card=memberCard({id:"p",gender:"female",age,answers:{}} as unknown as Participant,"public","MW-12345678","清禾");
    assert.equal(card.ageRange,null);assert.ok(safeWallCard(card));
    assert.equal(safeWallCard({...card,ageRange:age} as never),age===null);
  }
});


test("operator field validation agrees with server config constraints", () => {
  for (const flipSeconds of [0, 7, 8, 10.5, 60, 61, NaN]) {
    for (const rotationSeconds of [0, 16, 20, 120, 600, 601, NaN]) {
      const config = { ...DEFAULT_WALL_CONFIG, flipSeconds, rotationSeconds };
      const valid = Object.keys(wallConfigErrors(config)).length === 0;
      if (valid) assert.deepEqual(validateWallConfig(config), config);
      else assert.throws(() => validateWallConfig(config));
    }
  }
});
