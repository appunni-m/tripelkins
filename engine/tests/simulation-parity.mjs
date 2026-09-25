import assert from 'node:assert/strict';
import {spawnSync,execFileSync} from 'node:child_process';
import {writeFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const revision='ae3350fd53414258ce7a9f94a0fe8315c7dafe29';
const root=resolve(import.meta.dirname,'../..');
const oracle=mkdtempSync(join(tmpdir(),'tripelkins-simulation-oracle-'));
execFileSync('tar',['-xf','-','-C',oracle],{input:execFileSync('git',['archive',revision,'src','package.json'],{cwd:root,maxBuffer:8e6})});
const load=(name)=>import(pathToFileURL(join(oracle,`src/game/${name}.js`)));
const {createWorld,addCreature,addObject,remember}=await load('state');
const {interact,choose,placeBuilding,relocate,connectSurvivor,withdrawMaterial,supplyBridge,upgrade,stepWorld}=await load('simulation');
const {meteorImpact}=await load('destruction');
const {stepCohorts}=await load('population');
const {pollute,cleanPollution,maintainFactory}=await load('resources');
const {goal}=await load('catalog');
const {steerMove,separateBodies}=await load('geometry');
const {releaseCargo,deposit,deliver,die}=await load('resources');
const {launch,syncPopulation,refreshDistrict}=await load('population');
const {supplyProject}=await load('projects');
const {noteEvidence}=await load('story');
const NativeDate=Date;
globalThis.Date=class extends NativeDate {constructor(...args){super(...(args.length?args:['2000-01-01T00:00:00.000Z']));} static now(){return 946684800000;}};
const binary=process.env.TRIPELKINS_ENGINE_BIN || fileURLToPath(new URL('../target/release/tripelkins-engine',import.meta.url));
const targetArgv=process.env.TRIPELKINS_ENGINE_ARGV?JSON.parse(process.env.TRIPELKINS_ENGINE_ARGV):[binary];
if(!Array.isArray(targetArgv)||!targetArgv.length||targetArgv.some(v=>typeof v!=='string'))throw new Error('Invalid target argv');
const fixtures=[];
function fresh(count=1){const w=createWorld({empty:true});w.progress.hatched=true;for(let i=0;i<count;i++){const c=addCreature(w,14+(i%5)*2,17+Math.floor(i/5)*2);if(c) c.fed=c.clean=c.amused=88;}return w;}
function add(name,setup,operation,input,call){const w=setup();const arg=typeof input==='function'?input(w):input;fixtures.push({name,w,operation,input:arg,call});}
function check(a,b,path='$'){
  if(typeof a==='number'&&typeof b==='number'){assert.ok(Math.abs(a-b)<=1e-9*Math.max(1,Math.abs(a),Math.abs(b)),`${path}: ${a} != ${b}`);return;}
  if(a&&b&&typeof a==='object'&&typeof b==='object'){
    assert.equal(Array.isArray(a),Array.isArray(b),`${path}: array shape`);
    assert.deepEqual(Object.keys(a).sort(),Object.keys(b).sort(),`${path}: keys`);
    for(const key of Object.keys(a))check(a[key],b[key],`${path}.${key}`);return;
  }assert.deepEqual(a,b,path);
}
const entity=(w,type)=>w.objects.find(o=>o.type===type)?.id;
const find=(w,id)=>w.objects.find(o=>o.id===id)||w.creatures.find(o=>o.id===id);
const full=()=>{const w=fresh(25);w.stage=2;w.progress.bridge=w.progress.monolith=w.progress.grabber=w.progress.swarm=w.progress.secondContact=true;w.progress.pollution=20;w.progress.peakBlocks=300000;w.progress.energy=2000000;w.inventory={wood:200,blocks:200000,ore:15,bones:10,corpses:2};return w;};
for(const [tool,type]of [['inspect','lander'],['inspect','monolith'],['inspect','bridge'],['inspect','sculpture'],['axe','tree'],['chainsaw','tree'],['hammer','rock'],['pickaxe','rock'],['hammer','ore'],['hammer','factory'],['hammer','mine'],['bug','corpse'],['swarm','corpse'],['grabber','log'],['grabber','bone']]){
  add(`${tool}:${type}`,()=>{const w=full();addObject(w,type,25,25,{stock:type==='sculpture'?7:4,inputOre:type==='factory'?11:0,quality:2});if(tool==='chainsaw'||tool==='pickaxe')addObject(w,type,26.5,26,{stock:3});return w;},'simulation.interact',w=>({tool,x:25,y:25,entity:entity(w,type)}),(w,a)=>interact(w,a.tool,a.x,a.y,find(w,a.entity)));
}
for(const tool of ['banana','cricketball','cloth','meteor','hammer','bug','swarm','mop','grabber']){
  add(`tool:${tool}`,full,'simulation.interact',w=>({tool,x:w.creatures[0].x,y:w.creatures[0].y,entity:w.creatures[0].id}),(w,a)=>interact(w,a.tool,a.x,a.y,find(w,a.entity)));
}
for(const type of ['bath','orchard','roundabout','sculpture','dwelling','factory','theatre','flowers','tnt','cannon','mine','unknown']){
  add(`build:${type}`,()=>{const w=full();if(type==='mine')addObject(w,'node',28,28,{stock:10000,level:2});return w;},'simulation.placeBuilding',{type,x:28,y:28},(w,a)=>placeBuilding(w,a.type,a.x,a.y));
}
for(const kind of ['wood','ore','bones','corpses','invalid'])add(`withdraw:${kind}`,full,'simulation.withdrawMaterial',{kind},(w,a)=>withdrawMaterial(w,a.kind));
add('held:place',()=>{const w=full();withdrawMaterial(w,'wood');return w;},'simulation.interact',{tool:'grabber',x:28,y:28,entity:null},(w,a)=>interact(w,a.tool,a.x,a.y,null));
add('relocate:rock',()=>{const w=full();addObject(w,'rock',25,25);return w;},'simulation.relocate',w=>({id:entity(w,'rock'),point:{x:28,y:28}}),(w,a)=>relocate(w,find(w,a.id),a.point));
add('bridge:supply',()=>{const w=full();addObject(w,'bridge',42,25,{stock:7});return w;},'simulation.supplyBridge',w=>({id:entity(w,'bridge')}),(w,a)=>supplyBridge(w,a.id));
for(const type of ['factory','mine','dwelling','bath'])add(`upgrade:${type}`,()=>{const w=full();addObject(w,type,28,28);return w;},'simulation.upgrade',w=>({id:entity(w,type)}),(w,a)=>upgrade(w,find(w,a.id)));
for(const [kind,answer]of [['monolith','care'],['monolith','discover'],['second-contact','yes'],['bug','yes'],['swarm','yes'],['nuke','no'],['nuke','yes']]){
  add(`choice:${kind}:${answer}`,()=>{const w=full();w.progress.monolith=false;w.progress.tnt=true;if(kind==='nuke'){w.progress.cannon=true;w.orbital.population=w.orbital.launches=12;w.population+=12;}return w;},'simulation.choose',w=>({kind,answer,entity:w.creatures[0].id}),(w,a)=>choose(w,a.kind,a.answer,a.entity));
}
add('survivor:connect',()=>{const w=fresh(3);w.stage=3;w.progress.finalRequired=3;addObject(w,'hole',24,24);return w;},'simulation.connectSurvivor',w=>({id:w.creatures[0].id}),(w,a)=>connectSurvivor(w,a.id));
add('meteor:world',()=>{const w=full();addObject(w,'tree',25,25);addObject(w,'rock',26,25);addObject(w,'mine',24,26,{stock:1234,quality:2});w.community.project={id:'p1',type:'orchard',x:25,y:25,crew:[],progress:3,required:20};return w;},'simulation.meteorImpact',{x:25,y:25},(w,a)=>meteorImpact(w,a.x,a.y));
for(const [cohort,homes,health]of [[100,3,80],[100,1,0],[0,0,100]]){
  add(`population:${cohort}:${homes}:${health}`,()=>{const w=fresh(3);w.stage=2;w.cohort=cohort;w.population+=cohort+12;w.orbital.population=12;w.district.health=health;for(let i=0;i<homes;i++)addObject(w,'dwelling',24+i*4,25);return w;},'population.stepCohorts',{dt:0.1},(w,a)=>stepCohorts(w,a.dt));
}
add('resource:pollute',()=>{const w=full();addObject(w,'factory',28,28);return w;},'resources.pollute',w=>({id:entity(w,'factory'),amount:24}),(w,a)=>pollute(w,find(w,a.id),a.amount));
add('resource:cleanup',()=>{const w=full();const o=addObject(w,'factory',15,18);pollute(w,o,100);return w;},'resources.cleanPollution',{x:15,y:18},(w,a)=>cleanPollution(w,a,(...args)=>{}));
// cleanPollution records memory through its supplied callback; use real recorder.
fixtures.at(-1).call=(w,a)=>cleanPollution(w,a,remember);
add('resource:maintenance',()=>{const w=full();const o=addObject(w,'factory',28,28);pollute(w,o,10);return w;},'resources.maintainFactory',w=>({id:entity(w,'factory'),amount:4}),(w,a)=>maintainFactory(w,find(w,a.id),a.amount));
for(const stage of [0,1,2,3,4]) add(`current-goal:${stage}`,()=>{const w=fresh(stage===0?0:25);w.stage=stage;return w;},'simulation.currentGoal',{},w=>goal(w));
// Keep scheduling quiescent to isolate fixed-step mutations from planner parity.
for(const task of ['idle','eat','wash','play','home','haul','mine','work','orbit','rest','social','explore','clean']){
  add(`step:${task}`,()=>{const w=full();w.runtime={lastSchedule:0,growth:{held:true},intelligenceAvailable:true};const c=w.creatures[0];const type={eat:'orchard',wash:'bath',play:'theatre',home:'dwelling',haul:'log',mine:'mine',work:'factory',orbit:'cannon',clean:'factory'}[task];const o=type?addObject(w,type,13,16,{stock:12,inputOre:30,level:1}):null;c.task=task;c.target=o?.id||null;c.work=10;c.job={task,state:'working',point:{x:c.x,y:c.y},target:c.target,started:0,lastProgress:0,expected:20,partner:w.creatures[1].id};if(task==='wash')c.clean=97;if(task==='play')c.amused=97;if(task==='home')c.fed=c.clean=97;if(task==='social'){w.creatures[1].x=c.x+1;w.creatures[1].y=c.y;}if(task==='clean')pollute(w,o,4);return w;},'simulation.stepWorld',{dt:0.1},(w,a)=>stepWorld(w,a.dt));
}

for(const task of ['gather','quarry','refine','construct']) {
  add(`crew-step:${task}`,()=>{const w=full();w.community.consent='accepted';w.runtime={lastSchedule:0,growth:{held:true},intelligenceAvailable:true};const c=w.creatures[0];const type={gather:'tree',quarry:'rock'}[task];const o=type?addObject(w,type,13,16):null;const project={id:1,type:{gather:'timber',quarry:'quarry',refine:'refine',construct:'bath'}[task],x:13,y:16,crew:[c.id],target:300,required:32,progress:0};w.community.project=project;c.task=task;c.target=o?.id||null;c.work=6;c.job={task,state:'working',point:{x:c.x,y:c.y},project:1,started:0,lastProgress:0,expected:20};return w;},'simulation.stepWorld',{dt:.1},(w,a)=>stepWorld(w,a.dt));
}
add('step:birth',()=>{const w=fresh(3);w.creatures[0].growth=49.999;w.runtime={lastSchedule:0};return w;},'simulation.stepWorld',{dt:.1},(w,a)=>stepWorld(w,a.dt));
add('step:death',()=>{const w=fresh(3);w.creatures[0].fed=0;w.creatures[0].deadTime=27.999;w.runtime={lastSchedule:0};return w;},'simulation.stepWorld',{dt:.1},(w,a)=>stepWorld(w,a.dt));
add('step:invalid-target',()=>{const w=fresh(3);const c=w.creatures[0];c.target='o-gone';c.task='eat';c.job={state:'travelling',started:0,lastProgress:0,point:{x:24,y:24}};w.runtime={lastSchedule:0};return w;},'simulation.stepWorld',{dt:.1},(w,a)=>stepWorld(w,a.dt));
for(const kind of ['wood','bones','ore'])add(`resource:release:${kind}`,()=>{const w=fresh();w.creatures[0].carry=3;w.creatures[0].cargoKind=kind;return w;},'resources.releaseCargo',w=>({id:w.creatures[0].id}),(w,a)=>releaseCargo(w,find(w,a.id)));
for(const [stock,carry,kind] of [[0,3,'wood'],[23,4,'bones'],[24,3,'wood']])add(`resource:bridge:${stock}:${kind}`,()=>{const w=fresh();w.creatures[0].carry=carry;w.creatures[0].cargoKind=kind;addObject(w,'bridge',42,25,{stock});return w;},'resources.deliver',w=>({id:w.creatures[0].id,target:entity(w,'bridge')}),(w,a)=>deliver(w,find(w,a.id),find(w,a.target),remember));
add('resource:project-supply',()=>{const w=fresh();w.creatures[0].carry=3;w.creatures[0].cargoKind='wood';addObject(w,'sculpture',26,25,{stock:10});return w;},'resources.supplyProject',w=>({id:w.creatures[0].id,target:entity(w,'sculpture')}),(w,a)=>supplyProject(w,find(w,a.id),find(w,a.target),remember,noteEvidence));
for(const type of ['log','bone','corpse','ore'])add(`resource:deposit:${type}`,()=>{const w=fresh();addObject(w,type,24.5,24.5,{stock:4});return w;},'resources.deposit',{type,x:25,y:25,stock:3},(w,a)=>deposit(w,a.type,a.x,a.y,a.stock,addObject));
for(const cause of ['hammer','neglect','bug','swarm','pollution','meteor'])add(`resource:die:${cause}`,()=>{const w=fresh(4);w.creatures[0].carry=3;w.creatures[0].cargoKind='ore';return w;},'resources.die',w=>({ids:w.creatures.slice(0,2).map(c=>c.id),cause,actor:'world'}),(w,a)=>die(w,w.creatures.filter(c=>a.ids.includes(c.id)),a.cause,addObject,remember,a.actor));
for(const count of [8,9,20])add(`population:launch:${count}`,()=>fresh(count),'population.launch',w=>({id:w.creatures[0].id}),(w,a)=>launch(w,find(w,a.id),remember));
for(const offset of [0,0.2,0.5])add(`physics:separate:${offset}`,()=>{const w=fresh(3);w.creatures.forEach((c,i)=>{c.x=22+i*offset;c.y=22;});return w;},'simulation.separateBodies',{},w=>separateBodies(w));
for(const [dx,dy]of [[.1,0],[.25,.25],[0,-.2],[-.6,0]])add(`physics:steer:${dx}:${dy}`,()=>{const w=fresh(4);w.creatures.forEach((c,i)=>{c.x=22+i*.6;c.y=22;});addObject(w,'tree',21,22);return w;},'simulation.steerMove',w=>({id:w.creatures[0].id,dx,dy}),(w,a)=>steerMove(w,find(w,a.id),a.dx,a.dy));

for(const mode of ['paused','unhatched','ended','negative-dt','clamped-dt'])add(`step-gate:${mode}`,()=>{const w=fresh(3);w.runtime={lastSchedule:0,growth:{held:true}};if(mode==='paused')w.ui.paused=true;if(mode==='unhatched')w.progress.hatched=false;if(mode==='ended')w.stage=3;return w;},'simulation.stepWorld',{dt:mode==='negative-dt'?-1:mode==='clamped-dt'?2:.1},(w,a)=>stepWorld(w,a.dt));
add('crew-step:second-project',()=>{const w=full();w.community.consent='accepted';w.runtime={lastSchedule:0,growth:{held:true},intelligenceAvailable:true};const c=w.creatures[0];w.community.project={id:1,type:'bath',x:31,y:31,crew:[w.creatures[1].id],progress:4,required:32};w.community.projects=[{id:2,type:'orchard',x:33,y:33,crew:[w.creatures[2].id],progress:7,required:32},{id:3,type:'bath',x:28,y:28,crew:[c.id],progress:9,required:32}];c.task='construct';c.target=null;c.job={task:'construct',state:'working',project:3,point:{x:c.x,y:c.y},started:0,lastProgress:0,expected:20};return w;},'simulation.stepWorld',{dt:.1},(w,a)=>stepWorld(w,a.dt));
add('step:bridge-complete',()=>{const w=fresh(3);w.runtime={lastSchedule:0,growth:{held:true}};const c=w.creatures[0];const bridge=addObject(w,'bridge',42,25,{stock:23});c.carry=3;c.cargoKind='wood';c.task='haul';c.target=bridge.id;c.work=1.2;c.job={task:'haul',state:'working',point:{x:c.x,y:c.y},started:0,lastProgress:0,expected:20};return w;},'simulation.stepWorld',{dt:.1},(w,a)=>stepWorld(w,a.dt));
add('step:skipped-care-releases-cargo',()=>{const w=fresh(3);w.runtime={lastSchedule:0,growth:{held:true}};const c=w.creatures[0];const orchard=addObject(w,'orchard',13,16,{stock:6});addObject(w,'bridge',42,25,{stock:0});c.carry=3;c.cargoKind='wood';c.task='eat';c.target=orchard.id;c.work=1.5;c.job={task:'eat',state:'working',point:{x:c.x,y:c.y},started:0,lastProgress:0,expected:20};return w;},'simulation.stepWorld',{dt:.1},(w,a)=>stepWorld(w,a.dt));
add('resource:cleanup-negative-half',()=>{const w=full();const o=addObject(w,'factory',-.5,-1.5);pollute(w,o,4);return w;},'resources.cleanPollution',{x:-.5,y:-1.5},(w,a)=>cleanPollution(w,a,remember));
add('step:explore-negative-half',()=>{const w=fresh(1);w.runtime={lastSchedule:0,growth:{held:true}};const c=w.creatures[0];c.x=-.5;c.y=-1.5;c.task='explore';c.work=3;c.job={task:'explore',state:'working',point:{x:c.x,y:c.y},started:0,lastProgress:0,expected:20};return w;},'simulation.stepWorld',{dt:.1},(w,a)=>stepWorld(w,a.dt));
writeFileSync(new URL('./simulation-inputs.json',import.meta.url),JSON.stringify({schema:'tripelkins/simulation-inputs@1',reference:revision,cases:fixtures.map(f=>({id:f.name,world:f.w,steps:[{operation:f.operation,input:f.input}]}))},null,2));
if(process.env.TRIPELKINS_EMIT_ONLY==='1'){console.log(JSON.stringify({reference:revision,fixtures:fixtures.length}));process.exit(0);}
let passed=0;let failed=0;
for(const f of fixtures){const expected=structuredClone(f.w);const result=await f.call(expected,structuredClone(f.input));const input=[{operation:'load',input:f.w},{operation:f.operation,input:f.input},{operation:'snapshot',input:{}}].map(v=>JSON.stringify(v)).join('\n')+'\n';const run=spawnSync(targetArgv[0],targetArgv.slice(1),{input,encoding:'utf8',maxBuffer:10*1024*1024});
  if(run.error||run.status!==0)throw new Error(`Target infrastructure failure: ${run.error?.message||run.stderr||run.signal}`);
  try{assert.equal(run.status,0,run.stderr);const lines=run.stdout.trim().split('\n').map(x=>JSON.parse(x));assert.equal(lines.length,3,run.stdout);for(const line of lines)assert.equal(line.status,'ok',JSON.stringify(line));check(JSON.parse(JSON.stringify(result??null)),lines[1].value,`${f.name}.return`);check(JSON.parse(JSON.stringify(expected)),lines[2].value,`${f.name}.world`);passed++;}
  catch(error){failed++;console.error(`FAIL ${f.name}: ${error.message}`);writeFileSync(`/private/tmp/simulation-${f.name.replaceAll(':','-')}.json`,JSON.stringify({fixture:f.w,input:f.input,expected,result:result??null,actual:run.stdout,stderr:run.stderr},null,2));}
}
console.log(JSON.stringify({suite:'simulation Rust parity',reference:revision,passed,failed,total:fixtures.length}));if(failed)process.exitCode=1;
