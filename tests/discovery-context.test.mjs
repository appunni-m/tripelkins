import test from "node:test";
import assert from "node:assert/strict";
import {createWorld,addCreature,addObject,migrateWorld} from "../src/game/state.js";
import {reveal,revealColony,isExplored,DISCOVERY_LIMIT,discoverySummary} from "../src/game/discovery.js";
import {appendTimeline,readMoment} from "../src/game/timeline.js";
import {careContext} from "../src/game/care-context.js";
import {settlementChoices,settlementDecisionChoices,settlementDecisionInput,settlementContext,currentSettlementChoice} from "../src/game/settlement.js";
import {settlementWorld,developmentWorld} from "../src/game/settlement-evaluation.js";
import {buildContext} from "../src/game/context.js";
import {packHostedContext} from "../src/game/context-budget.js";

test("creatures reveal fog; moving the camera never does; old ground stays revealed",()=>{
  const w=createWorld({empty:true});
  assert.ok(isExplored(w,{x:24,y:24}));assert.equal(isExplored(w,{x:80,y:20}),false);
  w.ui.x=80;w.ui.y=20;buildContext(w,{includePlans:false});
  assert.equal(isExplored(w,w.ui),false);
  const c=addCreature(w,-36,-24);assert.ok(isExplored(w,c));
  Object.assign(c,{x:-60,y:-24});revealColony(w);
  assert.ok(isExplored(w,c));assert.ok(isExplored(w,{x:-36,y:-24}));
});
test("exploration survives exact history rewind, export and normalization",()=>{
  const w=createWorld({empty:true});
  const before=migrateWorld(w), timeline=appendTimeline(null,null,before);
  reveal(w,{x:160,y:-80});const after=migrateWorld(w);
  const history=appendTimeline(timeline,before,after),branch=history.branches[0];
  assert.equal(isExplored(readMoment(branch,branch.base.id),{x:160,y:-80}),false);
  assert.ok(isExplored(readMoment(branch,branch.frames.at(-1).id),{x:160,y:-80}));
  assert.deepEqual(migrateWorld(after).discovery,after.discovery);
  assert.throws(()=>migrateWorld({...after,discovery:{...after.discovery,regions:{'0:0':Infinity}}}),/map is damaged/);
});
test("legacy migration keeps settlements and retained scout destinations visible",()=>{
  const w=createWorld({empty:true});delete w.discovery;
  addObject(w,"dwelling",-80,0);w.community.visited=["20:20"];
  const saved=migrateWorld(w);
  assert.ok(isExplored(saved,{x:-80,y:0}));assert.ok(isExplored(saved,{x:164,y:164}));
  assert.ok(isExplored(saved,{x:58,y:40}));assert.equal(isExplored(saved,{x:500,y:500}),false);
});
test("unbounded exploration compacts resolution without forgetting earlier discoveries",()=>{
  const w=createWorld({empty:true}),points=[];
  for(let i=0;i<3000;i++) { const p={x:i*16-24000,y:(i%17)*32};points.push(p);reveal(w,p,4); }
  assert.ok(Object.keys(w.discovery.regions).length<=DISCOVERY_LIMIT);
  assert.ok(w.discovery.cell>4);
  assert.ok(points.every(p=>isExplored(w,p)));
  assert.ok(JSON.stringify(w.discovery).length<100000);
  assert.deepEqual(migrateWorld(w).discovery,w.discovery);
});
test("hidden resources never appear in model objects or viewport samples",()=>{
  const w=createWorld({empty:true});addObject(w,"node",200,200,{stock:1000});
  w.ui.x=w.ui.y=200;
  const context=buildContext(w,{includePlans:false}).context;
  assert.equal(context.terrain.area,"unexplored");assert.equal(context.objects.length,0);
  assert.equal(context.objectCounts.node,undefined);
  assert.equal(context.terrain.discovery.area,discoverySummary(w).area);
});
test("remote homes and facilities beyond the unfinished river cannot conceal local care shortages",()=>{
  const w=settlementWorld("bath");addObject(w,"dwelling",51,24);addObject(w,"bath",49,24);
  const care=careContext(w);
  assert.equal(care.wash.unserved,24);assert.equal(care.wash.short,24);
  assert.ok(settlementChoices(w).some(c=>c.id==="bath"));
  const input=settlementDecisionInput(w,settlementChoices(w));
  assert.match(input.requiredContext,/wash: 0 low, 24 short, 0 urgent/);
});
test("live demand detects extra food and wash capacity despite nonzero facility counts",()=>{
  const w=settlementWorld("none");
  w.objects=w.objects.filter(o=>!['orchard','bath'].includes(o.type));
  addObject(w,"orchard",16,20,{stock:0});addObject(w,"bath",20,16);
  for(const c of w.creatures){c.fed=38;c.clean=40;}
  const choices=settlementChoices(w),input=settlementDecisionInput(w,choices);
  assert.ok(choices.some(c=>c.id==="orchard"&&c.priority>=80));
  assert.ok(choices.some(c=>c.id==="bath"&&c.priority>=80));
  assert.match(input.requiredContext,/food: 24 low/);assert.match(input.requiredContext,/wash: 24 low/);
  const full=buildContext(w).context;full.development=settlementContext(w,choices);
  const packed=packHostedContext(full,4000).context;
  assert.equal(packed.care.food.stock,0);
  assert.equal(packed.care.wash.low,24);
  assert.ok(packed.development.choices.find(c=>c.id==="bath").at);
});
test("schedule cache identity changes with food stock, available projects and care demand",()=>{
  const w=settlementWorld("none"),before=buildContext(w).key;
  for(const o of w.objects.filter(o=>o.type==="orchard"))o.stock=0;
  assert.notEqual(buildContext(w).key,before);
  const prior=buildContext(w).key;
  w.community.project={id:1,type:"bath",x:15,y:15,crew:[],progress:0,required:32};
  assert.notEqual(buildContext(w).key,prior);
});
test("a delayed project is rejected when the player has already fixed the shortage",async()=>{
  const {decideSettlement,brainStatus,stopBrain}=await import("../src/brain.js");
  const original=globalThis.fetch;
  try {
    const w=settlementWorld("bath");w.settings.provider="jev";brainStatus.ready=true;
    let resolve,started;const requested=new Promise(r=>started=r);
    globalThis.fetch=()=>{started();return new Promise(r=>resolve=r);};
    const pending=decideSettlement(w,"fixture-only");
    await requested;
    for(const [x,y] of [[20,16],[24,16],[28,16]])addObject(w,"bath",x,y);
    resolve({ok:true,json:async()=>({answers:{decision:{type:"choice",choice:"bath"}}})});
    assert.equal(await pending,null);
    assert.ok(w.community.activity.some(a=>a.kind==="replan"));
  } finally {globalThis.fetch=original;stopBrain();}
});
test("new urgent care invalidates an unrelated industrial choice",()=>{
  const w=developmentWorld();w.inventory.blocks=w.progress.peakBlocks=1000;
  const choice=settlementChoices(w).find(c=>c.id==="factory");assert.ok(choice);
  w.objects=w.objects.filter(o=>o.type!=="bath");
  for(const c of w.creatures)c.clean=20;
  assert.equal(currentSettlementChoice(w,choice),null);
});
test("a home remains a valid answer to a food or washing shortage",()=>{
  const w=developmentWorld();w.inventory.blocks=w.progress.peakBlocks=1000;
  w.objects=w.objects.filter(o=>o.type!=="bath");
  for(const c of w.creatures)c.clean=40;
  const home=settlementChoices(w).find(c=>c.id==="dwelling");
  assert.ok(home);assert.ok(currentSettlementChoice(w,home));
  assert.ok(settlementDecisionChoices(w).every(c=>["bath","dwelling"].includes(c.id)));
});
