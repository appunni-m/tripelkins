import {mkdtempSync,writeFileSync,readFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync,spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {SOURCE_REVISION} from '../../scripts/migration/contracts/inventory.mjs';
const root=resolve(import.meta.dirname,'../..');
const fixture=JSON.parse(readFileSync(join(root,'tests/deprecated/migration-diagnostics/state.json'),'utf8'));
if(fixture.schema!=='tripelkins/state-parity@1'||Object.keys(fixture).sort().join()!=='dictionaryIndices,eventCount,messageCount,names,replyInputs,schema,storySteps,timelineFrames')throw new Error('Unsupported state parity inputs');
const edges=JSON.parse(readFileSync(join(root,'tests/deprecated/migration-diagnostics/state-edges.json'),'utf8'));
if(edges.schema!=='tripelkins/state-edges@1'||Object.keys(edges).sort().join()!=='completionRevisions,conversationTerminations,encounters,healthNeeds,identities,listeners,names,numericInputs,overflowCount,roundTripCommands,saveCases,schema,storyAnswers')throw new Error('Unsupported state edge inputs');
const oracle=mkdtempSync(join(tmpdir(),'tripelkins-state-oracle-'));
execFileSync('tar',['-xf','-','-C',oracle],{input:execFileSync('git',['archive',SOURCE_REVISION,'src','package.json'],{cwd:root,maxBuffer:8e6})});
const module=async n=>import(pathToFileURL(join(oracle,'src/game',n+'.js')));
const [state,identity,community,story,memory,timeline,conversation,fixtures,health,goals,commands,jobs,saveSchema,themeCompat]=await Promise.all(['state','identity','community','story','memory','timeline','conversation','scale-fixture','health','goals','commands','jobs','save-schema','theme-compat'].map(module));
const OriginalDate=Date;globalThis.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:['2000-01-01T00:00:00.000Z']));}};
let ids=[],idAt=0;Object.defineProperty(globalThis,'crypto',{value:{getRandomValues(a){a.fill(18492);return a;},randomUUID(){return ids[idAt++]??`missing-${idAt}`;}}});
const argv=process.env.TRIPELKINS_ENGINE_ARGV?JSON.parse(process.env.TRIPELKINS_ENGINE_ARGV):[join(root,'engine/target/release/tripelkins-engine')];
const child=spawn(argv[0],argv.slice(1),{cwd:root,stdio:['pipe','pipe','inherit']});const pending=[];createInterface({input:child.stdout}).on('line',line=>pending.shift()?.resolve(JSON.parse(line)));child.on('exit',code=>pending.splice(0).forEach(p=>p.reject(new Error(`Exit ${code}`))));
const target=(operation,input={})=>new Promise((resolve,reject)=>{pending.push({resolve,reject});child.stdin.write(JSON.stringify({operation,input})+'\n');});
const clone=x=>JSON.parse(JSON.stringify(x));
let passed=0,failed=0;const errors=[];
function diffs(a,b,path='$',out=[]){if(a===b)return out;if(typeof a==='number'&&typeof b==='number'){if(Math.abs(a-b)>1e-10+Math.abs(a)*1e-12)out.push({path,a,b});return out;}if(a&&b&&typeof a==='object'&&typeof b==='object'&&Array.isArray(a)===Array.isArray(b)){for(const k of new Set([...Object.keys(a),...Object.keys(b)]))diffs(a[k],b[k],path+'.'+k,out);}else out.push({path,a,b});return out;}
async function check(name,operation,input,reference,wireInput=input){const targetInput=clone(wireInput);let expected;try{expected={status:'ok',value:clone(await reference())};}catch(e){expected={status:'error',message:e.message};}const actual=await target(operation,targetInput);
 // Wall-clock diagnostics are host measurements, outside deterministic game state.
 for(const outcome of [expected,actual])if(outcome?.value?.runtime&&Object.hasOwn(outcome.value.runtime,'schedulerMs'))outcome.value.runtime.schedulerMs=0;
 const d=diffs(expected,actual);if(d.length){failed++;errors.push({name,operation,diffs:d.slice(0,12)});}else passed++;return actual.value;}
