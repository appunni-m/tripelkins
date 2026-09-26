import test from 'node:test';
import assert from 'node:assert/strict';
import { groundFixture } from '../src/game/scale-fixture.js';
import { developmentWorld } from '../src/game/settlement-evaluation.js';
import { createWorld, addCreature, addObject, migrateWorld } from '../src/game/state.js';
import { settlementChoices, settlementDecisionChoices, settlementDecisionInput, startSettlement, currentSettlementChoice } from '../src/game/settlement.js';
import { workProjects, workerProject, projectLimit } from '../src/game/work-projects.js';
import { uncommittedBlocks, projectFunded } from '../src/game/development.js';
import { applyPlan, makePlan, stepWorld, interact } from '../src/game/simulation.js';
import { setIndependence } from '../src/game/community.js';
import { bridgeGeometry, clearPosition } from '../src/game/geometry.js';
import { reveal } from '../src/game/discovery.js';
import { buildContext } from '../src/game/context.js';
import { packHostedContext } from '../src/game/context-budget.js';
import { appendTimeline, readMoment } from '../src/game/timeline.js';

function begin(w,kind='refine') {
  const choice=settlementDecisionChoices(w).find(c=>c.id===kind);
  assert.ok(choice,`No ${kind} choice`);
  assert.equal(startSettlement(w,choice,'Fixture intelligence'),true);
  return choice;
}

test('one selected resource goal creates distinct local crews across a large colony',()=>{
  const w=groundFixture(300), offered=settlementDecisionChoices(w).find(c=>c.id==='refine');
  assert.equal(offered.camps.length,3);
  assert.match(settlementDecisionInput(w,[offered]).options.refine,/3 local crews/);
  begin(w);
  const projects=workProjects(w), assigned=projects.flatMap(p=>p.crew);
  assert.equal(projects.length,3);assert.ok(projects.length<=projectLimit(w));
  assert.equal(new Set(assigned).size,assigned.length);assert.ok(assigned.length>20);
  for(const p of projects) for(const id of p.crew) {
    const c=w.creatures.find(c=>c.id===id);
    assert.equal(workerProject(w,c),p);
    assert.ok(Math.hypot(c.x-p.x,c.y-p.y)<=32);
  }
  assert.equal(applyPlan(w,makePlan(w)),true);
  assert.ok(new Set(w.creatures.filter(c=>c.task==='quarry').map(c=>workerProject(w,c).id)).size>1);
  assert.equal(currentSettlementChoice(w,offered),null,'an already claimed site cannot silently move elsewhere');
});

test('ore reservations allow refining and quarrying together without inventing input',()=>{
  const w=developmentWorld();w.runtime.growth={held:true};begin(w);
  w.inventory.ore=1;
  const plan=makePlan(w);
  assert.equal(plan.assignments.filter(a=>a.task==='refine').length,1);
  assert.ok(plan.assignments.some(a=>a.task==='quarry'));
  const before={...w.inventory};assert.equal(applyPlan(w,plan),true);
  assert.deepEqual(w.inventory,before,'a reservation is not production or spending');
  // Enough loose input stops new quarrying, while physical hauling continues.
  for(const c of w.creatures){c.task='idle';c.job=null;c.target=null;}
  addObject(w,'ore',25,28,{stock:30});
  const supplied=makePlan(w);
  assert.equal(supplied.assignments.some(a=>a.task==='quarry'),false);
  assert.ok(supplied.assignments.some(a=>a.task==='haul'));
  assert.ok(makePlan(w,'industry').assignments.some(a=>a.task==='haul'),
    'refining crews collect their loose input even under an industrial schedule');
});

test('an explicit block goal physically collects loose ore and finishes its last batch',()=>{
  const w=developmentWorld('refine');w.runtime.growth={held:true};w.inventory.wood=24;
  w.memory.goals=[{id:'blocks',kind:'blocks',target:300,status:'active',command:'Make 300 blocks',createdAt:0,reviews:[]}];
  begin(w);
  for(let i=0;i<1800&&!w.community.completed;i++)stepWorld(w,.1);
  assert.equal(w.community.completed,1);
  assert.equal(w.inventory.blocks,300);
  assert.ok(w.memory.activity.quarry>0 && w.memory.activity.refine===30);
  assert.equal(w.evidence.deaths,0);
});

