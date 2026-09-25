import test from "node:test";
import assert from "node:assert/strict";
import { developmentWorld } from "../src/game/settlement-evaluation.js";
import { settlementChoices, startSettlement, settlementDecisionInput } from "../src/game/settlement.js";
import { stepWorld, makePlan, applyPlan } from "../src/game/simulation.js";
import { migrateWorld, addObject, addCreature } from "../src/game/state.js";
import { addGoal, inspectGoal } from "../src/game/goals.js";
import { parseConstraints, commitConstraints, commandOptions } from "../src/game/commands.js";
import { setIndependence } from "../src/game/community.js";
import { buildContext } from "../src/game/context.js";
import { packHostedContext, utf8Size } from "../src/game/context-budget.js";
import { appendTimeline, readMoment } from "../src/game/timeline.js";

function start(w,type) {
  const choice=settlementChoices(w).find(c=>c.id===type);
  assert.ok(choice,`${type}: ${JSON.stringify(settlementChoices(w))}`);
  assert.equal(startSettlement(w,choice,"Fixture intelligence"),true);
}
function run(w,seconds=230) {
  for(let i=0;i<seconds*10&&w.community.project;i++)stepWorld(w,.1);
  return w;
}
test("independent timber and stone projects gather real resources with no caretaker tools",()=>{
  for(const kind of ["timber","quarry"]) {
    const w=developmentWorld(kind);start(w,kind);run(w);
    const resource=kind==="timber"?"wood":"ore";
    assert.ok(w.inventory[resource]>=12,JSON.stringify({kind,p:w.community.project,inventory:w.inventory}));
    assert.equal(w.evidence.deaths,0);
    if(kind==="timber") assert.equal(w.inventory.wood,6*w.progress.chopped);
    else {
      const remaining=w.objects.filter(o=>o.type==="rock").length;
      const loose=w.objects.filter(o=>o.type==="ore").reduce((n,o)=>n+o.stock,0);
      const carried=w.creatures.reduce((n,c)=>n+(c.cargoKind==="ore"?c.carry:0),0);
      assert.equal(w.inventory.ore+loose+carried,(12-remaining)*3);
    }
  }
});
test("a healthy crew makes the first 300 blocks from stone and unlocks useful construction",()=>{
  const w=developmentWorld();start(w,"refine");run(w);
  assert.ok(w.inventory.blocks>=300,JSON.stringify({p:w.community.project,inventory:w.inventory,jobs:w.memory.activity}));
  assert.equal(w.progress.energy,w.inventory.blocks,"hand processing does not gain factory energy");
  assert.ok(w.memory.activity.quarry>0 && w.memory.activity.refine>0);
  assert.equal(w.evidence.deaths,0);
  w.time+=31;
  assert.ok(settlementChoices(w).some(c=>c.id==="factory"));
  assert.ok(settlementChoices(w).some(c=>c.id==="dwelling"));
  const converted=w.inventory.blocks/10;
  const loose=w.objects.filter(o=>o.type==="ore").reduce((n,o)=>n+o.stock,0);
  const carried=w.creatures.reduce((n,c)=>n+(c.cargoKind==="ore"?c.carry:0),0);
  assert.equal(w.inventory.ore+loose+carried+converted,(12-w.objects.filter(o=>o.type==="rock").length)*3);
});
test("the independent bridge crew cuts and delivers wood without pressing supply",()=>{
  const w=developmentWorld("crossing");start(w,"crossing");run(w);
  assert.equal(w.progress.bridge,true,JSON.stringify({p:w.community.project,wood:w.inventory.wood,jobs:w.memory.activity}));
  const bridge=w.objects.find(o=>o.type==="bridge");
  assert.equal(bridge.stock,24);assert.equal(w.stage,2);
  const carried=w.creatures.reduce((n,c)=>n+(c.cargoKind==="wood"?c.carry:0),0);
  assert.equal(w.inventory.wood+bridge.stock+carried,6*w.progress.chopped);
  assert.equal(w.evidence.deaths,0);
});
test("mine and factory construction use node stock and blocks once",()=>{
  for(const type of ["mine","factory","dwelling","theatre"]) {
    const w=developmentWorld();w.inventory.blocks=1200;w.progress.peakBlocks=1200;
    if(type==="theatre") {
      for(let i=0;i<20;i++) {
        const c=addCreature(w,20+i%5,20+Math.floor(i/5));
        c.fed=c.clean=c.amused=85;
      }
    }
    if(type==="mine")addObject(w,"node",33,16,{stock:99});
    const choices=settlementChoices(w);
    const choice=choices.find(c=>c.id===type);assert.ok(choice,type);
    const before=w.inventory.blocks;assert.ok(startSettlement(w,choice,"Fixture intelligence"));run(w);
    const built=w.objects.find(o=>o.type===type);assert.ok(built,JSON.stringify(w.community.project));
    assert.equal(w.inventory.blocks,before-({mine:25,factory:150,dwelling:100,theatre:500}[type]));
    if(type==="mine") {
      assert.equal(w.objects.some(o=>o.type==="node"),false);
      assert.equal(built.stock+w.inventory.ore+w.creatures.reduce((n,c)=>n+(c.cargoKind==="ore"?c.carry:0),0),99);
    }
  }
});
test("factories receive stored ore through physical workers without duplicating material",()=>{
  const w=developmentWorld();const factory=addObject(w,"factory",32,24,{inputOre:0});
  w.inventory.ore=12;
  assert.equal(applyPlan(w,makePlan(w)),true);
  assert.equal(factory.inputOre,0);
  for(let i=0;i<1000;i++)stepWorld(w,.1);
  assert.ok(w.inventory.blocks>0);
  assert.equal(w.inventory.ore+factory.inputOre+w.inventory.blocks/8,12);
});
test("new jobs stop on revoked consent, model loss, work restrictions and urgent hunger",()=>{
  for(const mode of ["consent","intelligence","stop","hunger"]) {
    const w=developmentWorld("quarry");start(w,"quarry");applyPlan(w,makePlan(w));
    if(mode==="consent")setIndependence(w,false);
    if(mode==="intelligence")w.runtime.intelligenceAvailable=false;
    if(mode==="stop")commitConstraints(w,parseConstraints(w,"Stop quarrying and mining"));
    if(mode==="hunger") for(const c of w.creatures)c.fed=5;
    for(let i=0;i<20;i++)stepWorld(w,.1);
    assert.equal(w.inventory.ore,0,mode);
    assert.ok(w.creatures.every(c=>!["quarry","refine","gather","construct"].includes(c.task)),mode);
  }
});
test("resource project, interrupted jobs and accounting survive snapshots and timeline restore",()=>{
  let w=developmentWorld();start(w,"refine");
  for(let i=0;i<200;i++)stepWorld(w,.1);
  const timeline=appendTimeline(null,null,migrateWorld(w)), branch=timeline.branches[0];
  const restored=readMoment(branch,branch.base.id);
  assert.equal(restored.community.project.type,"refine");
  assert.equal(restored.community.project.target,300);
  assert.deepEqual(restored.inventory,w.inventory);
  w=migrateWorld(w);const ore=w.inventory.ore;for(let i=0;i<10;i++)stepWorld(w,.1);
  assert.equal(w.inventory.ore,ore,"restored workers wait for intelligence");
  w.runtime={intelligenceAvailable:true};run(w);
  assert.ok(w.inventory.blocks>=300);
});
test("explicit resource instructions focus the matching work and context stays bounded",()=>{
  const w=developmentWorld();start(w,"refine");
  const g=addGoal(w,{kind:"wood",target:18},"Cut trees for 18 wood","Fixture intelligence");
  for(let i=0;i<30;i++)stepWorld(w,.1);
  assert.equal(w.community.project,null);
  assert.deepEqual(settlementChoices(w).map(c=>c.id),["timber"]);
  assert.match(inspectGoal(w,g).step,/Cut trees/);
  assert.equal(inspectGoal(w,g).blocker,"");
  assert.ok(commandOptions("Cut trees").wood);
  assert.ok(commandOptions("Break stone").ore);
  const input=settlementDecisionInput(w,settlementChoices(w));assert.ok(input.options.timber);
  assert.ok(utf8Size(packHostedContext(buildContext(w).context,16000).context)<=16000);
});
test("development never proposes destructive tools or ignores region and pollution restrictions",()=>{
  const w=developmentWorld();w.inventory.blocks=w.progress.peakBlocks=10000;
  w.directives.avoidPollution=true;
  assert.ok(!settlementChoices(w).some(c=>["factory","tnt","cannon","meteor","bug","swarm"].includes(c.id)));
  w.directives.region={x:50,y:25};
  assert.ok(settlementChoices(w).every(c=>c.x>42));
  assert.equal(startSettlement(w,{id:"meteor",x:24,y:24},"bad"),false);
});