async function load(w){await target('load',w);}
function completeReference(w,{id,text,target,answer:inputAnswer}){
 const answer=clone(inputAnswer),command=w.memory.commands.find(c=>c.id===id);let goalId=null,mood='reply';
 if(answer.constraints)commands.commitConstraints(w,answer.constraints);
 if(answer.goal){const objective=goals.addGoal(w,answer.goal,text,answer.source);goalId=objective.id;
  for(const finished of goals.advanceGoals(w))state.remember(w,'goal-complete',`We reached our goal: ${goals.goalTitle(finished)}.`);
  const observed=goals.inspectGoal(w,objective);answer.reply=objective.status==='completed'?`We have already reached that goal: ${goals.goalTitle(objective)}.`:`${objective.status==='queued'?'We’ll remember this for next':objective.status==='paused'?'This goal is saved and paused':'We’ll keep working toward this'}: ${goals.goalTitle(objective)}. ${observed.blocker||observed.step}`;
  state.remember(w,'goal',`We agreed on a goal: ${goals.goalTitle(objective)}.`);const focus=goals.activeGoal(w);if(focus?.id===objective.id){w.memory.lastPlan={policy:observed.policy,source:'Goal planner',tick:Math.floor(w.time),goalId:focus.id};jobs.applyPlan(w,jobs.makePlan(w,goals.goalPolicy(w)));}mood=observed.blocker?'blocked':'goal';
 }
 command.goalId=goalId;command.status='completed';command.reply=answer.reply.slice(0,500);command.source=answer.source;
 w.memory.conversations.push({text,reply:answer.reply.slice(0,500),source:answer.source,tick:Math.floor(w.time),listener:target});w.memory.conversations=w.memory.conversations.slice(-24);state.remember(w,'conversation',`You said: ${text.slice(0,180)}`,target);community.postMessage(w,{title:'A word with the colony',text:`You: ${text}\nThe colony: ${answer.reply}`});w.community.inbox.at(-1).notified=true;community.activity(w,'conversation','Heard your words',answer.source,answer.reply);return {reply:answer.reply,mood,goalId,source:answer.source};
}
let w=state.createWorld({empty:true});await load(w);
for(const empty of [true,false])await check('create '+empty,'state.createWorld',{empty,seed:18492},()=>state.createWorld({empty}));
for(let i=0;i<10;i++){await check('random','state.random',{},()=>state.random(w));await check('object','state.addObject',{type:'flowers',x:12+i,y:14,extra:{variant:i%3}},()=>state.addObject(w,'flowers',12+i,14,{variant:i%3}));await check('creature','state.addCreature',{x:18+i*.7,y:18},()=>state.addCreature(w,18+i*.7,18));}
await check('snapshot add','snapshot',{},()=>w);
for(const index of fixture.dictionaryIndices)await check('dictionary','identity.dictionaryName',{index},()=>identity.dictionaryName(index));
for(const name of fixture.names){const id=w.creatures[0].id;await check('rename '+name,'identity.renameCreature',{id,input:name},()=>{const r=identity.renameCreature(w,w.creatures[0],name);if(!r.error&&r.old!==r.name)state.remember(w,'rename',`${r.old} is now ${r.name}.`,id);return r;});}
await check('rename snapshot','snapshot',{},()=>w);
for(const text of fixture.replyInputs)await check('reply '+text,'conversation.informationReply',{text,listener:null},()=>conversation.informationReply(w,text,null));
for(let i=0;i<fixture.eventCount;i++){const kind=i%3?'plan':'build';await check('remember','state.remember',{kind,message:'event '+i},()=>{state.remember(w,kind,'event '+i);return null;});}
await check('memory compaction','snapshot',{},()=>w);
for(let i=0;i<fixture.messageCount;i++){const message={key:'test:'+i,title:'entry',text:'letter '+i,...(i%11?{}:{action:'independence'})};await check('message','community.postMessage',{message},()=>community.postMessage(w,message));}
await check('inbox retained','snapshot',{},()=>w);
for(const ready of [false,true]){w.population=25;await load(w);await check('offer','community.offerIndependence',{},()=>{community.offerIndependence(w);return null;});await check('consent','community.setIndependence',{accepted:ready},()=>{const result=community.setIndependence(w,ready);if(result&&ready)w.settings.autonomy=true;return result;});await check('community snapshot','snapshot',{},()=>w);}
for(let i=0;i<fixture.storySteps;i++){w.time=i*91;w.population=i*6;w.progress.hatched=true;w.progress.bridge=i>2;w.stage=i>12?3:2;w.memory.activity.eat=i*2;w.memory.activity.wash=i*2;w.memory.activity.play=i*2;w.community.explored=i;await load(w);await check('story '+i,'story.update',{},()=>{story.updateStory(w);return null;});await check('story queue','snapshot',{},()=>w);await check('story collect','story.collect',{},()=>{story.collectStoryMessages(w);return null;});await check('story inbox','snapshot',{},()=>w);}
const saved=clone(w);for(const raw of [saved,fixtures.groundFixture(25),{...saved,schema:3},{...saved,settings:{...saved.settings,token:'SECRET',junk:true},unknown:3,community:{...saved.community,junk:8}}, {...saved,creatures:[{id:'c1',fed:null,clean:3,amused:4}]},{...saved,map:null},{...saved,discovery:{version:2}}])await check('migrate','state.migrateWorld',{raw},()=>state.migrateWorld(raw));
await check('migrations leave active state intact','snapshot',{},()=>w);
await check('health','state.colonyHealth',{world:saved},()=>health.colonyHealth(saved));
// Import workflows cover active local work, family identity, resource cargo,
// scheduler turns, fractional values, missing fields and restore validation.
const crewWorld=fixtures.groundFixture(25);
crewWorld.community.project={id:7,type:'timber',x:-20,y:-18,crew:crewWorld.creatures.slice(0,3).map(c=>c.id),target:30,progress:3.3,required:32,started:0,source:'Laya',blocked:'',parentGoal:'g700',subgoal:'wood',siteReason:'Local demand'};
crewWorld.community.projects=[{...crewWorld.community.project,id:8,type:'refine',crew:crewWorld.creatures.slice(3,6).map(c=>c.id)}];
crewWorld.creatures[0].job={state:'working',slot:1,point:{x:-20,y:-17},project:7,purpose:'Timber',started:0,lastProgress:0,expected:60};
crewWorld.creatures[0].lastWorkTurn=1.5;crewWorld.creatures[0].cargoKind='ore';crewWorld.creatures[0].carry=2.5;
crewWorld.memory.goals=[{id:'g700',kind:'wood',target:40.7,status:'active',command:'collect timber',createdAt:0,reviews:[]}];
for(const raw of [crewWorld,{...crewWorld,schema:2}, {...crewWorld,creatures:crewWorld.creatures.map(c=>({...c,birthOrdinal:null,heading:null,name:123,traits:{curiosity:null},favorite:1}))}, {...crewWorld,ui:{zoom:null},story:{lastAt:null},settings:{intelligenceWorkers:1.5}}, {...crewWorld,creatures:[{...crewWorld.creatures[0],fed:'67.25'}]}, {...crewWorld,creatures:[{...crewWorld.creatures[0],fed:true}]}, {...crewWorld,creatures:[{...crewWorld.creatures[0],fed:'bad'}]}, {...crewWorld,nextId:0.1,nextEvent:1.5,time:-2,seed:3.2,cohort:2.9}, {schema:1,population:2,needs:{fed:72,clean:71,amused:73},inventory:{wood:3},buildings:{bath:1},partTwo:true}])await check('restored crews/import boundary','state.migrateWorld',{raw},()=>state.migrateWorld(raw));
for(let i=0;i<105;i++){ids=[`command-${i}`];idAt=0;await check('bounded commands','memory.beginCommand',{id:ids[0],text:'hello '+i,channel:i%2?'typed':'voice',listener:null},()=>memory.beginCommand(w,'hello '+i,i%2?'typed':'voice',null));}
for(const value of [null,true,0,7,'text',[],[72],{},[null]]) {
 for(const section of ['promises','evidence','assessments','responses']) {
  const raw=clone(saved);raw.story[section]=[value];
  await check('malformed story '+section+' '+JSON.stringify(value),'state.migrateWorld',{raw},()=>state.migrateWorld(raw));
  await check('malformed import preserves active world','snapshot',{},()=>w);
 }
 const raw=clone(saved);raw.creatures[0].fed=value;
 await check('coerced needs '+JSON.stringify(value),'state.migrateWorld',{raw},()=>state.migrateWorld(raw));
 await check('numeric clamp '+JSON.stringify(value),'state.clamp',{v:value,lo:-10,hi:10},()=>state.clamp(value,-10,10));
}
for(const memoryInput of [null,{commands:[{id:'c1',text:'hello',reply:7,source:true,at:3,goalId:14,listener:7}],summary:{milestones:[{tick:1,kind:2,message:false}]}},{summary:{milestones:[null]}}]) {
 await check('memory normalization malformed types','memory.normalizeMemory',{raw:memoryInput},()=>memory.normalizeMemory(memoryInput));
}
await check('commands snapshot','snapshot',{},()=>w);
await check('interrupted snapshot','memory.interruptSnapshot',{world:w},()=>memory.interruptCommands(clone(w)));
for(const c of w.creatures.slice(0,2)){await check('favorite','identity.favorite',{id:c.id},()=>{c.favorite=!c.favorite;state.remember(w,'favorite',`${c.name} ${c.favorite?'pinned':'unpinned'}.`,c.id);return null;});}
for(const entry of [...w.story.queue,...w.community.inbox.map(m=>m.story)].filter(Boolean).slice(0,5)){const response=story.storyEntry(entry)?.responses.at(-1);await check('answer story','story.answer',{id:entry,response},()=>{w.story.active=entry;story.answerStory(w,response);return null;});}
await check('story assessment','story.assessment',{},()=>story.assessment(w));
await check('story archives','story.archives',{},()=>story.archiveEntries(w));
await check('story response snapshot','snapshot',{},()=>w);

