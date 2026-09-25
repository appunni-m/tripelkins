import test from "node:test";
import assert from "node:assert/strict";
import { createWorld, addCreature, addObject, random, migrateWorld } from "../src/game/state.js";
import { makePlan, applyPlan, stepWorld } from "../src/game/simulation.js";
import { clearPosition, walkableSurface, hitsFootprint, BODY_RADIUS } from "../src/game/geometry.js";
import { lineClear, routeCost, waypoint, withRouteCosts, navigationMemory } from "../src/game/navigation.js";
import { toolSignature, htmlIfChanged } from "../src/ui-budget.js";
import { scaleFixture, groundFixture } from "../src/game/scale-fixture.js";
import { copyOccupancy, NAV_CELL } from "../src/game/navigation-grid.js";
import { naturalObjects } from "../src/game/map.js";
import { buildContext } from "../src/game/context.js";
import { backgroundBudget } from "../src/background-budget.js";
import { meterGpuBuffers } from "../src/laya/gpu-meter.js";
import { stepCohorts, syncPopulation, MAX_POPULATION } from "../src/game/population.js";

test("shared navigation tiles preserve every sampled grid cell and stay bounded",()=>{
  const w=createWorld();
  addObject(w,"mountain",-10,-8);
  w.community.project={id:1,type:"factory",x:-14,y:5};w.navRevision++;
  const tiles=new Map(), width=112;
  for(const [left,top] of [[-90,-87],[-56,-56],[-11,2],[40,-33],[90,72]]) {
    const grid=new Uint8Array(width*width), ox=left*NAV_CELL,oy=top*NAV_CELL;
    copyOccupancy(w,tiles,grid,width,left,top);
    const objects=[...w.objects,w.community.project,...naturalObjects(w,ox-4,oy-4,ox+width*NAV_CELL+4,oy+width*NAV_CELL+4)];
    for(let y=0;y<width;y++)for(let x=0;x<width;x++) {
      const px=ox+x*NAV_CELL,py=oy+y*NAV_CELL;
      const blocked=!walkableSurface(w,px,py)||objects.some(o=>hitsFootprint(px,py,BODY_RADIUS+.03,o));
      assert.equal(grid[y*width+x],Number(blocked),`${px},${py}`);
    }
  }
  for(let i=0;i<140;i++) copyOccupancy(w,tiles,new Uint8Array(1),1,i*32,300);
  assert.ok(tiles.size<=128);
});

test("spread workload measures 300 real residents with legal starts and useful work",()=>{
  const w=groundFixture(300), before=w.metrics.completed;
  assert.equal(w.creatures.length,300);assert.equal(w.orbital.population,0);
  assert.ok(w.creatures.every(c=>clearPosition(w,c)));
  assert.ok(Math.max(...w.creatures.map(c=>c.x))-Math.min(...w.creatures.map(c=>c.x))>80);
  assert.ok(Math.max(...w.creatures.map(c=>c.y))-Math.min(...w.creatures.map(c=>c.y))>60);
  for(let i=0;i<120;i++)stepWorld(w,.1);
  assert.equal(w.creatures.length,300);assert.ok(w.metrics.completed>before);
  assert.ok(navigationMemory(w).bytes<5e6);
});

test("legal narrow gaps reconnect to navigation without crossing tree footprints", () => {
  const w=createWorld({empty:true});
  addObject(w,"tree",58.29046522979626,19.97269456870854);
  addObject(w,"tree",58.47649030354807,21.658581295609476);
  const c={x:58.41374572547808,y:20.734552870770163}, goal={x:52.8,y:34.6};
  assert.equal(clearPosition(w,c),true);
  const next=waypoint(w,c,goal);
  assert.ok(next);
  assert.equal(lineClear(w,c,next,w.objects),true);
  assert.ok(Number.isFinite(routeCost(w,c,goal)));
});

test("district and orbit share the final birth capacity without hidden extra people", () => {
  const w=createWorld({empty:true});w.stage=2;
  addObject(w,"dwelling",20,20);addCreature(w,16,20);
  w.cohort=40;w.district.fraction=.9999;
  w.orbital.population=MAX_POPULATION-w.creatures.length-w.cohort-1;
  syncPopulation(w);stepCohorts(w,.1);
  assert.equal(w.population,MAX_POPULATION);
  assert.equal(w.population,w.creatures.length+w.cohort+w.orbital.population);
  assert.equal(addCreature(w,12,12),null);
  w.orbital.population+=10;
  const restored=migrateWorld(w);
  assert.equal(restored.population,restored.creatures.length+restored.cohort+restored.orbital.population);
  assert.equal(restored.population,MAX_POPULATION);
});

test("diagnostic GPU meter counts buffers without retaining them or double-subtracting", () => {
  const device={createBuffer:()=>({destroy(){}})}, sample=meterGpuBuffers(device);
  const a=device.createBuffer({size:100}), b=device.createBuffer({size:200});
  a.destroy();a.destroy();assert.equal(sample().liveBytes,200);
  b.destroy();assert.equal(sample().liveBytes,0);
  assert.equal(sample().peakBytes,300);assert.equal(sample().createdBuffers,2);
});

