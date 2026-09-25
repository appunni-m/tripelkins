import test from "node:test";
import assert from "node:assert/strict";
import {createWorld,addCreature,addObject,migrateWorld} from "../src/game/state.js";
import {makePlan,applyPlan,stepWorld} from "../src/game/simulation.js";
import {serviceSlots} from "../src/game/geometry.js";
import {routeCost} from "../src/game/navigation.js";
import {requestAccess,reviewAccess,clearanceChoices,startClearance} from "../src/game/access.js";
import {settlementDecisionInput,currentSettlementChoice} from "../src/game/settlement.js";
import {NEED_DECAY} from "../src/game/work-balance.js";
import {reveal} from "../src/game/discovery.js";

function world() {
  const w=createWorld({empty:true});w.progress.hatched=true;
  w.runtime={intelligenceAvailable:true,growth:{held:true}};
  w.community.consent="accepted";return w;
}
function creature(w,x=15,y=24) {
  const c=addCreature(w,x,y);c.fed=c.clean=c.amused=95;return c;
}
function blockedMine() {
  const w=world(),c=creature(w),target=addObject(w,"mine",24,24,{stock:1000});
  for(let i=0;i<24;i++) {const a=i*Math.PI/12;addObject(w,"tree",24+Math.cos(a)*4,24+Math.sin(a)*4);}
  requestAccess(w,{target:target.id,unit:c.id,task:"mine",point:serviceSlots(w,target,c)[0]});
  return {w,c,target};
}
test("rest cannot reduce an already happy creature; decay uses the work-friendly rates",()=>{
  const w=world(),c=creature(w);w.time=1;
  c.task="rest";c.work=3.95;c.job={state:"working",point:{x:c.x,y:c.y},started:1,lastProgress:1,expected:20};
  stepWorld(w,.1);
  for(const key of ["fed","clean","amused"])assert.ok(Math.abs(c[key]-(95-NEED_DECAY[key]*.1))<1e-8);
  assert.equal(c.task,"idle");
});
test("new work rotates across rested workers without stealing an ongoing reservation",()=>{
  const w=world();addObject(w,"mine",25,24,{stock:1000});
  for(let i=0;i<12;i++)creature(w,15+(i%4),20+Math.floor(i/4));
  const first=makePlan(w,"mine");assert.equal(applyPlan(w,first),true);
  const miners=first.assignments.filter(a=>a.task==="mine");assert.equal(miners.length,4);
  const kept=makePlan(w,"mine");assert.ok(miners.every(a=>kept.assignments.some(b=>b.id===a.id&&b.keep&&b.target===a.target)));
  const original=new Set(miners.map(a=>a.id));
  for(const c of w.creatures.filter(c=>original.has(c.id))){c.task="idle";c.job.state="completed";}
  const next=makePlan(w,"mine").assignments.filter(a=>a.task==="mine");
  assert.equal(next.length,4);assert.ok(next.every(a=>!original.has(a.id)));
  const saved=migrateWorld(w);assert.equal(saved.community.workTurn,w.community.workTurn);
  assert.deepEqual(saved.creatures.map(c=>c.lastWorkTurn),w.creatures.map(c=>c.lastWorkTurn||0));
});
test("long routes can detour inside a bounded shifted field",()=>{
  const w=world(),c=creature(w,12,5),destination={x:12,y:60};
  addObject(w,"factory",12,30);reveal(w,destination,10);
  assert.ok(Number.isFinite(routeCost(w,c,destination)));
});
test("a reserved entrance never becomes a terrain-clearing request",()=>{
  const w=world(),c=creature(w),target=addObject(w,"bath",20,24);
  requestAccess(w,{target:target.id,unit:c.id,task:"wash",point:serviceSlots(w,target,c)[0]});
  assert.equal(w.community.access.length,0);assert.equal(w.community.activity.length,0);
});
test("a model-selected clearing step physically opens a blocked mine and preserves resources",()=>{
  const {w,c,target}=blockedMine();
  assert.ok(serviceSlots(w,target,c).every(p=>!Number.isFinite(routeCost(w,c,p))));
  reviewAccess(w);
  const choice=clearanceChoices(w)[0];assert.ok(choice);assert.match(choice.description,/Clear a tree at/);
  const input=settlementDecisionInput(w,[choice]);assert.match(input.options[choice.key],/tree/);
  assert.equal(currentSettlementChoice(w,choice).blocker,choice.blocker);
  const wood=w.inventory.wood;assert.equal(startClearance(w,choice,"Fixture model"),true);
  const saved=migrateWorld(w);assert.deepEqual(migrateWorld(saved).community,saved.community);
  assert.equal(saved.community.access[0].source,"Fixture model");
  for(let i=0;i<300;i++)stepWorld(w,.1);
  assert.equal(w.progress.chopped,1);assert.equal(w.inventory.wood,wood+6);
  assert.equal(w.community.access.length,0);
  assert.ok(serviceSlots(w,target,c).some(p=>Number.isFinite(routeCost(w,c,p))));
  assert.ok(w.community.activity.some(a=>a.kind==="unblocked"));
});
test("blocked work asks once for help and cannot clear without consent, intelligence or work permission",()=>{
  const {w,c,target}=blockedMine();w.runtime.intelligenceAvailable=false;
  for(let i=0;i<8;i++){w.time=i*6;requestAccess(w,{target:target.id,unit:c.id,task:"mine",point:serviceSlots(w,target,c)[0]});reviewAccess(w);}
  assert.equal(w.community.access.length,1);assert.equal(w.community.inbox.filter(m=>m.key?.startsWith("access:")).length,1);
  assert.equal(clearanceChoices(w).length,0);
  w.runtime.intelligenceAvailable=true;const choice=clearanceChoices(w)[0];assert.ok(choice);
  w.directives.pauseWork=true;assert.equal(startClearance(w,choice,"Fixture model"),false);
  w.directives.pauseWork=false;w.community.consent="declined";assert.equal(startClearance(w,choice,"Fixture model"),false);
  assert.equal(w.progress.chopped,0);
});