// Reproduce the previous conversation UI's composition with deterministic
// model output; each side invokes its own constraints, goals and scheduler.
w=fixtures.groundFixture(25);await load(w);
const commandText='collect 40 wood',commandId='conversation-live',targetId=w.creatures[0].id;
ids=[commandId];idAt=0;
await check('conversation begin','conversation.begin',{id:commandId,text:commandText,channel:'voice',target:targetId},()=>{
 const reference=commands.parseConstraints(w,commandText,targetId),target=reference.listener||targetId;
 const command=memory.beginCommand(w,commandText,'voice',target);state.remember(w,'command',commandText,target);return {command,target};
});
const modelAnswer={goal:{kind:'wood',target:40},reply:'We will gather timber.',source:'Laya',constraints:commands.parseConstraints(w,commandText,targetId)};
await check('conversation goal composition','conversation.complete',{id:commandId,text:commandText,target:targetId,answer:modelAnswer,expectedCommandRevision:w.commandRevision},()=>completeReference(w,{id:commandId,text:commandText,target:targetId,answer:modelAnswer}));
await check('conversation authoritative state','snapshot',{},()=>w);

await check('initial community helper','community.initialCommunity',{},()=>community.initialCommunity());
await check('initial story helper','story.initialStory',{},()=>story.initialStory());
await check('initial evidence helper','story.initialEvidence',{},()=>story.initialEvidence());
await check('identity helper','identity.identity',{},()=>identity.identity(w));
await check('identity helper state','snapshot',{},()=>w);
await check('notice helper','community.nextNotice',{},()=>community.nextNotice(w));
await check('notice helper state','snapshot',{},()=>w);
const compactedMemory=clone(w.memory),compactEvents=[{kind:'goal',tick:40,message:'first'},{kind:'play',tick:41,message:'second'}];
await check('event compaction helper','memory.compactEvents',{memory:compactedMemory,events:compactEvents},()=>{memory.compactEvents(compactedMemory,compactEvents);return compactedMemory;});
const compatibilityInput={inventory:{gems:3},objects:[{type:'apple'},{type:'egg'}],name:'apple',memory:{commands:[{text:'gems and apple'}]}};
await check('legacy field compatibility','theme-compat.themeCompatibleWorld',{raw:compatibilityInput},()=>themeCompat.themeCompatibleWorld(compatibilityInput));
const extensionRaw=clone(w);extensionRaw.creatures[0].favorite=true;extensionRaw.creatures[0].traits={curiosity:0.81,token:'discard'};
extensionRaw.creatures[0].encounters=[{kind:'play',other:'c2',tick:0,token:'discard'}];
extensionRaw.story.token='discard';extensionRaw.directives.token='discard';extensionRaw.community.token='discard';
extensionRaw.community.inbox.push({title:'Retained message',text:'Hi',token:'discard'});
extensionRaw.departed=[{id:'c0',name:'Old friend',cause:'age',tick:0,token:'discard'}];
extensionRaw.groups=[{id:'g1',role:'gather',members:[w.creatures[0].id],token:'discard'}];
await check('extension migration helper','save-schema.migrateExtensions',{raw:extensionRaw},()=>{saveSchema.migrateExtensions(w,extensionRaw);return null;});
await check('extension migration state','snapshot',{},()=>w);
await check('extend helper','save-schema.extendWorld',{},()=>{saveSchema.extendWorld(w);return null;});
await check('extend helper state','snapshot',{},()=>w);