test("background model release is delayed, cancelled on quick returns and wakes once", () => {
  let callback, released=0, resumed=0, cancelled=0;
  const budget=backgroundBudget({release:()=>released++,resume:()=>resumed++,
    schedule:fn=>{callback=fn;return 1;},cancel:()=>{callback=null;cancelled++;}});
  budget.hidden(true);budget.hidden(false);
  assert.equal(callback,null);assert.equal(released,0);assert.equal(cancelled,1);
  budget.hidden(true);callback();assert.equal(released,1);
  budget.hidden(true);budget.hidden(false);budget.hidden(false);
  assert.equal(resumed,1);
  budget.hidden(true);budget.dispose();assert.equal(callback,null);
});

test("segment broad phase preserves the original sampled collision decisions", () => {
  const w = createWorld();
  function reference(a, b) {
    const d = Math.hypot(b.x-a.x,b.y-a.y);
    for (let step=0; step<=Math.ceil(d/0.3); step++) {
      const t=step/Math.max(1,Math.ceil(d/0.3)), x=a.x+(b.x-a.x)*t, y=a.y+(b.y-a.y)*t;
      if (!walkableSurface(w,x,y) || w.objects.some(o=>hitsFootprint(x,y,BODY_RADIUS,o))) return false;
    }
    return true;
  }
  for (let i=0;i<3000;i++) {
    const a={x:random(w)*70-3,y:random(w)*54-3}, b={x:random(w)*70-3,y:random(w)*54-3};
    if (i%5===0) b.x=a.x;
    if (i%7===0) b.y=a.y;
    assert.equal(lineClear(w,a,b,w.objects),reference(a,b));
  }
});

test("route reuse ends with the planning operation and respects later topology", () => {
  const w=createWorld({empty:true}), a={x:12,y:12},b={x:16,y:12};
  const before=routeCost(w,a,b);
  withRouteCosts(w,()=>{assert.equal(routeCost(w,a,b),before);assert.equal(routeCost(w,a,b),before);});
  addObject(w,"rock",16,12);
  assert.notEqual(routeCost(w,a,b),before);
  assert.equal(withRouteCosts(w,()=>routeCost(w,a,b)),routeCost(w,a,b));
});

test("one trapped idle creature cannot reject the rest of the colony's jobs", () => {
  const w=createWorld({empty:true}); w.progress.hatched=true;
  const trapped=addCreature(w,12,12), worker=addCreature(w,22,22);
  addObject(w,"rock",12,12); addObject(w,"banana",24,22,{stock:8});
  trapped.fed=worker.fed=20;
  assert.equal(clearPosition(w,trapped),false);
  const p=makePlan(w);
  assert.equal(p.assignments.find(a=>a.id===trapped.id).task,"idle");
  assert.equal(applyPlan(w,p),true);
  for(let i=0;i<100;i++)stepWorld(w,.1);
  assert.ok(worker.fed>20);
  assert.ok(w.metrics.completed>0);
});

test("toolbar and HTML only change when their actual displayed content changes", () => {
  const w=createWorld({empty:true}); w.population=1e13;
  const signature=toolSignature(w);w.population++;assert.equal(toolSignature(w),signature);
  w.population=1;assert.notEqual(toolSignature(w),signature);
  let writes=0;const element={set innerHTML(html){writes++;}};
  assert.equal(htmlIfChanged(element,"ready"),true);
  assert.equal(htmlIfChanged(element,"ready"),false);
  assert.equal(writes,1);
});

test("million and billion populations retain bounded records, real work and exact save totals", () => {
  for(const population of [1e6,1e9]) {
    const w=scaleFixture(population), before=w.metrics.completed;
    assert.ok(Math.max(...w.creatures.map(c=>c.x))-Math.min(...w.creatures.map(c=>c.x))>=60);
    assert.ok(Math.max(...w.creatures.map(c=>c.y))-Math.min(...w.creatures.map(c=>c.y))>=30);
    assert.ok(w.creatures.every(c=>clearPosition(w,c)));
    assert.ok(w.creatures.every((c,i)=>w.creatures.slice(i+1).every(other=>
      Math.hypot(c.x-other.x,c.y-other.y)>=BODY_RADIUS*2+0.06)));
    const orbitalBefore=w.orbital.population, launchesBefore=w.orbital.launches;
    for(let i=0;i<300;i++)stepWorld(w,.1);
    assert.ok(w.metrics.completed>before);
    assert.ok(w.population>=population);
    assert.equal(w.orbital.population-orbitalBefore,w.orbital.launches-launchesBefore);
    assert.equal(w.population,w.creatures.length+w.cohort+w.orbital.population);
    assert.ok(w.creatures.length<=192);
    assert.ok(navigationMemory(w).bytes<5e6);
    const context=buildContext(w).context, saved=migrateWorld(w);
    assert.equal(saved.population,w.population);
    assert.equal(saved.orbital.population,w.orbital.population);
    assert.ok(JSON.stringify(saved).length<2e6);
    assert.ok(context.groups.flatMap(g=>g.members).length<=192);
    assert.ok(JSON.stringify(context).length<250000);
  }
});
