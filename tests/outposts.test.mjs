import test from 'node:test';
import assert from 'node:assert/strict';
import {developmentWorld} from '../src/game/settlement-evaluation.js';
import {addCreature,addObject} from '../src/game/state.js';
import {reveal,revealColony} from '../src/game/discovery.js';
import {makePlan,applyPlan,stepWorld} from '../src/game/simulation.js';
import {settlementChoices,settlementDecisionChoices,settlementDecisionInput,settlementContext,startSettlement,currentSettlementChoice,refiningShortage,refiningOreReserve,deliveryStock} from '../src/game/settlement.js';
import {outpostEconomics,workshopEconomics,outpostCamps,assessOutpost,outpostContext} from '../src/game/outposts.js';
import {buildContext} from '../src/game/context.js';
import {packHostedContext} from '../src/game/context-budget.js';
import {canPlace} from '../src/game/geometry.js';

function refine(w) {
  const choice=settlementChoices(w).find(c=>c.id==='refine');assert.ok(choice);
  assert.ok(startSettlement(w,choice,'Fixture intelligence'));
}
test('unreachable remote ore cannot stop a local crew quarrying',()=>{
  const w=developmentWorld();refine(w);
  const ore=addObject(w,'ore',-180,-180,{stock:300});reveal(w,ore,10);
  assert.equal(refiningShortage(w,w.community.project),30);
  assert.ok(makePlan(w).assignments.some(a=>a.task==='quarry'));
});
test('nearby ore across an unbridged river does not count as available input',()=>{
  const w=developmentWorld();refine(w);
  const ore=addObject(w,'ore',49,23,{stock:300});reveal(w,ore,10);
  assert.equal(refiningShortage(w,w.community.project),30);
  assert.ok(makePlan(w).assignments.some(a=>a.task==='quarry'));
});
test('hand-processing retains inputs while workshops receive only surplus',()=>{
  const w=developmentWorld();refine(w);const factory=addObject(w,'factory',33,20,{inputOre:0});
  w.inventory.ore=refiningOreReserve(w);
  assert.equal(deliveryStock(w,'ore'),0);
  const plan=makePlan(w);assert.ok(plan.assignments.some(a=>a.task==='refine'));
  assert.equal(plan.assignments.some(a=>a.task==='haul'&&a.target===factory.id),false);
  w.inventory.ore+=6;assert.equal(deliveryStock(w,'ore'),6);
  assert.ok(applyPlan(w,makePlan(w)));
});
test('a block crew finishes despite an existing workshop competing for ore',()=>{
  const w=developmentWorld();w.runtime.growth={held:true};w.inventory.wood=24;
  w.memory.goals=[{id:'blocks',kind:'blocks',target:300,status:'active',command:'Make 300 blocks',createdAt:0,reviews:[]}];
  addObject(w,'factory',33,20,{inputOre:0});refine(w);
  addObject(w,'ore',-180,-180,{stock:300});
  for(let i=0;i<1800&&!w.community.completed;i++)stepWorld(w,.1);
  assert.ok(w.inventory.blocks>=300);assert.equal(w.community.completed,1);
  assert.ok(w.memory.activity.quarry>0 && w.memory.activity.refine>0);
  assert.equal(w.evidence.deaths,0);
});
test('mining and industrial policies use spare workers for deliveries and processing',()=>{
  for(const policy of ['mine','industry','build']) {
    const w=developmentWorld();w.inventory.ore=30;
    const factory=addObject(w,'factory',33,20,{inputOre:0});
    addObject(w,'mine',30,30,{stock:300});
    const plan=makePlan(w,policy);
    assert.ok(plan.assignments.some(a=>a.task==='haul'&&a.target===factory.id),policy);
    factory.inputOre=30;
    assert.ok(makePlan(w,policy).assignments.some(a=>a.task==='work'),policy);
  }
});
test('industrial construction balances mines against workshop throughput',()=>{
  const w=developmentWorld();w.inventory.blocks=w.progress.peakBlocks=300;
  addObject(w,'mine',33,16,{stock:1000});addObject(w,'node',34,30,{stock:1000});
  assert.equal(settlementChoices(w).some(c=>c.id==='mine'),false,'bootstrap source waits for its processor');
  assert.ok(settlementChoices(w).some(c=>c.id==='factory'));
  w.inventory.blocks=100;
  assert.ok(settlementChoices(w).find(c=>c.id==='refine')?.priority>=85);
});
test('outpost payoff uses round trips, group size and building effort',()=>{
  const input={workers:12,oldDistance:40,newDistance:8,kind:'food',wood:10,builderDistance:10};
  const result=outpostEconomics(input);
  assert.ok(Math.abs(result.savedSeconds-12*(300*.08/30)*2*32/1.65)<.1);
  assert.ok(result.paybackSeconds<300);
  assert.ok(outpostEconomics({...input,workers:1}).netSeconds<result.netSeconds);
  assert.equal(outpostEconomics({...input,oldDistance:5}).savedSeconds,0);
});
test('ore delivery payoff is bounded by remaining deposit stock',()=>{
  const input={miners:4,stock:1000,oldDistance:45,newDistance:8};
  assert.ok(workshopEconomics(input).paybackSeconds<300);
  assert.ok(workshopEconomics({...input,stock:3}).netSeconds<0);
  assert.equal(workshopEconomics({...input,newDistance:50}).savedSeconds,0);
});
test('a second workshop is proposed beside distant ore workers instead of the old center',()=>{
  const w=developmentWorld();w.inventory.blocks=w.progress.peakBlocks=1000;
  addObject(w,'factory',30,20,{inputOre:0});
  const mine=addObject(w,'mine',-18,20,{stock:1000});
  for(let i=0;i<30;i++){const c=addCreature(w,-15+i%6,20+Math.floor(i/6));c.fed=c.clean=c.amused=85;}
  revealColony(w);
  const choice=settlementChoices(w).find(c=>c.id==='factory');assert.ok(choice);
  assert.ok(Math.hypot(choice.x-mine.x,choice.y-mine.y)<24);
  assert.equal(choice.outpost.purpose,'ore-delivery');assert.ok(choice.outpost.worthwhile);
});
test('workshop travel savings never count the same miners at two deposits',()=>{
  const w=developmentWorld();addObject(w,'factory',30,20,{inputOre:0});
  addObject(w,'mine',-18,20,{stock:1000});addObject(w,'mine',-20,27,{stock:1000});
  for(let i=0;i<4;i++){const c=addCreature(w,-12+i,20);c.fed=c.clean=c.amused=85;}
  revealColony(w);
  const estimate=assessOutpost(w,'factory',{x:-10,y:27},0,{routed:true});
  assert.ok(estimate.workers>0 && estimate.workers<=4);
});
function remoteCamp() {
  const w=developmentWorld();w.inventory.blocks=w.progress.peakBlocks=600;
  const mine=addObject(w,'mine',-17,20,{stock:300});
  for(let i=0;i<12;i++) {
    const c=addCreature(w,-14+i%4,20+Math.floor(i/4));c.fed=c.clean=c.amused=85;
    c.task='mine';c.target=mine.id;c.job={state:'working',point:{x:-14+i%4,y:20+Math.floor(i/4)},started:0,lastProgress:0};
  }
  for(let i=0;i<4;i++){const c=addCreature(w,-12+i,29);c.fed=c.clean=c.amused=85;}
  revealColony(w);return w;
}
test('busy remote workers contribute demand and get reachable local outpost choices',()=>{
  const w=remoteCamp();
  assert.ok(outpostCamps(w).some(c=>c.x<0&&c.workers>=8));
  const options=settlementChoices(w).filter(c=>c.id==='orchard');
  assert.ok(options.some(c=>c.x<0&&c.outpost?.worthwhile),JSON.stringify(options));
  const choice=options.find(c=>c.x<0);
  assert.ok(choice.outpost.workers>=4);assert.ok(choice.outpost.savedSeconds>choice.outpost.buildSeconds || choice.outpost.unserved);
  const input=settlementDecisionInput(w,[choice]);assert.match(input.options.orchard,/travel seconds|remote residents/);
  const snapshot=buildContext(w);snapshot.context.development=settlementContext(w,[choice]);
  const packed=packHostedContext(snapshot.context,16000);
  assert.ok(packed.context.development.choices[0].outpost);assert.ok(packed.bytes<=16000);
  assert.ok(outpostContext(w).length<=6);
});
test('one passing scout does not justify a new outpost',()=>{
  const w=developmentWorld();const c=addCreature(w,-40,20);c.task='explore';reveal(w,c,20);
  assert.equal(assessOutpost(w,'orchard',{x:-38,y:22})?.worthwhile,false);
});
test('a pending local facility prevents duplicate travel-saving claims',()=>{
  const w=remoteCamp();const choices=settlementDecisionChoices(w),choice=choices.find(c=>c.id==='orchard'&&c.x<0);
  assert.ok(choice);assert.ok(startSettlement(w,choice,'Fixture intelligence'));
  const nearby=assessOutpost(w,'orchard',{x:choice.x+2,y:choice.y+2},0,{routed:true});
  assert.equal(nearby.worthwhile,false);
});
test('the remote outpost is physically built using locally cut timber',()=>{
  const w=remoteCamp();w.runtime.growth={held:true};
  for(const p of [{x:-8,y:30},{x:-4,y:30},{x:-8,y:34},{x:-4,y:34}]) {
    if(canPlace(w,'tree',p)){const tree=addObject(w,'tree',p.x,p.y);reveal(w,tree,8);}
  }
  const choice=settlementChoices(w).find(c=>c.id==='orchard'&&c.x<0);assert.ok(choice);
  const before=w.objects.filter(o=>o.type==='orchard').length;
  assert.ok(startSettlement(w,choice,'Fixture intelligence'));
  for(let i=0;i<1800&&!w.community.completed;i++)stepWorld(w,.1);
  assert.equal(w.objects.filter(o=>o.type==='orchard').length,before+1);
  assert.ok(w.progress.chopped>=2);assert.ok(w.memory.activity.gather>0);
  assert.ok(w.objects.some(o=>o.type==='orchard'&&o.x===choice.x&&o.y===choice.y));
  assert.equal(w.evidence.deaths,0);
});
test('an asynchronous outpost decision is rejected after its local group leaves',()=>{
  const w=remoteCamp();const choice=settlementDecisionChoices(w).find(c=>c.id==='orchard'&&c.x<0);assert.ok(choice);
  for(const c of w.creatures.filter(c=>c.x<0))Object.assign(c,{x:24,y:24,task:'rest',target:null,job:null});
  w.time+=6;
  assert.equal(currentSettlementChoice(w,choice),null);
});