// Extra input-only workflows exercise public identity operations and save data
// produced by working colonies. Both engines evaluate every result live.
function namedColony(){const world=state.createWorld({empty:true});for(const [i,name] of edges.names.entries()){const c=state.addCreature(world,18+i*2,24);c.id=`c${i+1}`;c.name=name;c.customName=name;}world.time=120;world.progress.hatched=true;return world;}
function mergeInput(base,patch){for(const [key,value] of Object.entries(patch)){if(value&&typeof value==='object'&&!Array.isArray(value)){if(!base[key]||typeof base[key]!=='object'||Array.isArray(base[key]))base[key]={};mergeInput(base[key],value);}else base[key]=clone(value);}return base;}
w=namedColony();await load(w);
for(const input of edges.listeners)await check('listener '+input.text+' '+input.selected,'identity.resolveListener',input,()=>identity.resolveListener(w,input.text,input.selected));
for(const input of edges.identities){
 w=namedColony();w.nextBirth=input.ordinal;
 if(input.collision){const index=(input.ordinal*7919+w.map.seed%identity.DICTIONARY_SIZE)%identity.DICTIONARY_SIZE,generation=Math.floor(input.ordinal/identity.DICTIONARY_SIZE);w.creatures[0].name=identity.dictionaryName(index)+(generation?` ${generation+1}`:'');}
 await load(w);const parent=input.parent?w.creatures[0]:null;
 await check('family identity '+input.ordinal,'identity.identity',{parent},()=>identity.identity(w,parent));
 await check('family ordinal snapshot','snapshot',{},()=>w);
}
w=namedColony();await load(w);
const parent=w.creatures[0];await check('child inherits parent','state.addCreature',{x:20,y:27,source:parent},()=>state.addCreature(w,20,27,parent));
await check('child snapshot','snapshot',{},()=>w);
let encounterTick=1;for(const row of edges.encounters)for(let repeat=0;repeat<row.repeat;repeat++){
 const tick=encounterTick++,input={id:w.creatures[0].id,kind:row.kind,other:row.other,tick};
 await check('encounter '+row.kind+' '+tick,'identity.encounter',input,()=>{identity.encounter(w.creatures[0],row.kind,row.other,tick);return null;});
}
await check('bounded encounters and bonds','snapshot',{},()=>w);
for(const value of edges.numericInputs)await check('numeric string '+JSON.stringify(value),'state.clamp',{v:value,lo:-100,hi:100},()=>state.clamp(value,-100,100));
const careWorld=namedColony();for(const [i,needs] of edges.healthNeeds.entries())for(const [j,key] of ['fed','clean','amused'].entries())careWorld.creatures[i][key]=needs[j];
await check('specific care warnings','state.colonyHealth',{world:careWorld},()=>health.colonyHealth(careWorld));
await check('empty colony health','state.colonyHealth',{world:state.createWorld({empty:true})},()=>health.colonyHealth(state.createWorld({empty:true})));
for(const rescue of [false,true])await check('snapshot care recovery '+rescue,'state.recoverSnapshot',{raw:careWorld,rescue},()=>{const next=state.migrateWorld(careWorld);if(rescue){for(const c of next.creatures){for(const key of ['fed','clean','amused'])c[key]=Math.max(70,c[key]);c.deadTime=0;c.target=null;c.task='idle';c.work=0;}state.remember(next,'recovery','You restored this world with fresh food, a wash and time to play.');}return next;});
await check('recovery leaves active colony intact','snapshot',{},()=>w);
await check('world import alias','state.migrateWorld',{world:careWorld},()=>state.migrateWorld(careWorld));
for(const scenario of edges.saveCases){
 const raw=mergeInput(namedColony(),scenario.patch);
 raw.objects=clone(scenario.objects);for(const [i,patch] of scenario.creaturePatches.entries())mergeInput(raw.creatures[i],patch);
 await check('save '+scenario.name,'state.migrateWorld',{raw},()=>state.migrateWorld(raw));
 await check('save query preserves active colony','snapshot',{},()=>w);
}
const overflow=namedColony(),template=clone(overflow.creatures[0]);overflow.creatures=Array.from({length:edges.overflowCount},(_,i)=>({...clone(template),id:`c${i+1}`,birthOrdinal:i,x:18+i%32,y:18+Math.floor(i/32)}));
overflow.creatures.push({...clone(template),id:'c1'},{...clone(template),id:'invalid'});
await check('surface capacity overflow preserves valid unique population','state.migrateWorld',{raw:overflow},()=>state.migrateWorld(overflow));
await check('overflow query leaves active colony intact','snapshot',{},()=>w);
const implicitEvents=[{kind:'recovery',tick:81,message:'A safe return'},{kind:'goal-complete',tick:90,message:'A path to the quarry'},{kind:'play',tick:92,message:'A moment together'}];
await check('compact authoritative memory','memory.compactEvents',{events:implicitEvents},()=>{memory.compactEvents(w.memory,implicitEvents);return w.memory;});
await check('authoritative compaction snapshot','snapshot',{},()=>w);
for(const [i,action] of edges.conversationTerminations.entries()){
 const id=`termination-${i}`,text='Can we clear this path?';ids=[id];idAt=0;
 await check('pending command for '+action,'memory.beginCommand',{id,text,channel:'typed',listener:'c1'},()=>memory.beginCommand(w,text,'typed','c1'));
 for(let attempt=0;attempt<2;attempt++)await check('conversation '+action+' attempt '+attempt,'conversation.'+action,{id},()=>{const c=w.memory.commands.find(c=>c.id===id&&c.status==='pending');if(c){c.status=action==='cancel'?'cancelled':'failed';if(action==='fail')c.reply='The colony could not reply. You can try again.';w.revision++;}return null;});
}
await check('cancelled and failed commands snapshot','snapshot',{},()=>w);
// The worker-only completion envelope now carries the revision checked by the
// browser. Validate rejection before the original source composition could run.
for(const scenario of edges.completionRevisions){
 w=namedColony();w.commandRevision=4;await load(w);
 const id='revision-'+scenario.name,text='Stop work and gather 40 wood';ids=[id];idAt=0;
 await check('begin guarded completion '+scenario.name,'memory.beginCommand',{id,text,channel:'typed',listener:'c1'},()=>memory.beginCommand(w,text,'typed','c1'));
 const input={id,text,target:'c1',answer:{reply:'We will gather timber.',source:'Laya',goal:{kind:'wood',target:40},constraints:{changes:{pauseWork:true}}}};
 if(Object.hasOwn(scenario,'expectedCommandRevision'))input.expectedCommandRevision=scenario.expectedCommandRevision;
 await check('reject completion revision '+scenario.name,'conversation.complete',input,()=>{if(typeof input.expectedCommandRevision!=='number'||input.expectedCommandRevision!==w.commandRevision)throw new Error('The colony changed while listening. Please try again.');throw new Error('Invalid rejection workflow input');});
 await check('rejected completion has no mutations '+scenario.name,'snapshot',{},()=>w);
 await check('keep rejected words for retry '+scenario.name,'conversation.fail',{id},()=>{const c=w.memory.commands.find(c=>c.id===id&&c.status==='pending');if(c){c.status='failed';c.reply='The colony could not reply. You can try again.';w.revision++;}return null;});
 await check('failed guarded command snapshot '+scenario.name,'snapshot',{},()=>w);
}
// Each side consumes its own outputs after a JSON wire round trip. In
// particular, do not reload after the first completion: Rust's incremented
// revision stays an internal float while the next JS request encodes an integer.
w=fixtures.groundFixture(25);await load(w);
let wireWorld=await check('conversation wire initial snapshot','snapshot',{},()=>w);
for(const scenario of edges.roundTripCommands){
 const sourceTarget=w.creatures[0].id,wireTarget=wireWorld.creatures[0].id,{id,text}=scenario;ids=[id];idAt=0;
 await check('conversation wire begin '+id,'conversation.begin',{id,text,channel:'typed',target:sourceTarget},()=>{const constraint=commands.parseConstraints(w,text,sourceTarget),target=constraint.listener||sourceTarget;const command=memory.beginCommand(w,text,'typed',target);state.remember(w,'command',text,target);return {command,target};},{id,text,channel:'typed',target:wireTarget});
 let sourceConstraints;const wireConstraints=await check('conversation wire constraints '+id,'commands.parseConstraints',{text,listener:sourceTarget},()=>sourceConstraints=commands.parseConstraints(w,text,sourceTarget),{text,listener:wireTarget});
 const answer={goal:scenario.goal,source:scenario.source,reply:scenario.reply,constraints:sourceConstraints};
 const input={id,text,target:sourceTarget,answer,expectedCommandRevision:w.commandRevision};
 const wireInput={id,text,target:wireTarget,answer:{...answer,constraints:wireConstraints},expectedCommandRevision:wireWorld.commandRevision};
 await check('conversation wire completion '+id,'conversation.complete',input,()=>completeReference(w,input),wireInput);
 wireWorld=await check('conversation wire result '+id,'snapshot',{},()=>w);
}
w=namedColony();w.population=25;await load(w);
await check('independence request before ready','community.offerIndependence',{},()=>{community.offerIndependence(w);return null;});
await check('open inbox marks messages read','community.openInbox',{},()=>{story.collectStoryMessages(w);for(const m of w.community.inbox){m.read=true;m.notified=true;}w.revision++;return null;});
for(const notify of [false,true])await check('intelligence becomes ready '+notify,'community.update',{becameReady:true,notify},()=>{story.collectStoryMessages(w);if(w.community.consent==='offered'){const m=w.community.inbox.find(m=>m.key==='independence'&&m.read);if(m){m.key='independence-ready';m.title='Now we can think together';m.read=false;m.notified=false;w.revision++;}}return notify?community.nextNotice(w):null;});
for(const answer of edges.storyAnswers){
 w.story.queue=[answer.id];await load(w);
 await check('collect decision '+answer.id,'story.collect',{},()=>{story.collectStoryMessages(w);return null;});
 await check('answer inbox decision '+answer.id,'community.answerStory',answer,()=>{w.story.active=answer.id;story.answerStory(w,answer.response);const m=w.community.inbox.find(m=>m.story===answer.id);if(m){m.story=null;m.read=true;m.responseRequired=false;}return null;});
 await check('inbox decision snapshot','snapshot',{},()=>w);
}
for(const message of ['Laya interpreted a lasting goal: Gather 40 wood','We chose a new garden']){
 w.memory.conversations=[];w.memory.recent=[{kind:'goal',message}];await load(w);
 await check('recall lasting goal '+message,'conversation.localReply',{intent:'memory',listener:null},()=>conversation.localReply(w,'memory',null));
}

