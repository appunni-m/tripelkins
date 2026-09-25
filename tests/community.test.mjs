import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, addCreature, addObject, migrateWorld } from '../src/game/state.js';
import { makePlan, applyPlan, stepWorld, placeBuilding } from '../src/game/simulation.js';
import { offerIndependence, setIndependence, postMessage, nextNotice, visitFrontier, activity } from '../src/game/community.js';
import { collectStoryMessages, answerStory } from '../src/game/story.js';
import { settlementChoices, startSettlement, finishSettlement } from '../src/game/settlement.js';
import { createTalkGesture } from '../src/talk-gesture.js';
import { buildContext } from '../src/game/context.js';
import { packHostedContext, utf8Size } from '../src/game/context-budget.js';

function colony() {
  const w = createWorld({empty:true});
  w.progress.hatched=true;
  for(let i=0;i<24;i++) { const c=addCreature(w,19+(i%6)*1.2,18+Math.floor(i/6)*1.2);c.fed=c.clean=c.amused=90; }
  w.runtime={intelligenceAvailable:true};
  return w;
}
test('quick tap starts and second tap sends, while a hold sends on release',()=>{
  let recording=false,time=0,starts=0,finishes=0;
  const gesture=createTalkGesture({now:()=>time,active:()=>recording,start:()=>{recording=true;starts++;},finish:()=>{recording=false;finishes++;}});
  gesture.down();time=60;gesture.up();assert.equal(recording,true);assert.equal(finishes,0);
  gesture.down();time+=50;gesture.up();assert.equal(recording,false);assert.equal(finishes,1);
  gesture.down();time+=500;gesture.up();assert.equal(finishes,2);assert.equal(starts,2);
  gesture.down();gesture.cancel();gesture.up();assert.equal(finishes,2);
});
test('independence is offered once above twenty; consent and intelligence both gate construction',()=>{
  const w=colony(); w.population=20;offerIndependence(w);assert.equal(w.community.consent,'unasked');
  w.population=24;offerIndependence(w);offerIndependence(w);assert.equal(w.community.inbox.length,1);
  assert.equal(settlementChoices(w).length,0);
  setIndependence(w,true);assert.ok(settlementChoices(w).length>0);
  w.runtime.intelligenceAvailable=false;assert.equal(settlementChoices(w).length,0);
  w.runtime.intelligenceAvailable=true;w.directives.pauseWork=true;assert.equal(settlementChoices(w).length,0);
  setIndependence(w,false);offerIndependence(w);assert.equal(w.community.consent,'declined');
});
test('care project consumes exact timber once, and progress and permission survive restore',()=>{
  let w=colony();setIndependence(w,true);
  const choice=settlementChoices(w).find((c)=>c.id==='orchard');assert.ok(choice);
  const wood=w.inventory.wood;assert.equal(startSettlement(w,choice,'Test model'),true);
  w.community.project.progress=12;
  w=migrateWorld(w);assert.equal(w.community.project.progress,12);assert.equal(w.community.consent,'accepted');
  assert.equal(w.runtime,undefined);w.community.project.progress=32;
  finishSettlement(w,placeBuilding);assert.equal(w.objects.filter((o)=>o.type==='orchard').length,0);
  w.runtime={intelligenceAvailable:true};finishSettlement(w,placeBuilding);
  assert.equal(w.objects.filter((o)=>o.type==='orchard').length,1);assert.equal(w.inventory.wood,wood-10);
  finishSettlement(w,placeBuilding);assert.equal(w.inventory.wood,wood-10);assert.equal(w.community.completed,1);
});
test('builders physically gather timber and finish a facility; urgent care interrupts',()=>{
  const w=colony();setIndependence(w,true);w.inventory.wood=0;
  addObject(w,'tree',16,19);addObject(w,'tree',16,23);addObject(w,'tree',16,27);
  addObject(w,'orchard',26,26,{stock:12});addObject(w,'bath',29,18);addObject(w,'roundabout',23,29);
  const choice=settlementChoices(w).find((c)=>c.id==='orchard');assert.ok(choice);
  assert.equal(startSettlement(w,choice,'Test model'),true);
  assert.ok(makePlan(w).assignments.some((a)=>a.task==='gather'));
  const worker=w.creatures.find((c)=>c.id===w.community.project.crew[0]);worker.fed=10;
  assert.notEqual(makePlan(w).assignments.find((a)=>a.id===worker.id).task,'gather');worker.fed=90;
  for(let i=0;i<1600 && w.community.project;i++)stepWorld(w,.1);
  assert.equal(w.community.completed,1,JSON.stringify({p:w.community.project,wood:w.inventory.wood,jobs:w.creatures.map(c=>[c.task,c.job?.state])}));
  assert.ok(w.progress.chopped>=2);assert.ok(w.memory.activity.gather>0);assert.ok(w.inventory.wood>=0);
});
test('no construction work proceeds after consent or intelligence is removed',()=>{
  const w=colony();setIndependence(w,true);startSettlement(w,settlementChoices(w)[0],'Test model');
  assert.equal(applyPlan(w,makePlan(w)),true);
  w.runtime.intelligenceAvailable=false;
  for(let i=0;i<30;i++)stepWorld(w,.1);
  assert.equal(w.community.project.progress,0);
  assert.ok(w.creatures.every((c)=>!['construct','gather'].includes(c.task)));
  setIndependence(w,false);assert.equal(w.community.project,null);
});
test('healthy scouts use open ground after landmarks are exhausted and resting stays local',()=>{
  const w=colony();addObject(w,'orchard',24,25,{stock:12});
  const c=w.creatures[3];c.traits.curiosity=1;
  const plan=makePlan(w);const scouts=plan.assignments.filter((a)=>a.task==='explore');
  assert.ok(scouts.some((a)=>!a.target));assert.ok(scouts.length<=3);
  assert.ok(scouts.some((a)=>Math.hypot(a.point.x-24,a.point.y-25)>15));
  const distant=colony();distant.creatures=distant.creatures.slice(0,1);distant.population=1;
  Object.assign(distant.creatures[0],{x:10,y:5,birthOrdinal:0});
  const rest=makePlan(distant).assignments[0];assert.equal(rest.task,'rest');
  assert.ok(Math.hypot(rest.point.x-10,rest.point.y-5)<4);
});
test('notifications auto-queue without answering choices or replaying a milestone backlog',()=>{
  const w=colony();w.story.queue=['awakening','incident-hunger','first-child'];
  collectStoryMessages(w);assert.equal(w.story.active,null);assert.equal(w.community.inbox.length,3);
  assert.equal(w.story.responses.length,0);
  assert.ok(nextNotice(w));assert.equal(nextNotice(w),null);
  w.time+=60;assert.equal(nextNotice(w),null);
  w.story.active='incident-hunger';answerStory(w,'Not now');assert.ok(w.story.refusals.includes('orchard'));
});
test('inbox, activity, exploration and model context stay bounded and normalize idempotently',()=>{
  const w=colony();
  for(let i=0;i<300;i++){postMessage(w,{text:`Message ${i}`});activity(w,'schedule',`Plan ${i}`);visitFrontier(w,{x:i*8,y:0});}
  assert.equal(w.community.inbox.length,64);assert.equal(w.community.activity.length,40);assert.equal(w.community.visited.length,64);
  const saved=migrateWorld(w);assert.deepEqual(migrateWorld(saved).community,saved.community);
  const context=buildContext(saved).context;assert.equal(context.independence.scouted,300);
  assert.ok(utf8Size(packHostedContext(context,16000).context)<=16000);
});

