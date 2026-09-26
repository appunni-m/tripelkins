import {spawn,execFileSync}from'node:child_process';import{createInterface}from'node:readline';import{mkdtempSync,writeFileSync,readFileSync,mkdirSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{pathToFileURL}from'node:url';import{SOURCE_REVISION}from'../../scripts/migration/contracts/inventory.mjs';
const root=new URL('../..',import.meta.url).pathname.replace(/\/$/,'');const corpus=JSON.parse(readFileSync(join(root,'engine/tests/planning-inputs.json'),'utf8'));if(corpus.schema!=='tripelkins/planner-diagnostics@1')throw new Error('Invalid planner diagnostic inputs');const oracle=mkdtempSync(join(tmpdir(),'tripelkins-planner-oracle-'));execFileSync('tar',['-xf','-','-C',oracle],{input:execFileSync('git',['archive',SOURCE_REVISION,'src','package.json'],{cwd:root,maxBuffer:8e6})});
const modules={};for(const m of ['scale-fixture','state','scenarios','jobs','decisions','settlement','care-context','outposts','development','development-plan','context','goals','access','density','exploration','commands','geometry','simulation','discovery'])modules[m]=await import(pathToFileURL(join(oracle,`src/game/${m}.js`)));
const argv=process.env.TRIPELKINS_ENGINE_ARGV?JSON.parse(process.env.TRIPELKINS_ENGINE_ARGV):[join(root,'engine/target/release/tripelkins-engine')];const OriginalDate=Date;globalThis.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:['2000-01-01T00:00:00.000Z']));}};const child=spawn(argv[0],argv.slice(1),{cwd:root,stdio:['pipe','pipe','inherit']});const pending=[];createInterface({input:child.stdout}).on('line',s=>pending.shift()?.(JSON.parse(s)));const target=(operation,input={})=>new Promise(r=>{pending.push(r);child.stdin.write(JSON.stringify({operation,input})+'\n');});
const json=x=>JSON.parse(JSON.stringify(x));function diff(a,b,path='$',out=[]){if(['schedulerMs','prepMs'].includes(path.split('.').at(-1)))return out;if(typeof a==='number'&&typeof b==='number'){if(Math.abs(a-b)>1e-8+Math.abs(a)*1e-10)out.push({path,source:a,target:b});return out;}if(a===b)return out;if(a&&b&&typeof a==='object'&&typeof b==='object'&&Array.isArray(a)===Array.isArray(b)){for(const k of new Set([...Object.keys(a),...Object.keys(b)]))diff(a[k],b[k],path+'.'+k,out);return out;}out.push({path,source:a,target:b});return out;}
const results=[];async function check(w,op,input,fn,id,reload=true){if(reload)await target('load',json(w));let reference;try{reference={status:'ok',value:json(fn(w,input))}}catch(e){reference={status:'error',message:e.message}}const rust=await target(op,input);const diffs=diff(reference,rust);if(reference.status==='ok'&&rust.status==='ok'){const snapshot=await target('snapshot',{});diff(json(w),snapshot.value,'$.world',diffs);}results.push({id,operation:op,status:diffs.length?'fail':'pass',diffs:diffs.slice(0,10),totalDiffs:diffs.length});if(diffs.length)console.log(JSON.stringify(results.at(-1)));}
for(const count of (process.argv.includes('--small')?[25]:corpus.populations)){const w=modules['scale-fixture'].groundFixture(count);w.time=10;for(const policy of corpus.policies)await check(structuredClone(w),'planning.makePlan',{policy},w=>modules.jobs.makePlan(w,policy),`ground-${count}-${policy}`);await check(structuredClone(w),'care.context',{},w=>modules['care-context'].careContext(w),`ground-${count}`);await check(structuredClone(w),'outposts.camps',{},w=>modules.outposts.outpostCamps(w),`ground-${count}`);await check(structuredClone(w),'outposts.context',{},w=>modules.outposts.outpostContext(w),`ground-${count}`);await check(structuredClone(w),'development.plan',{},w=>modules['development-plan'].developmentPlan(w),`ground-${count}`);await check(structuredClone(w),'planning.feasiblePlans',{},w=>modules.decisions.feasiblePlans(w),`ground-${count}`);await check(structuredClone(w),'planning.context',{includePlans:false},w=>modules.context.buildContext(w,{includePlans:false}),`ground-${count}-noPlans`);await check(structuredClone(w),'planning.context',{includePlans:true},w=>modules.context.buildContext(w),`ground-${count}-plans`);await check(structuredClone(w),'settlement.choices',{},w=>modules.settlement.settlementChoices(w),`ground-${count}`);await check(structuredClone(w),'settlement.decisionChoices',{},w=>modules.settlement.settlementDecisionChoices(w),`ground-${count}`);}
// Keep both engines alive across scheduling boundaries so route caches, movement,
// resource activity and density buckets are compared as an ordered workflow.
if (!process.argv.includes('--small')) for (const count of corpus.retainedSteps.populations) {
  const world = modules['scale-fixture'].groundFixture(count); world.time = 10;
  await target('load', json(world));
  for (let index = 0; index < corpus.retainedSteps.count; index++) {
    await check(world, 'simulation.stepWorld', {dt: corpus.retainedSteps.dt}, w => {
      modules.simulation.stepWorld(w, corpus.retainedSteps.dt); return null;
    }, `retained-${count}-step-${index}`, false);
  }
  console.log(JSON.stringify({trace:'retained',population:count,elapsed:corpus.retainedSteps.count*corpus.retainedSteps.dt,completed:world.metrics.completed,inventory:world.inventory}));
}
if (!process.argv.includes('--small')) {
  const spec=corpus.longRun, world=modules['scale-fixture'].groundFixture(spec.population);
  world.time=10; modules.goals.addGoal(world,{kind:'wood',target:spec.target},'Build a wood reserve','Laya');
  modules.settlement.startSettlement(world,{id:spec.project,x:world.creatures[0].x,y:world.creatures[0].y,target:spec.target},'Laya');
  await target('load',json(world));
  for(let index=0;index<spec.steps;index++) await check(world,'simulation.stepWorld',{dt:spec.dt},w=>{
    modules.simulation.stepWorld(w,spec.dt); return null;
  },`long-run-${spec.population}-step-${index}`,false);
  console.log(JSON.stringify({trace:'long-run',elapsed:spec.steps*spec.dt,completed:world.metrics.completed,wood:world.inventory.wood}));
}
// Resource crews and goals use numeric project IDs, retained individual assignments and real material reservations.
for(const type of corpus.projectTypes){const w=modules['scale-fixture'].groundFixture(25);w.time=14;w.community.project={id:1,type,x:w.creatures[0].x,y:w.creatures[0].y,crew:w.creatures.slice(0,12).map(c=>c.id),target:300,required:32,progress:0,started:0,source:'Laya',blocked:''};w.community.nextProject=2;if(type==='refine')w.inventory.ore=4;for(const policy of ['balanced','industry'])await check(structuredClone(w),'planning.makePlan',{policy},w=>modules.jobs.makePlan(w,policy),`crew-${type}-${policy}`);await check(structuredClone(w),'development.plan',{},w=>modules['development-plan'].developmentPlan(w),`crew-${type}`);const p=modules.jobs.makePlan(w);await check(structuredClone(w),'planning.applyPlan',{plan:p},w=>modules.jobs.applyPlan(w,p),`crew-${type}`);}
for(const kind of corpus.goalKinds){const w=modules['scale-fixture'].groundFixture(25);w.time=14;const goal=modules.goals.addGoal(w,{kind,target:75},'Please work together','Laya');await check(structuredClone(w),'goals.inspect',{goal},w=>modules.goals.inspectGoal(w,goal),`goal-${kind}`);await check(structuredClone(w),'goals.policy',{},w=>modules.goals.goalPolicy(w),`goal-${kind}`);await check(structuredClone(w),'planning.context',{includePlans:false},w=>modules.context.buildContext(w,{includePlans:false}),`goal-${kind}`);}
for(const type of corpus.projectTypes){const w=modules['scale-fixture'].groundFixture(25);w.time=14;const choice={id:type,x:w.creatures[0].x,y:w.creatures[0].y,target:300,description:'A local resource crew'};await check(w,'settlement.start',{choice,source:'Laya'},w=>modules.settlement.startSettlement(w,choice,'Laya'),`start-${type}`);}
const commandWorld=modules['scale-fixture'].groundFixture(25);for(const [text,kind]of corpus.commands){await check(structuredClone(commandWorld),'commands.input',{text},()=>modules.commands.commandInput(text),'command');await check(structuredClone(commandWorld),'commands.constraints',{text},w=>modules.commands.parseConstraints(w,text,null),'constraints');await check(structuredClone(commandWorld),'commands.number',{text,kind},()=>modules.goals.numberFromCommand(text,kind),'numeric command');}
const blocked=modules.state.createWorld({empty:true});blocked.progress.hatched=true;blocked.runtime={intelligenceAvailable:true,growth:{held:true}};blocked.community.consent='accepted';const resident=modules.state.addCreature(blocked,15,24);resident.fed=resident.clean=resident.amused=95;const mine=modules.state.addObject(blocked,'mine',24,24,{stock:1000});for(let i=0;i<24;i++){const a=i*Math.PI/12;modules.state.addObject(blocked,'tree',24+Math.cos(a)*4,24+Math.sin(a)*4);}const request={target:mine.id,unit:resident.id,task:'mine',point:modules.geometry.serviceSlots(blocked,mine,resident)[0]};modules.access.requestAccess(blocked,request);await check(structuredClone(blocked),'access.review',{},w=>{modules.access.reviewAccess(w);return null;},'blocked mine');const reviewed=structuredClone(blocked);modules.access.reviewAccess(reviewed);await check(structuredClone(reviewed),'access.context',{},w=>modules.access.accessContext(w),'blocked mine reviewed');await check(structuredClone(reviewed),'access.choices',{},w=>modules.access.clearanceChoices(w),'clearing choices');
const moving=modules.state.createWorld({empty:true});moving.progress.hatched=true;moving.runtime={intelligenceAvailable:false,growth:{held:true},lastSchedule:1};moving.time=1;const walker=modules.state.addCreature(moving,19.98,25);walker.fed=walker.clean=walker.amused=95;walker.task='rest';walker.job={state:'travelling',point:{x:22.4,y:25},slot:0,partner:null,project:null,purpose:'Rest in a clear, quiet place',started:1,lastProgress:1,progressAt:1,bestDistance:2.42,expected:60};await target('load',moving);for(let i=0;i<12;i++){await check(moving,'density.at',{point:{x:30,y:25}},w=>modules.density.densityAt(w,{x:30,y:25}),`density-cache-${i}`,false);await check(moving,'simulation.stepWorld',{dt:.1},w=>{modules.simulation.stepWorld(w,.1);return null;},`density-movement-${i}`,false);}
// Cached members follow identity when a loose item disappears or a death and
// birth leave the resident count unchanged within the same integer second.
for(const mode of ['loose-item','membership']){
  const w=modules.state.createWorld({empty:true});w.progress.hatched=true;w.time=1;
  w.runtime={intelligenceAvailable:false,lastSchedule:1,growth:{held:mode==='loose-item'}};
  if(mode==='loose-item'){
    const banana=modules.state.addObject(w,'banana',10,24,{stock:1});
    modules.state.addObject(w,'bath',20,24);
    const c=modules.state.addCreature(w,10,24);c.fed=40;c.clean=c.amused=95;c.task='eat';c.target=banana.id;c.work=1.5;
    c.job={state:'working',point:{x:10,y:24},slot:0,project:null,purpose:'Recover food',started:1,lastProgress:1,expected:60};
  }else{
    const dying=modules.state.addCreature(w,10,24),parent=modules.state.addCreature(w,30,24);
    dying.fed=0;dying.deadTime=28;dying.clean=dying.amused=95;
    parent.fed=parent.clean=parent.amused=95;parent.growth=50;
  }
  await target('load',json(w));
  await check(w,'density.at',{point:{x:20,y:24}},w=>modules.density.densityAt(w,{x:20,y:24}),`density-${mode}-before`,false);
  await check(w,'simulation.stepWorld',{dt:.1},w=>{modules.simulation.stepWorld(w,.1);return null;},`density-${mode}-step`,false);
  await check(w,'density.at',{point:{x:20,y:24}},w=>modules.density.densityAt(w,{x:20,y:24}),`density-${mode}-after`,false);
}
const fog=modules.state.createWorld({empty:true}); await target('load',json(fog));
for(const point of [{x:-312,y:208},{x:280,y:-148},{x:-.01,y:-.01}]){
  await check(fog,'discovery.isExplored',point,w=>modules.discovery.isExplored(w,point),'fog-cache-before',false);
  await check(fog,'discovery.reveal',{point,radius:10},w=>modules.discovery.reveal(w,point,10),'fog-cache-reveal',false);
  await check(fog,'discovery.isExplored',point,w=>modules.discovery.isExplored(w,point),'fog-cache-after',false);
}
await (await import('./planning-edge-cases.mjs')).planningEdgeCases(modules,check);
child.stdin.end();mkdirSync(join(root,'artifacts/migration'),{recursive:true});writeFileSync(join(root,'artifacts/migration/planning-parity.json'),JSON.stringify({reference:SOURCE_REVISION,results,passed:results.filter(r=>r.status==='pass').length,failed:results.filter(r=>r.status==='fail').length},null,2));console.log(JSON.stringify({passed:results.filter(r=>r.status==='pass').length,failed:results.filter(r=>r.status==='fail').length}));

if(results.some(r=>r.status==='fail'))process.exitCode=1;
