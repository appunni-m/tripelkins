import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const world=(time=0)=>({time,ui:{paused:false,x:24,y:24},settings:{},creatures:[],objects:[]});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function workerHarness(file='worker.js'){
  const messages=[],planners=[],engines=[],timers=new Map(),intervals=[];let timerId=0,now=1;
  class FakeEngine {
    constructor(snapshot){this.world=JSON.parse(snapshot);engines.push(this);}
    snapshot(){return JSON.stringify(this.world);}
    free(){this.freed=true;}
    dispatch(operation,encoded){
      if(this.freed)throw new Error('Engine already freed');
      const input=JSON.parse(encoded);
      if(operation==='planning.ui')return '{}';
      if(operation==='state.createWorld')return JSON.stringify(world());
      if(operation==='state.migrateWorld')return JSON.stringify(input.raw);
      if(operation==='clock'||operation==='diagnostics.workerTick')return 'null';
      if(operation==='presentation'){
        if(input.ui)Object.assign(this.world.ui,input.ui);
        if(input.settings)this.world.settings=input.settings;
        return 'null';
      }
      if(operation==='simulation.stepWorld'){this.world.time+=input.dt;return 'null';}
      if(operation==='throws')throw new Error('Query failed');
      if(operation==='planning.commitDecision'||operation==='settlement.commitDecision'){this.world.committed=true;return 'true';}
      return JSON.stringify({time:this.world.time,operation,input});
    }
  }
  class FakePlanner {
    sent=[];terminated=false;throwOnPost=false;
    constructor(){planners.push(this);}
    postMessage(message){if(this.throwOnPost)throw new Error('Planner could not clone request');this.sent.push(structuredClone(message));}
    terminate(){this.terminated=true;}
    emit(message){this.onmessage?.({data:message});}
  }
  const storage={saveHealth:{},configurePersistence(){},loadWorld:async()=>null,saveWorld:async()=>true};
  const self={postMessage(message){messages.push(structuredClone(message));}};
  const source=readFileSync(new URL('../src/engine/'+file,import.meta.url),'utf8')
    .replace(/^import .*;\n/gm,'').replaceAll('import.meta.url',JSON.stringify(new URL('../src/engine/'+file,import.meta.url).href));
  const context={Engine:FakeEngine,init:async()=>{},wasmUrl:'mock.wasm',storage,self,Worker:FakePlanner,URL,Date,JSON,Promise,Map,Set,Number,Error,performance:{now:()=>now},crypto:{getRandomValues(array){array.fill(18492);return array;},randomUUID:()=> 'fixed-id'},setInterval(callback){intervals.push(callback);},setTimeout(callback,ms){timers.set(++timerId,{callback,ms});return timerId;},clearTimeout(id){timers.delete(id);}};
  vm.runInNewContext(source,context,{filename:file});
  async function deliver(data){self.onmessage({data:{protocol:1,generation:0,...data}});await flush();}
  async function initialize(options={}){await deliver({kind:'initialize',id:1,preview:true,world:world(),...options});}
  return {messages,planners,engines,timers,intervals,deliver,initialize,storage,setNow(value){now=value;}};
}

test('planning runs on a snapshot while authoritative simulation keeps ticking',async()=>{
  const h=workerHarness();await h.initialize();
  await h.deliver({kind:'presentation',paused:false});
  await h.deliver({kind:'query',id:2,operation:'planning.makePlan',input:{policy:'care'}});
  assert.equal(h.planners.length,1);assert.equal(JSON.parse(h.planners[0].sent[0].snapshot).time,0);
  h.intervals[0]();await flush();assert.equal(h.engines.at(-1).world.time,0.1);
  const request=h.planners[0].sent[0];h.planners[0].emit({...request,result:{assignments:[]}});
  assert.ok(h.messages.some(m=>m.id===2&&m.result));assert.equal(h.engines.at(-1).world.time,0.1);assert.equal(h.timers.size,0);
});

test('planning queue is bounded while commands remain available',async()=>{
  const h=workerHarness();await h.initialize();
  for(let id=2;id<=10;id++)await h.deliver({kind:'query',id,operation:'planning.makePlan',input:{}});
  assert.equal(h.planners[0].sent.length,8);assert.match(h.messages.find(m=>m.id===10)?.error??'',/several plans/);
  await h.deliver({kind:'command',id:11,operation:'query-command',input:{}});
  assert.ok(h.messages.find(m=>m.id===11)?.result);
});

test('restore cancels planner requests and gates queued old-world commands',async()=>{
  const h=workerHarness();await h.initialize();
  await h.deliver({kind:'query',id:2,operation:'planning.makePlan',input:{}});
  const old=h.planners[0];await h.deliver({kind:'storage',id:3,operation:'replace',input:{next:world(42)}});
  assert.equal(old.terminated,true);assert.match(h.messages.find(m=>m.id===2)?.error??'',/different saved world/);assert.equal(h.timers.size,0);
  await h.deliver({kind:'command',id:4,operation:'planning.commitDecision',input:{}});
  assert.match(h.messages.find(m=>m.id===4)?.error??'',/different saved world/);assert.equal(h.engines.at(-1).world.committed,undefined);
  await h.deliver({kind:'adoptGeneration',id:5,generation:1});
  old.emit({id:2,generation:0,result:{stale:true}});
  assert.equal(h.messages.filter(m=>m.id===2).length,1);
});