test("factories stay near ore workplaces instead of chasing a distant scout",()=>{
  const w=developmentWorld();w.inventory.blocks=w.progress.peakBlocks=600;
  const mine=addObject(w,"mine",33,16,{stock:1000});
  const scout=addCreature(w,-40,-40);scout.fed=scout.clean=scout.amused=90;
  const factory=settlementChoices(w).find(c=>c.id==="factory");
  assert.ok(factory);
  assert.ok(Math.hypot(factory.x-mine.x,factory.y-mine.y)<20);
  assert.ok(Math.hypot(factory.x-scout.x,factory.y-scout.y)>30);
});

test("Jev receives the resource project contract and returns only a listed project",async()=>{
  const {decideSettlement,brainStatus,stopBrain}=await import("../src/brain.js");
  const original=globalThis.fetch;
  try {
    const w=developmentWorld("quarry");w.settings.provider="jev";brainStatus.ready=true;
    let body;
    globalThis.fetch=async(url,init)=>{body=JSON.parse(init.body);return {ok:true,json:async()=>({answers:{decision:{type:"choice",choice:"quarry"}}})};};
    const decision=await decideSettlement(w,"fixture-only");
    assert.equal(decision.choice.id,"quarry");
    assert.ok(body.questions.decision.criteria.quarry);
    assert.equal(body.state.longTermGoal.kind,"ore");
    assert.equal(w.community.project,null);
    assert.equal(startSettlement(w,decision.choice,decision.source),true);
  } finally {globalThis.fetch=original;stopBrain();}
});