test('Jev receives bounded, consented construction options; late revoked results are discarded',async()=>{
  const { decideSettlement, brainStatus, stopBrain }=await import('../src/brain.js');
  const originalFetch=globalThis.fetch;
  try {
    const w=colony();setIndependence(w,true);w.settings.provider='jev';brainStatus.ready=true;
    let body;
    globalThis.fetch=async(url,init)=>{body=JSON.parse(init.body);return {ok:true,json:async()=>({answers:{decision:{type:'choice',choice:'orchard'}}})};};
    const result=await decideSettlement(w,'test-only-token');
    assert.equal(result.choice.id,'orchard');assert.equal(body.state.independence.consent,'accepted');
    assert.ok(body.questions.decision.criteria.orchard);assert.ok(body.questions.decision.criteria.wait);
    assert.equal(w.community.project,null,'inference cannot mutate the paused/live world before applying');
    let resolve;globalThis.fetch=()=>new Promise(r=>resolve=r);
    const late=decideSettlement(w,'test-only-token');setIndependence(w,false);
    resolve({ok:true,json:async()=>({answers:{decision:{type:'choice',choice:'orchard'}}})});
    assert.equal(await late,null);
  } finally {globalThis.fetch=originalFetch;stopBrain();}
});

test('new work restrictions interrupt an old building crew and preserve their resources',()=>{
  const w=colony();setIndependence(w,true);startSettlement(w,settlementChoices(w)[0],'Test model');
  applyPlan(w,makePlan(w));const before=w.inventory.wood;
  w.directives.pauseWork=true;
  for(let i=0;i<30;i++)stepWorld(w,.1);
  assert.equal(w.inventory.wood,before);assert.equal(w.community.project.progress,0);
  const plan=makePlan(w);assert.ok(plan.assignments.every(a=>!['gather','construct'].includes(a.task)));
});

test('all care projects complete with a reserved footprint and real gathered wood',async()=>{
  const {settlementWorld}=await import('../src/game/settlement-evaluation.js');
  const {clearPosition}=await import('../src/game/geometry.js');
  for(const type of ['orchard','bath','roundabout']) {
    const w=settlementWorld(type);startSettlement(w,settlementChoices(w).find(c=>c.id===type),'fixture');
    const site={...w.community.project};assert.equal(clearPosition(w,site),false);
    for(let i=0;i<1800&&w.community.project;i++)stepWorld(w,.1);
    assert.equal(w.community.completed,1,`${type}: ${JSON.stringify(w.community.project)}`);
    assert.equal(w.inventory.wood,w.progress.chopped*6-({orchard:10,bath:6,roundabout:12}[type]));
  }
});

test('saved activity keeps exploration, social care and new construction tasks',()=>{
  const w=colony();w.memory.activity={explore:9,social:6,rest:3,clean:2,gather:4,construct:1};
  w.memory.jobs=Object.keys(w.memory.activity).map(task=>({task,unit:w.creatures[0].id,target:'',tick:0}));
  const saved=migrateWorld(w);assert.deepEqual(saved.memory.activity,w.memory.activity);assert.equal(saved.memory.jobs.length,6);
});

test('equivalent live policy labels retain the real model decision source',async()=>{
  const {selectPlan}=await import('../src/game/decisions.js');
  const w=createWorld({empty:true});w.progress.hatched=true;
  const c=addCreature(w,20,20);c.fed=10;c.clean=c.amused=80;addObject(w,'banana',22,20,{stock:2});
  const plan=makePlan(w,'care');
  const result=selectPlan(w,'industry','Laya fixture','',[plan]);
  assert.equal(result.source,'Laya fixture');assert.equal(result.policy,'industry');
  assert.equal(result.plan.assignments[0].task,'eat');
});