test('local crews and their individual jobs survive snapshots and revoke together',()=>{
  const w=groundFixture(120);begin(w);w.inventory.ore=30;
  assert.equal(applyPlan(w,makePlan(w)),true);
  const projects=structuredClone(workProjects(w));assert.ok(projects.length>1);
  const saved=migrateWorld(w), timeline=appendTimeline(null,null,saved), branch=timeline.branches[0];
  const restored=readMoment(branch,branch.base.id);
  assert.deepEqual(workProjects(restored),workProjects(saved));
  assert.deepEqual(workProjects(saved).map(p=>[p.id,p.crew]),projects.map(p=>[p.id,p.crew]));
  assert.deepEqual(migrateWorld(saved).community,saved.community);
  const ore=restored.inventory.ore;
  for(let i=0;i<20;i++)stepWorld(restored,.1);
  assert.equal(restored.inventory.ore,ore,'restored work waits for intelligence');
  setIndependence(saved,false);assert.equal(workProjects(saved).length,0);
  assert.ok(makePlan(saved).assignments.every(a=>!['refine','quarry','gather','construct'].includes(a.task)));
});

test('destroying one camp preserves other projects and promotes a surviving primary',()=>{
  const w=groundFixture(120);begin(w);
  const [first,...others]=workProjects(w);assert.ok(others.length>0);
  interact(w,'meteor',first.x,first.y,null);
  assert.deepEqual(workProjects(w).map(p=>p.id),others.map(p=>p.id));
  assert.equal(w.community.project.id,others[0].id);
});

test('parallel building admissions reserve block budgets until actual completion',()=>{
  const w=developmentWorld();w.inventory.blocks=w.progress.peakBlocks=300;
  const factory=settlementChoices(w).find(c=>c.id==='factory');assert.ok(factory);
  w.inventory.blocks=150;
  assert.equal(startSettlement(w,factory,'Fixture intelligence'),true);
  assert.equal(w.inventory.blocks,150,'construction still pays at completion');
  assert.equal(uncommittedBlocks(w),0);
  w.time+=31;
  assert.ok(settlementChoices(w).every(c=>!['mine','factory','dwelling','theatre'].includes(c.id)));
});

test('both intelligence contexts describe concurrent crews within the existing budget',()=>{
  const w=groundFixture(120);begin(w);
  const snapshot=buildContext(w), packed=packHostedContext(snapshot.context,16000);
  assert.equal(snapshot.context.workload.crews,workProjects(w).length);
  assert.equal(packed.context.independence.crews.length,workProjects(w).length);
  assert.ok(packed.bytes<=16000);
  assert.match(snapshot.localParts.join(' '),/local crews/);
});

test('a distant bridge detour retains the job and finishes mining without a false stall',()=>{
  const w=createWorld({empty:true});w.progress.hatched=w.progress.bridge=true;w.stage=2;
  const bridge=addObject(w,'bridge',42,25);
  bridge.bridge={...bridgeGeometry(bridge),complete:true};bridge.stock=24;
  const c=addCreature(w,25,-55);c.fed=c.clean=c.amused=95;
  const mine=addObject(w,'mine',55,-55,{stock:60});reveal(w,mine,10);
  w.runtime={intelligenceAvailable:true,growth:{held:true}};
  w.community.consent='accepted';w.memory.lastPlan={policy:'mine'};
  const plan=makePlan(w,'mine');assert.equal(plan.assignments[0].task,'mine');
  assert.ok(plan.assignments[0].cost>160,'the estimated journey includes the bridge');
  assert.equal(applyPlan(w,plan),true);
  let beyondLocalSearch=false;
  for(let i=0;i<1800&&!w.memory.activity.mine;i++) {
    stepWorld(w,.1);assert.ok(clearPosition(w,c),'feet stay on legal ground');
    if(Math.hypot(c.x-mine.x,c.y-mine.y)>64){beyondLocalSearch=true;assert.equal(c.task,'mine');}
  }
  assert.ok(beyondLocalSearch);
  assert.equal(w.memory.activity.mine,1);assert.equal(w.inventory.ore,3);
  assert.equal(mine.stock,57);assert.equal(w.metrics.stalls,0);
});

