import test from "node:test";
import assert from "node:assert/strict";
import { createWorld, addCreature, addObject, migrateWorld } from "../src/game/state.js";
import { interact, withdrawMaterial, supplyBridge, stepWorld, choose } from "../src/game/simulation.js";
import { scenario } from "../src/game/scenarios.js";
import { bridgeProject } from "../src/game/bridge-project.js";
import { goal, BUILDINGS, unlocked } from "../src/game/catalog.js";
import { routeCost } from "../src/game/navigation.js";
import { buildContext } from "../src/game/context.js";
import { packHostedContext } from "../src/game/context-budget.js";
import { appendTimeline, readMoment } from "../src/game/timeline.js";

test("stored materials can be put down before the Grabber upgrade, including after restore", () => {
  let w = createWorld({empty:true});
  addCreature(w,24,24);
  const before = w.inventory.wood;
  assert.equal(withdrawMaterial(w,"wood"),true);
  w = migrateWorld(w);
  assert.equal(!!w.progress.grabber, false);
  const held = structuredClone(w.ui.held);
  assert.match(interact(w,"grabber",48,24,null).message,/clear patch/);
  assert.deepEqual(w.ui.held,held);
  assert.equal(w.objects.length,0);
  assert.equal(interact(w,"grabber",26,24,null).sound,"care");
  assert.equal(w.ui.held,null);
  const log = w.objects.find((o)=>o.type==="log");
  assert.equal(w.inventory.wood+log.stock,before);
  assert.match(interact(w,"grabber",log.x,log.y,log).message,/Keep growing/);
  assert.ok(w.objects.includes(log));
});

test("first monolith keeps the bridge necessary and the crossing remains the visible objective", () => {
  const w = createWorld({empty:true});
  w.progress.hatched = true;
  for(let i=0;i<4;i++) addCreature(w,24+i,24);
  addObject(w,"bridge",42,25);
  choose(w,"monolith","care");
  assert.equal(w.stage,1);
  assert.equal(w.progress.bridge,false);
  assert.equal(unlocked(w,BUILDINGS.mine),false);
  assert.equal(goal(w)[0],"BUILD THE BRIDGE");
  assert.equal(routeCost(w,w.creatures[0],{x:48,y:25}),Infinity);
});

test("bridge wood is delivered physically, without duplicate spending, across a restored snapshot", () => {
  let w = scenario("bridge");
  w.objects = w.objects.filter((o)=>o.type!=="log");
  for (const c of w.creatures) { c.carry=0;c.cargoKind=null;c.task="idle";c.target=null;c.job=null; }
  const bridge = w.objects.find((o)=>o.type==="bridge");
  w.inventory.wood=24;
  supplyBridge(w,bridge.id);
  assert.equal(w.inventory.wood,0);
  assert.equal(bridge.stock,0,"placing materials must not complete a crossing");
  assert.equal(bridgeProject(w).staged,24);
  const count = w.objects.length;
  supplyBridge(w,bridge.id);
  assert.equal(w.objects.length,count);
  w.ui.paused=false;
  for(let i=0;i<3000&&!w.progress.bridge;i++) {
    stepWorld(w,.1);
    if(i===80) w=migrateWorld(w);
  }
  assert.equal(w.progress.bridge,true);
  assert.equal(bridgeProject(w).wood,24);
  assert.equal(bridgeProject(w).bones,0);
  assert.equal(w.stage,2);
  assert.equal(w.evidence.deaths,0);
  const ledger = w.inventory.wood + bridgeProject(w).delivered +
    w.objects.filter(o=>o.type==="log").reduce((n,o)=>n+o.stock,0) +
    w.creatures.reduce((n,c)=>n+(c.cargoKind==="wood"?c.carry:0),0);
  assert.equal(ledger,24);
  assert.ok(w.community.activity.some((a)=>a.kind==="bridge"));
  assert.equal(w.community.inbox.filter((m)=>m.key===`bridge-complete:${bridge.id}`).length,1);
  assert.ok(Number.isFinite(routeCost(w,{x:37,y:25},{x:48,y:25})));
});

