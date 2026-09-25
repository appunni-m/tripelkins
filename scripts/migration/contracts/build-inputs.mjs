// Author deterministic stimuli only. No source return or target output is saved.
import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {ROOT,oracleDirectory} from './inventory.mjs';
import {loadManifest,validateInput} from './schema.mjs';
const path=join(ROOT,'tests/fixtures/manifest.json');const {manifest,registry}=loadManifest(path);
const oldDate=Date;globalThis.Date=class extends oldDate{constructor(...a){super(...(a.length?a:['2000-01-01T00:00:00.000Z']));}static now(){return 946684800000;}};
const contextModule=await import(pathToFileURL(join(oracleDirectory(),'src/game/context.js')));
const source=await import(pathToFileURL(join(oracleDirectory(),'src/game/state.js')));
const world=source.createWorld({empty:true});world.progress.hatched=true;world.stage=2;world.runtime={intelligenceAvailable:true};world.community.consent='accepted';world.progress.bridge=true;world.inventory={...world.inventory,wood:50,ore:20,blocks:500};world.progress.peakBlocks=500;
for(let i=0;i<25;i++){const c=source.addCreature(world,8+(i%5)*6,5+Math.floor(i/5)*6);c.fed=c.clean=c.amused=85;}
const tree=source.addObject(world,'tree',6,8),rock=source.addObject(world,'rock',28,28),orchard=source.addObject(world,'orchard',12,12),factory=source.addObject(world,'factory',22,22,{inputOre:5});
const project={blocked:'',id:1,type:'refine',x:20,y:20,crew:world.creatures.slice(0,4).map(c=>c.id),target:600,progress:0,required:20,source:'Laya',created:0};world.community.project=project;
const goal={id:'g1',kind:'blocks',target:600,status:'active',created:0,command:'Make 600 blocks',source:'Laya',progress:0};
const literal=value=>({kind:'literal',value});
const sha=data=>createHash('sha256').update(data).digest('hex');
const builtin=(name,assets)=>{const id=name.split('.').at(-1);if(!assets.some(a=>a.id===id))assets.push({id,kind:'builtin',name});return {kind:'asset',asset_id:id};};
const callbackNames={remember:'game.state.remember',addObject:'game.state.addObject',noteEvidence:'game.story.noteEvidence',placeBuilding:'game.simulation.placeBuilding'};
const defaultFor=(surface,op,param,w)=>{
 const k=param.id;
 if(['w','world'].includes(k))return w;
 if(k==='c')return w.creatures[0];
 if(k==='o')return ['game.projects','game.resources','game.bridge-project'].includes(surface)?w.objects.find(o=>o.type==='bridge')||tree:tree;
 if(k==='p'||k==='project')return surface==='game.decisions'?{policy:'balanced',assignments:[],rewards:[],reasons:[],predicted:{fed:80,clean:80,amused:80}}:project;
 if(k==='a')return surface==='game.work-balance'?w.creatures[0]:{x:10,y:10};if(k==='b')return surface==='game.work-balance'?w.creatures[1]:{x:20,y:12};if(k==='destination'||k==='point'||k==='from')return {x:20,y:12};
 if(k==='spec')return surface==='game.goals'?{kind:'blocks',target:600}:{name:'Rain shower',population:6,wood:6,capacity:1};
 if(k==='factory')return factory;if(k==='object')return tree;if(k==='parent'||k==='source')return surface==='game.state'||surface==='game.identity'?w.creatures[0]:'Laya';
 if(k==='plan')return {policy:'balanced',assignments:[],tick:0,revision:w.revision,commandRevision:w.commandRevision,navRevision:w.navRevision};
 if(k==='kind')return surface==='game.identity'?'social':surface==='game.goals'?'blocks':['game.resources','game.settlement'].includes(surface)?'wood':'arrival';
 if(k==='type')return 'orchard';if(k==='tool')return 'inspect';if(k==='answer')return 'yes';if(k==='accepted')return true;
 if(k==='options'||k.startsWith('options'))return surface==='game.community'?{text:'We found room to grow.',key:'arrival'}:surface==='game.access'?{target:rock.id,point:{x:27,y:28},unit:w.creatures[0].id,task:'quarry'}:surface==='game.outposts'?{workers:12,miners:5,stock:20,oldDistance:35,newDistance:6,kind:'food',wood:10,blocks:0,builderDistance:12}:{};
 if(k==='id')return surface==='game.story'?'arrival':surface==='game.timeline'?'base1':surface==='game.goals'?'g1':w.creatures[0].id;
 if(k==='entity'&&op==='interact')return w.creatures[0];if(k==='objects')return w.objects;
 if(k==='entity'||k==='listener'||k==='selected'||k==='other'||k==='unit')return w.creatures[0].id;
 if(k==='text'||k==='message'||k==='value'||k==='command')return surface==='game.context-budget'?{food:'Banana',count:25}:k==='value'&&['game.map','game.density'].includes(surface)?12.5:'Please gather wood';
 if(k==='intent')return 'hello';if(k==='channel')return 'text';if(k==='detail')return 'Nearby work';if(k==='response')return 'yes';if(k==='title')return 'A shared beginning';
 if(k==='g')return goal;if(k==='goals')return [goal];if(k==='raw')return surface==='game.map'?w.map:surface==='game.discovery'?w.discovery:surface==='game.memory'?w.memory:w;
 if(k==='input')return surface==='game.goals'?[goal]:surface==='game.timeline'?null:{};
 if(k==='care')return {food:{low:2,urgent:1,short:3,unserved:1},wash:{low:1,urgent:0,short:0,unserved:0},play:{low:0,urgent:0,short:0,unserved:0}};
 if(k==='result')return {listener:null,changes:{pauseWork:true},negated:true,reply:'Hold the work'};
 if(k==='choice')return {id:'refine',type:'refine',x:20,y:20,target:600,priority:90,description:'Make blocks'};
 if(k==='r')return surface==='game.geometry'?.28:{id:'r1',point:{x:20,y:20},target:rock.id,unit:w.creatures[0].id,task:'quarry',created:0};
 if(k==='memory')return w.memory;if(k==='events')return [{kind:'arrival',text:'The colony arrived',tick:1}];
 if(k==='history')return {schema:1,version:1,branches:[]};if(k==='branch')return {id:'b1',base:{id:'base1',at:'2000-01-01T00:00:00.000Z',world:w},frames:[],compacted:0};if(k==='previous')return null;if(k==='record')return w;
 if(k==='assignments'||k==='plans'||k==='choices'||k==='others'||k==='victims')return k==='victims'?[w.creatures[0]]:[];
 if(k==='full')return null;if(k==='budget')return 12000;if(k==='cause')return 'meteor';if(k==='actor')return 'caretaker';
 if(k==='x'||k==='y')return 10;if(k==='dt')return .05;if(k==='dx'||k==='dy')return .1;
 if(k==='stock'||k==='amount')return 3;if(k==='seed')return 18492;if(k==='index')return 42;if(k==='tick')return 0;
 if(k==='lo')return 0;if(k==='hi')return 100;if(k==='v')return 120;if(k==='target'||k==='requested')return 600;
 if(k==='minX'||k==='minY')return -20;if(k==='maxX'||k==='maxY')return 80;if(k==='cx'||k==='cy')return -1;
 if(k==='policy')return 'balanced';if(k==='action')return 'pause';
 return null;
};
const cases=[];
function makeCase(surface,operation,name,w,overrides={}){
 const op=registry.operations.get(`${surface}.${operation}`);if(!op)throw Error(`${surface}.${operation}`);const assets=[{id:'clock',kind:'builtin',name:'runtime.clock:2000-01-01T00:00:00.000Z:monotonic:0'},{id:'entropy',kind:'builtin',name:'runtime.entropy:seed:18492:uuid:00000000-0000-4000-8000-000000000001'}],args={};
 for(const p of op.source.parameters){if(p.id in overrides){args[p.id]=literal(overrides[p.id]);continue;}if(callbackNames[p.id]){args[p.id]=builtin(callbackNames[p.id],assets);continue;}if(p.omission.kind!=='required')continue;args[p.id]=literal(defaultFor(surface,operation,p,w));}
 for(const [k,v]of Object.entries(overrides)){if(!op.source.parameters.some(p=>p.id===k))throw Error(`bad input ${surface}.${operation}.${k}`);args[k]=literal(v);}
 const case_id=`${surface}.${operation}.${name.replace(/[^A-Za-z0-9_.:-]/g,'-')}`;
 cases.push({case_id,surface,operation,covers:[`${surface}.${operation}.contract`],target_profiles:['rust-native','rust-wasm'],assets,steps:[{step_id:'observe',surface,operation,receiver:null,arguments:args}],observations:['observe']});
}
const presentation=new Set(['game.geometry.project','game.geometry.unproject','game.map.terrainChunk']);
const unsupportedInput=new Set(['game.navigation.withRouteCosts','game.navigation-grid.copyOccupancy','game.context-budget.packHostedContext']);
for(const s of manifest.surfaces)for(const o of s.operations){if(presentation.has(`${s.id}.${o.id}`)||unsupportedInput.has(`${s.id}.${o.id}`))continue;makeCase(s.id,o.id,'representative',world);}
const fixtures=JSON.parse(readFileSync(join(ROOT,'engine/tests/simulation-inputs.json'))).cases;
for(const item of fixtures){const f={...item,...item.steps[0]};let [module,member]=f.operation.split('.');let args={...f.input};const w=f.world;let surface=`game.${module}`;let operation=member;
 const creature=id=>w.creatures.find(c=>c.id===id);const object=id=>w.objects.find(o=>o.id===id);const any=id=>creature(id)||object(id)||id;
 if(member==='meteorImpact'){surface='game.destruction';}
 if(member==='currentGoal'){surface='game.catalog';operation='goal';args={};}
 if(member==='bridgeProject'){surface='game.bridge-project';args=f.input.id?{bridge:object(f.input.id)}:{};}
 if(member==='separateBodies'){surface='game.geometry';}
 if(member==='steerMove'){surface='game.geometry';args={c:creature(args.id),dx:args.dx,dy:args.dy};}
 if(member==='relocate'){args={entity:any(args.id),p:args.point};}
 if(member==='upgrade'){args={o:object(args.id)};}
 if(member==='launch'||member==='releaseCargo'){args={c:creature(args.id)};}
 if(member==='pollute'){args={o:object(args.id),amount:args.amount};}
 if(member==='cleanPollution'||member==='pollutionAt'){args={p:{x:args.x,y:args.y}};}
 if(member==='maintainFactory'){args={factory:object(args.id),amount:args.amount};}
 if(member==='die'){args={victims:args.ids.map(any),cause:args.cause,actor:args.actor||'caretaker'};}
 if(member==='deliver'||member==='supplyProject'){args={c:creature(args.id),o:object(args.target)};if(member==='supplyProject')surface='game.projects';}
 if(member==='reachable'){args={c:creature(args.id),o:object(args.target)};}
 if(member==='interact'){if(args.entity!=null)args.entity=any(args.entity);}
 for(const k of Object.keys(args))if(args[k]===undefined)delete args[k];
 makeCase(surface,operation,'simulation-'+f.id,w,args);
}
makeCase('game.navigation-grid','copyOccupancy','tile-boundary',world,{tiles:[],grid:Array(64).fill(0),width:8,left:-3,top:29});
makeCase('game.navigation','withRouteCosts','route-cost-batch',world,{});{
 const item=cases.at(-1),descriptor={surface:'game.navigation',operation:'routeCost',arguments:{c:world.creatures[0],p:{x:28,y:29}}};
 item.assets.push({id:'callback',kind:'builtin',name:'runtime.callback:'+JSON.stringify(descriptor)});item.steps[0].arguments.operation={kind:'asset',asset_id:'callback'};
}
// Context is built by the live oracle and target independently, then packed.
for(const budget of [0,255,256,512,1024,2048,4096,12000,48000]){
 const cworld=structuredClone(world);cworld.memory.commands=Array.from({length:96},(_,i)=>({id:`unicode-${i}`,text:'猫を助けて 🐈 '+('広い世界を探索する '.repeat(10)),status:'completed',reply:'広がる村',tick:i,at:'2000-01-01T00:00:00.000Z'}));
 const full=contextModule.buildContext(cworld,{includePlans:false}).context;makeCase('game.context-budget','packHostedContext',`budget-${budget}`,cworld,{full,budget});
}
// Numeric spelling affects exact context/history byte accounting.
for(const [index,value] of [0,-0,1,1e-7,1e-6,1.2345678901234567e-6,1e20,1e21,1e22,
 -1e-7,-1e20,Number.MIN_VALUE,Number.MAX_VALUE,9007199254740991,0.30000000000000004].entries()){
 const input={value,nested:[value,'猫🐾',null,true]};
 makeCase('game.context-budget','utf8Size',`numeric-spelling-${index}`,world,{value:input});
 makeCase('game.timeline','historySize',`numeric-spelling-${index}`,world,{history:input});
}
// Narrow bridges have retained direction/queue state between public calls.
const bridgeWorld=source.createWorld({empty:true});bridgeWorld.progress.hatched=true;bridgeWorld.stage=2;bridgeWorld.runtime={lastSchedule:100,intelligenceAvailable:true,growth:{held:true}};bridgeWorld.community.consent='accepted';bridgeWorld.progress.bridge=true;
const narrow=source.addObject(bridgeWorld,'bridge',42,25,{stock:24,bridge:{a:{x:38.7,y:25},b:{x:45.3,y:25},width:1.2,complete:true,required:24,delivered:{wood:24,bones:0}}});
for(const [x,y]of [[38,25],[46,25],[46,26]]){const c=source.addCreature(bridgeWorld,x,y);c.fed=c.clean=c.amused=85;c.job=null;c.task='idle';c.growth=0;}
makeCase('game.traffic','canEnterBridge','narrow-queue-direction-and-expiry',bridgeWorld,{c:bridgeWorld.creatures[0],destination:{x:48,y:25}});{
 const item=cases.at(-1);item.steps=[];item.observations=[];const data=JSON.stringify(bridgeWorld);item.assets.push({id:'traffic_world',kind:'inline',encoding:'utf8',data,sha256:sha(data),media_type:'application/json'});
 const traffic=(id,index,destination)=>{item.steps.push({step_id:id,surface:'game.traffic',operation:'canEnterBridge',receiver:null,arguments:{w:{kind:'asset',asset_id:'traffic_world'},c:literal(bridgeWorld.creatures[index]),destination:literal(destination)}});item.observations.push(id);};
 traffic('west-admitted',0,{x:48,y:25});traffic('east-first-waits',1,{x:36,y:25});traffic('east-second-waits',2,{x:36,y:25});
 for(let i=0;i<41;i++)item.steps.push({step_id:'advance-'+i,surface:'game.simulation',operation:'stepWorld',receiver:null,arguments:{w:{kind:'asset',asset_id:'traffic_world'},dt:literal(.1)}});
 traffic('east-admitted-after-expiry',1,{x:36,y:25});traffic('west-waits-after-reversal',0,{x:48,y:25});traffic('east-second-admitted',2,{x:36,y:25});
}
for(const variant of ['caller-on-deck','other-on-deck','same-bank','far-from-entry','incomplete','wide']){
 const w=structuredClone(bridgeWorld),c=w.creatures[0],bridge=w.objects.find(o=>o.id===narrow.id);let destination={x:48,y:25};
 if(variant==='caller-on-deck')c.x=42;if(variant==='other-on-deck')w.creatures[1].x=42;if(variant==='same-bank')destination={x:35,y:25};if(variant==='far-from-entry')c.x=32;if(variant==='incomplete')bridge.bridge.complete=false;if(variant==='wide')bridge.bridge.width=2.4;
 makeCase('game.traffic','canEnterBridge',variant,w,{c,destination});
}
// Rich authored context exercises bounded histories, group jobs, access blockers,
// density rounding, optional omission, and the selected-object sample order.
const richContext=contextModule.buildContext(structuredClone(world),{includePlans:true}).context;
richContext.longTermGoal={kind:'blocks',target:600,value:45,policy:'industry',blocker:'Wood reserves need replenishment'};richContext.goalQueue=[{kind:'wood',target:80},{kind:'explore',target:3}];
richContext.blockedWork=[{id:'blocked-1',target:rock.id,at:{x:28,y:28},status:'waiting',task:'quarry',project:1,purpose:'Make stone blocks',reason:'Trees block the approach',prerequisite:'clearance',nextStep:'Clear the western edge',resume:'quarry'}];
richContext.development={densityRule:{target:4},outposts:[{x:28,y:28}],choices:[{key:'clearance:tree',id:'clearance',at:{x:27,y:28},camps:2,target:tree.id,cost:{wood:0},priority:95,density:{residents:3.85,reward:-.15},benefit:12.5,travel:15.5,outpost:true,subgoal:'unblock-quarry',request:'blocked-1',blocker:tree.id,description:'Clear trees to open the quarry approach. '.repeat(8)},{key:'wash:outpost',id:'wash',at:{x:34,y:28},cost:{wood:6},priority:45,benefit:3.2,travel:9.4}]};
richContext.player={...richContext.player,selected:orchard.id};richContext.objects=[{id:'low-stock',type:'orchard',stock:0},{id:orchard.id,type:'orchard',stock:20},{id:'high-stock',type:'factory',stock:100},...richContext.objects];
richContext.memory.commands=Array.from({length:32},(_,i)=>({id:'command-'+i,text:'猫たちの村を育てる 🐾 '.repeat(12),status:'completed',tick:i}));richContext.memory.recent=Array.from({length:24},(_,i)=>({kind:'work',text:'Shared work '+i,tick:i}));richContext.memory.summary.milestones=Array.from({length:8},(_,i)=>({text:'Milestone '+i,tick:i}));richContext.memory.conversations=[{text:'Stay together',tick:1},{text:'We found a safe passage',tick:2}];
for(const budget of [4096,8192,12000,32000,96000])makeCase('game.context-budget','packHostedContext',`rich-budget-${budget}`,world,{full:richContext,budget});
const unicodeContext=structuredClone(richContext);unicodeContext.development.choices[0].description='🐾'.repeat(100)+' Find the quarry';makeCase('game.context-budget','packHostedContext','unicode-clearance-description',world,{full:unicodeContext,budget:96000});
// Returned plans cross the actual JSON transport before becoming input again.
// Goal/project creation increments Rust numeric revisions and project IDs first.
const wireWorld=structuredClone(world);wireWorld.community.project=null;wireWorld.community.projects=[];wireWorld.runtime={lastSchedule:100,intelligenceAvailable:true,growth:{held:true}};
makeCase('game.jobs','applyPlan','wire-roundtrip-after-goal-and-project',wireWorld);{
 const item=cases.at(-1),data=JSON.stringify(wireWorld);item.assets.push({id:'wire_world',kind:'inline',encoding:'utf8',data,sha256:sha(data),media_type:'application/json'});const w={kind:'asset',asset_id:'wire_world'};
 item.steps=[
  {step_id:'goal',surface:'game.goals',operation:'addGoal',receiver:null,arguments:{w,spec:literal({kind:'blocks',target:800}),command:literal('Make800blocks'),source:literal('Laya')}},
  {step_id:'project',surface:'game.settlement',operation:'startSettlement',receiver:null,arguments:{w,choice:literal({id:'refine',x:20,y:20,target:800}),source:literal('Laya')}},
  {step_id:'plan',surface:'game.jobs',operation:'makePlan',receiver:null,arguments:{w,policy:literal('industry')}},
  {step_id:'apply',surface:'game.jobs',operation:'applyPlan',receiver:null,arguments:{w,plan:{kind:'binding',step_id:'plan'}}},
  {step_id:'step',surface:'game.simulation',operation:'stepWorld',receiver:null,arguments:{w,dt:literal(.1)}},
  {step_id:'plan-again',surface:'game.jobs',operation:'makePlan',receiver:null,arguments:{w,policy:literal('industry')}},
  {step_id:'apply-again',surface:'game.jobs',operation:'applyPlan',receiver:null,arguments:{w,plan:{kind:'binding',step_id:'plan-again'}}},
 ];item.observations=item.steps.map(s=>s.step_id);item.covers=[...new Set(item.steps.map(s=>s.surface+'.'+s.operation+'.contract'))];
}
const expanded=structuredClone(world);expanded.creatures=[];expanded.population=0;expanded.nextBirth=0;expanded.community.project=null;expanded.community.projects=[];expanded.time=10;expanded.runtime={intelligenceAvailable:true,growth:{held:true}};
for(let i=0;i<300;i++){const c=source.addCreature(expanded,4+(i%20)*4.5,-24+Math.floor(i/20)*6);c.fed=c.clean=c.amused=85;}
source.addObject(expanded,'bridge',42,25,{stock:24});
const workloads=[];
for(const s of manifest.surfaces)for(const op of s.operations){const perf=op.requirements.find(r=>r.dimension==='performance');if(!perf)continue;makeCase(s.id,op.id,'expanded-300',expanded);const c=cases.at(-1);c.covers.push(perf.id);workloads.push({workload_id:`${s.id}.${op.id}.expanded-300-benchmark`,covers:[perf.id],subjects:[{kind:'oracle',id:'javascript-reference'},{kind:'target_profile',id:'rust-native'},{kind:'target_profile',id:'rust-wasm'}],input:{kind:'parity_case',case_id:c.case_id},measurement:{boundary:'observed_steps',step_ids:['observe'],metrics:['latency'],warmup_iterations:1,measurement_iterations:1,samples:5,concurrency:1,cache_state:'cold',correctness_gate:'source_target_match'}});}
// Repeated authored snapshots are immutable shared assets, never expectations.
const assetDir=join(ROOT,'tests/fixtures/assets');mkdirSync(assetDir,{recursive:true});
for(const c of cases)for(const step of c.steps)for(const [name,d]of Object.entries(step.arguments)){if(d.kind!=='literal'||!['w','world','full','record','raw'].includes(name)||!d.value||typeof d.value!=='object')continue;const data=JSON.stringify(d.value),hash=sha(data),path=`${hash}.json`;writeFileSync(join(assetDir,path),data+'\n');const digest=sha(data+'\n'),id=`stimulus_${hash.slice(0,12)}`;if(!c.assets.some(a=>a.id===id))c.assets.push({id,kind:'ref',path,sha256:digest,media_type:'application/json'});step.arguments[name]={kind:'asset',asset_id:id};}
for(const lane of ['parity','coverage','benchmark'])mkdirSync(join(ROOT,'tests/fixtures/inputs',lane),{recursive:true});
const deprecated=join(ROOT,'tests/deprecated/migration-diagnostics');mkdirSync(deprecated,{recursive:true});
for(const name of ['spatial','state']){const old=join(ROOT,`tests/fixtures/inputs/parity/${name}.json`);if(existsSync(old)){renameSync(old,join(deprecated,`${name}.json`));}}
const corpus={schema:'migration-parity/parity-input@1',cases};validateInput(corpus,'parity',registry);writeFileSync(join(ROOT,'tests/fixtures/inputs/parity/engine.json'),JSON.stringify(corpus,null,2)+'\n');
const covered=new Map();for(const c of cases)for(const id of c.covers){if(!covered.has(id))covered.set(id,[]);covered.get(id).push(c.case_id);}
// Each component owns a plan and only covers operations declaring that component.
// Identical selectors share one instrumented execution in the collector.
const selectors={parity_case_ids:cases.map(c=>c.case_id),command_ids:['migration-diagnostic-simulation','migration-diagnostic-state','migration-diagnostic-planning','migration-diagnostic-spatial','migration-diagnostic-spatial-contract','migration-diagnostic-planning-boundaries']};
const plans=manifest.coverage_components.map(component=>({plan_id:`engine.${component.id}`,covers:manifest.surfaces.flatMap(s=>s.operations.filter(o=>o.coverage.component_ids?.includes(component.id)).flatMap(o=>o.requirements.filter(r=>r.lanes.includes('coverage')).map(r=>r.id))),target_profile:'rust-native',selectors,component_ids:[component.id],command_id:'migration-parity'}));
const coverage={schema:'migration-parity/coverage-input@1',plans},benchmark={schema:'migration-parity/benchmark-input@1',workloads,suites:[]};validateInput(coverage,'coverage',registry);validateInput(benchmark,'benchmark',registry);writeFileSync(join(ROOT,'tests/fixtures/inputs/coverage/engine.json'),JSON.stringify(coverage,null,2)+'\n');writeFileSync(join(ROOT,'tests/fixtures/inputs/benchmark/engine.json'),JSON.stringify(benchmark,null,2)+'\n');
manifest.input_index.parity=['inputs/parity/engine.json'];manifest.input_index.coverage=['inputs/coverage/engine.json'];manifest.input_index.benchmark=['inputs/benchmark/engine.json'];writeFileSync(path,JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify({cases:cases.length,operations:new Set(cases.map(c=>`${c.surface}.${c.operation}`)).size}));