test('the next story objective keeps production and expansion materials in model context',()=>{
  const w=groundFixture(120);w.progress.peakBlocks=300;w.inventory.blocks=300;
  const choices=settlementDecisionChoices(w);
  assert.ok(choices.some(c=>['mine','factory'].includes(c.id)));
  const snapshot=buildContext(w);
  assert.equal(snapshot.context.currentMilestone.kind,'energy');
  assert.match(snapshot.localParts[0],/produce energy/);
  assert.match(settlementDecisionInput(w,choices).requiredContext,/build stocked mines and stone workshops/);
  assert.equal(packHostedContext(snapshot.context,16000).context.currentMilestone.target,1500000);
  addObject(w,'factory',-40,-25,{inputOre:0});w.inventory.blocks=25;
  assert.ok(settlementChoices(w).some(c=>c.id==='refine'&&c.target>=300),'new workplaces still get a material supply project');
  w.memory.goals=[{id:'player',kind:'ore',target:40,status:'active'}];
  assert.equal(buildContext(w).context.currentMilestone,null,'a player instruction takes precedence');
  assert.equal(settlementChoices(w).some(c=>c.id==='refine'),false);
});

test('material progress can trigger development before the old full-interval gate',()=>{
  const w=groundFixture(120);
  // The fourth camp needs a discovered input source; unseen stone must not be
  // treated as available merely to make a development option appear.
  const rock=addObject(w,'rock',70,-25);reveal(w,rock,8);
  w.memory.goals=[{id:'large',kind:'blocks',target:3000,status:'active'}];begin(w);w.time=11;
  assert.ok(settlementChoices(w).length>0,'medium event-driven review can assign another free local group after ten seconds');
});


test('later small buildings cannot spend the wood an older workshop is gathering',()=>{
  const w=groundFixture(120);w.inventory.blocks=500;w.progress.peakBlocks=500;
  const factory={id:1,type:'factory',x:-40,y:-25,crew:[w.creatures[0].id],required:32,progress:0,target:24};
  const mine={id:2,type:'mine',x:5,y:-25,crew:[w.creatures[30].id],required:32,progress:0,target:24};
  w.community.project=factory;w.community.projects=[mine];
  w.inventory.wood=12;
  assert.equal(projectFunded(w,factory),false);assert.equal(projectFunded(w,mine),false);
  w.inventory.wood=24;
  assert.equal(projectFunded(w,factory),true);assert.equal(projectFunded(w,mine),false);
  w.inventory.wood=36;assert.equal(projectFunded(w,mine),true);
});

test('enough assigned workers suppress duplicate crews for the same resource goal',()=>{
  const w=groundFixture(300);begin(w);w.time=31;
  assert.ok(workProjects(w).reduce((n,p)=>n+p.crew.length,0)>=30);
  assert.equal(settlementChoices(w).some(c=>c.id==='refine'),false);
});

test('Jev receives the listed local camps and its single choice starts those crews',async()=>{
  const {decideSettlement,brainStatus,stopBrain}=await import('../src/brain.js');
  const original=globalThis.fetch;
  try {
    const w=groundFixture(300);w.settings.provider='jev';brainStatus.ready=true;
    let body;
    globalThis.fetch=async(_url,init)=>{body=JSON.parse(init.body);return {ok:true,json:async()=>({answers:{decision:{type:'choice',choice:'refine'}}})};};
    const decision=await decideSettlement(w,'fixture-only');
    assert.equal(body.state.development.choices.find(c=>c.id==='refine').camps.length,3);
    assert.ok(body.questions.decision.criteria.refine.includes('local crews'));
    assert.equal(decision.choice.camps.length,3);
    assert.equal(startSettlement(w,decision.choice,decision.source),true);
    assert.equal(workProjects(w).length,3);
  } finally {globalThis.fetch=original;stopBrain();}
});