test("bridge context tells both intelligence providers about delivered and staged materials", () => {
  const w=scenario("bridge");
  const {context} = buildContext(w);
  assert.equal(context.bridgeConstruction.required,24);
  assert.equal(context.bridgeConstruction.staged+context.bridgeConstruction.carried+context.bridgeConstruction.delivered,24);
  const packed=packHostedContext(context,16000);
  assert.deepEqual(packed.context.bridgeConstruction,context.bridgeConstruction);
  // The short local prompt is also generated from the same delivery ledger.
  const result=buildContext(w);
  assert.match(JSON.stringify(result),/materials waiting/);
});

test("meteor has a bounded physical impact, keeps cargo and records losses as deliberate", () => {
  const w=createWorld({empty:true});w.progress.hatched=true;
  const a=addCreature(w,24,24), b=addCreature(w,25,24),
    c=addCreature(w,29,24),d=addCreature(w,30,26);
  a.carry=3;a.cargoKind="wood";
  const wood=w.inventory.wood;
  addObject(w,"orchard",24,26,{stock:6});
  const safe=addObject(w,"bath",30,20);
  const result=interact(w,"meteor",24,24,null);
  assert.equal(result.effect.type,"meteor");
  assert.deepEqual(w.creatures.map(c=>c.id),[c.id,d.id]);
  assert.equal(w.population,2);
  assert.equal(w.inventory.wood,wood+3);
  assert.equal(w.evidence.meteor,1);
  assert.equal(w.evidence.meteorDeaths,2);
  assert.equal(w.evidence.neglect,0);
  assert.equal(w.evidence.sacrificed,0);
  assert.equal(w.departed[0].cause,"meteor");
  assert.equal(w.objects.some(o=>o.type==="orchard"),false);
  assert.ok(w.objects.includes(safe));
  assert.equal(w.objects.filter(o=>o.type==="corpse").reduce((n,o)=>n+o.stock,0),2);
  assert.equal(migrateWorld(w).evidence.meteorDeaths,2);
});

test("meteor preserves story landmarks, refuses unreachable land and is not a model action", () => {
  const w=createWorld({empty:true});
  for(let i=0;i<4;i++)addCreature(w,22+i,20);
  const stone=addObject(w,"monolith",35,25);
  const bridge=addObject(w,"bridge",42,25);
  const tree=addObject(w,"tree",35,27);
  const before=w.objects.length;
  assert.match(interact(w,"meteor",48,25,null).message,/reachable/);
  assert.equal(w.objects.length,before);
  assert.equal(w.evidence.meteor,0);
  interact(w,"meteor",35,25,stone);
  assert.ok(w.objects.includes(stone) && w.objects.includes(bridge));
  assert.equal(tree.type,"stump");
  assert.equal(w.progress.bridge,false);
  assert.equal(w.inventory.wood,16,"burned trees are not free timber");
  assert.ok(buildContext(w).context.candidates.every(p=>!JSON.stringify(p).includes('"task":"meteor"')));
});

test("rewinding a meteor restores exactly the earlier colony and destruction evidence", () => {
  const w=createWorld({empty:true});
  for(let i=0;i<4;i++)addCreature(w,24+i,24);
  const before=migrateWorld(w);
  let history=appendTimeline(null,null,before);
  interact(w,"meteor",24,24,null);
  w.time+=1;
  history=appendTimeline(history,before,migrateWorld(w));
  const branch=history.branches[0];
  const restored=readMoment(branch,branch.base.id);
  assert.equal(restored.evidence.meteorDeaths,0);
  assert.equal(restored.population,4);
  assert.equal(restored.creatures[0].fed,before.creatures[0].fed);
  assert.equal(migrateWorld(w).evidence.meteorDeaths,3);
});