test('late failure from retired planner cannot terminate the replacement planner',async()=>{
  const h=workerHarness();await h.initialize();
  await h.deliver({kind:'query',id:2,operation:'planning.makePlan',input:{}});const old=h.planners[0];
  await h.deliver({kind:'storage',id:3,operation:'replace',input:{next:world(42)}});
  await h.deliver({kind:'adoptGeneration',id:4,generation:1});
  await h.deliver({kind:'query',id:5,generation:1,operation:'planning.makePlan',input:{}});const current=h.planners[1];
  old.onerror({message:'Late error from retired planner'});
  assert.equal(current.terminated,false);assert.equal(h.messages.some(m=>m.id===5),false);
});

test('hung planning has a parent-worker deadline and can restart after timeout',async()=>{
  const h=workerHarness();await h.initialize();
  await h.deliver({kind:'query',id:2,operation:'planning.makePlan',input:{}});
  assert.ok(h.timers.size>0,'planner requests need deadlines independent of the busy planner');
  const pending=[...h.timers.values()][0];assert.ok(pending.ms<120000);pending.callback();await flush();
  assert.equal(h.planners[0].terminated,true);assert.ok(h.messages.find(m=>m.id===2)?.error);
  assert.equal(h.timers.size,0);
  await h.deliver({kind:'query',id:3,operation:'planning.makePlan',input:{}});assert.equal(h.planners.length,2);
});

test('paused game refuses late autonomous decision commits',async()=>{
  const h=workerHarness();await h.initialize();
  for(const operation of ['planning.commitDecision','settlement.commitDecision']){
    await h.deliver({kind:'command',id:h.messages.length+1,operation,input:{}});
    assert.equal(h.messages.at(-1).result,false);assert.equal(h.engines.at(-1).world.committed,undefined);
  }
});

test('query worker frees each snapshot engine and continues after an error',async()=>{
  const h=workerHarness('query-worker.js');
  await h.deliver({id:2,snapshot:JSON.stringify(world(13)),iso:'2000-01-01T00:00:00.000Z',operation:'throws',input:{}});
  await h.deliver({id:3,snapshot:JSON.stringify(world(19)),iso:'2000-01-01T00:00:00.000Z',operation:'planning.makePlan',input:{}});
  assert.match(h.messages.find(m=>m.id===2)?.error??'',/Query failed/);
  assert.equal(h.messages.find(m=>m.id===3)?.result.time,19);assert.ok(h.engines.every(engine=>engine.freed));
});


test('planner postMessage failure releases request slots and deadlines',async()=>{
  const h=workerHarness();await h.initialize();
  await h.deliver({kind:'query',id:2,operation:'planning.makePlan',input:{}});
  const planner=h.planners[0];planner.emit({...planner.sent[0],result:{}});planner.throwOnPost=true;
  for(let id=3;id<13;id++){
    await h.deliver({kind:'query',id,operation:'planning.makePlan',input:{}});
    assert.match(h.messages.find(m=>m.id===id)?.error??'',/clone request/);assert.equal(h.timers.size,0);
  }
});


test('autosave quota failure retains the live world for export and retry',async()=>{
  const h=workerHarness();await h.initialize({preview:false});
  h.storage.saveWorld=async()=>{h.storage.saveHealth.error='Storage quota exceeded';h.storage.saveHealth.status='Storage full — export your world';throw new Error('Storage quota exceeded');};
  await h.deliver({kind:'presentation',paused:false});h.setNow(6001);h.intervals[0]();await flush();
  assert.equal(h.messages.some(m=>m.kind==='failure'),false,'storage failure must not terminate the engine needed for export');
  assert.ok(h.messages.some(m=>m.health?.error==='Storage quota exceeded'));
  await h.deliver({kind:'storage',id:2,operation:'export',input:{}});assert.equal(h.messages.find(m=>m.id===2)?.result.time,0.1);
  h.storage.saveWorld=async()=>{h.storage.saveHealth.error=null;return true;};
  h.setNow(12001);h.intervals[0]();await flush();assert.equal(h.engines.at(-1).world.time,0.2);
});

test('autosave conflict pauses the writer and preserves export',async()=>{
  const h=workerHarness();await h.initialize({preview:false});
  h.storage.saveWorld=async()=>{h.storage.saveHealth.error='Newer world in another tab';h.storage.saveHealth.conflict=true;throw new Error('Newer world in another tab');};
  await h.deliver({kind:'presentation',paused:false});h.setNow(6001);h.intervals[0]();await flush();
  assert.equal(h.messages.some(m=>m.kind==='failure'),false);assert.equal(h.engines.at(-1).world.time,0.1);
  h.setNow(12001);h.intervals[0]();await flush();assert.equal(h.engines.at(-1).world.time,0.1);
  await h.deliver({kind:'storage',id:2,operation:'export',input:{}});assert.equal(h.messages.find(m=>m.id===2)?.result.time,0.1);
});