let h=null,prev=null;for(let i=0;i<fixture.timelineFrames;i++){const record={schema:4,time:i,population:1,unknown:{kept:true},savedAt:'time-'+i,creatures:[{id:'c1',x:i}],memory:{commands:[]}};ids=Array.from({length:8},(_,j)=>`history-${i}-${j}`);idAt=0;let sourceNext;await check('timeline '+i,'timeline.append',{history:h,previous:prev,record,replacement:false,ids},()=>sourceNext=timeline.appendTimeline(h,prev,record));h=sourceNext;prev=record;}
for(let i=0;i<6;i++){
 const record={...prev,time:i,population:i+3,newNullable:null,savedAt:'branch-'+i};ids=Array.from({length:8},(_,j)=>`branch-${i}-${j}`);idAt=0;let sourceNext;
 await check('timeline rewind '+i,'timeline.append',{history:h,previous:prev,record,replacement:{origin:{id:'old-'+i}},ids},()=>sourceNext=timeline.appendTimeline(h,prev,record,{origin:{id:'old-'+i}}));h=sourceNext;prev=record;
}
await check('timeline bytes','timeline.size',{history:h},()=>timeline.historySize(h));
await check('history missing moment','timeline.readMoment',{branch:h.branches.at(-1),id:'missing'},()=>timeline.readMoment(h.branches.at(-1),'missing'));
await check('timeline latest','timeline.latestWorld',{branch:h.branches.at(-1)},()=>timeline.latestWorld(h.branches.at(-1)));
child.stdin.end();mkdirSync(join(root,'artifacts/migration'),{recursive:true});writeFileSync(join(root,'artifacts/migration/state-parity.json'),JSON.stringify({passed,failed,errors},null,2));console.log(JSON.stringify({passed,failed,errors:errors.slice(0,15)},null,2));if(failed)process.exitCode=1;
