import init, { Engine } from '../../engine/pkg/tripelkins_engine.js';
import wasmUrl from '../../engine/pkg/tripelkins_engine_bg.wasm?url';
import * as storage from '../persistence.js';
import { BackgroundSchedule } from './background-schedule.js';

let engine, generation=0, awaitingGeneration=null, paused=true, initialized=false, preview=false,
  framePending=false, tickQueued=false, lastSaveAt=0, lastViewAt=-Infinity, views=null, tail=Promise.resolve();
const initializedWasm=init({module_or_path:wasmUrl});
const scheduler = new BackgroundSchedule({
  enqueue:operation=>{tail=tail.then(operation).catch(error=>scheduler.fail(error));},
  snapshot:()=>engine.snapshot(),
  commit:(schedule,sourceGeneration)=>{
    if(paused || sourceGeneration!==generation || awaitingGeneration!==null)return false;
    return call('planning.commitSchedule',{schedule});
  },
  // A failed helper falls back to the existing synchronous rule path. Movement
  // and saving remain available even if a browser cannot start another worker.
  failed:error=>console.warn('Using synchronous colony scheduling:',error.message),
});
// Only pure planning queries may leave the authoritative command queue.
// selectPlan records a decision, so it deliberately stays on this worker.
const planningQueries=new Set(['planning.buildContext','planning.context','planning.makePlan','planning.feasiblePlans',
  'settlement.decisionChoices','settlement.decisionInput','settlement.context','settlement.currentChoice']);
let planner=null;
const planningPending=new Map();
function stopPlanner(reason){
  planner?.terminate();planner=null;
  const requests=[...planningPending.values()];planningPending.clear();
  for(const request of requests){
    clearTimeout(request.timer);
    send({kind:'reply',id:request.id,generation:request.generation,error:reason});
  }
}
function plan(message){
  if(planningPending.size>=8)throw new Error('The colony is already considering several plans. Please try again shortly.');
  if(!planner){
    const current=planner=new Worker(new URL('./query-worker.js',import.meta.url),{type:'module'});
    current.onmessage=({data})=>{
      if(current!==planner)return;
      const request=planningPending.get(data.id);
      if(!request || request.generation!==data.generation)return;
      clearTimeout(request.timer);planningPending.delete(data.id);
      send({kind:'reply',id:data.id,generation:data.generation,result:data.result,error:data.error});
    };
    current.onerror=event=>{
      if(current===planner)stopPlanner(event.message||'Planning stopped. The colony can continue using its instincts.');
    };
    current.onmessageerror=()=>{
      if(current===planner)stopPlanner('A colony plan could not be read. Please try again.');
    };
  }
  const request={id:message.id,generation};
  request.timer=setTimeout(()=>{
    if(planningPending.get(message.id)===request)
      stopPlanner('Planning took too long. The colony can keep going and try a new plan.');
  },90000);
  planningPending.set(message.id,request);
  try{planner.postMessage({id:message.id,generation,operation:message.operation,input:message.input,
    snapshot:message.snapshot?JSON.stringify(message.snapshot):engine.snapshot(),iso:new Date().toISOString()});}
  catch(error){clearTimeout(request.timer);planningPending.delete(message.id);throw error;}
}

const call=(operation,input={})=>JSON.parse(engine.dispatch(operation,JSON.stringify(input)));
const state=()=>JSON.parse(engine.snapshot());
const clock=()=>call('clock',{iso:new Date().toISOString()});
function health(){return {...storage.saveHealth,...(preview?{status:'Preview · progress is not saved'}:{})};}
function send(data){self.postMessage({protocol:1,generation,...data,health:health()});}
function viewState(force=false){if(force || performance.now()-lastViewAt>=400){views=call('planning.ui');lastViewAt=performance.now();}return views;}
function publish(){if(framePending || !initialized)return;framePending=true;send({kind:'frame',state:state(),views:viewState()});}
function syncPresentation(data){
  if(data.ui || data.settings)call('presentation',{ui:data.ui,settings:data.settings,
    intelligenceAvailable:data.intelligenceAvailable,growth:data.growth});
  if(typeof data.paused==='boolean'){
    if(data.paused && !paused)scheduler.invalidate();
    paused=data.paused;
  }
}
function configureStorage(){
  storage.configurePersistence({
    migrateWorld:raw=>call('state.migrateWorld',{raw}),
    colonyHealth:world=>call('state.colonyHealth',{world}),
    interruptCommands:world=>call('memory.interruptSnapshot',{world}),
    appendTimeline:(history,previous,record,replacement)=>call('timeline.append',{history:history??null,previous:previous??null,record,replacement:replacement??false,ids:Array.from({length:8},()=>crypto.randomUUID())}),
    readMoment:(branch,id)=>call('timeline.readMoment',{branch,id}),
    historySize:history=>call('timeline.size',{history}),
  });
}
async function operate(message){
  if(message.protocol!==1 || !Number.isSafeInteger(message.generation) || !['initialize','adoptGeneration','ack','presentation','query','command','storage'].includes(message.kind))throw new Error('Unsupported colony worker protocol.');
  if(message.kind==='initialize'){
    await initializedWasm;
    engine=new Engine('{}');configureStorage();clock();
    preview=!!message.preview;
    let world=message.world || (!preview && await storage.loadWorld());
    if(!world)world=call('state.createWorld',{empty:false,seed:crypto.getRandomValues(new Uint32Array(1))[0]});
    engine.free();engine=new Engine(JSON.stringify(world));clock();
    initialized=true;paused=true;lastSaveAt=performance.now();
    send({kind:'reply',id:message.id,state:state(),views:viewState(true),result:true});return;
  }
  if(message.kind==='adoptGeneration'){
    if(awaitingGeneration!==message.generation)throw new Error('The restored world generation was not expected.');
    generation=awaitingGeneration;awaitingGeneration=null;framePending=false;
    send({kind:'reply',id:message.id,views:viewState(true),result:true});return;
  }
  if(awaitingGeneration!==null){
    if(message.id)send({kind:'reply',id:message.id,error:'A different saved world was opened.'});
    return;
  }
  if(message.generation!==generation)return;
  if(message.kind==='ack'){framePending=false;return;}
  if(!initialized)throw new Error('The colony engine is still starting.');
  if(message.kind==='presentation'){syncPresentation(message);send({kind:'presentationAck'});return;}
  clock();syncPresentation(message);
  let result, uiPatch;
  if(message.kind==='query'){
    if(planningQueries.has(message.operation)){plan(message);return;}
    if(message.snapshot){const copy=new Engine(JSON.stringify(message.snapshot));try{copy.dispatch('clock',JSON.stringify({iso:new Date().toISOString()}));result=JSON.parse(copy.dispatch(message.operation,JSON.stringify(message.input)));}finally{copy.free();}}
    else result=call(message.operation,message.input);
  }else if(message.kind==='command'){
    const before=state().ui;
    result=paused && ['planning.commitDecision','settlement.commitDecision'].includes(message.operation)
      ? false : call(message.operation,message.input);
    // An AI schedule takes precedence over an automatic proposal already in
    // flight. The next proposal uses the newly chosen policy and commitments.
    if(result!==false && ['planning.commitDecision','planning.reschedule','planning.applyPlan','jobs.applyPlan'].includes(message.operation))scheduler.invalidate();
    const after=state().ui;uiPatch={};
    for(const key of new Set([...Object.keys(before),...Object.keys(after)]))if(JSON.stringify(before[key])!==JSON.stringify(after[key]))uiPatch[key]=after[key]??null;
  }else if(message.kind==='storage'){
    const args=message.input;
    switch(message.operation){
      case 'save':result=preview?true:await storage.saveWorld(state());break;
      case 'checkpoint':result=preview?true:await storage.checkpointWorld(state());break;
      case 'recoveries':result=await storage.listRecoveryWorlds();break;
      case 'history':result=await storage.listHistoryMoments();break;
      case 'recover':result=await storage.recoverMoment(args.branch,args.id);break;
      case 'estimate':result=await storage.estimateStorage();break;
      case 'export':result=call('state.migrateWorld',{raw:state()});break;
      case 'import':result=call('state.migrateWorld',{raw:args.world});break;
      case 'replace':{
        paused=true;
        result=preview?call('state.migrateWorld',{raw:args.next}):await storage.replaceWorld(state(),args.next,args.source,args.origin);
        result.ui.paused=true;
        stopPlanner('A different saved world was opened.');
        scheduler.reset();
        engine.free();engine=new Engine(JSON.stringify(result));clock();awaitingGeneration=generation+1;break;
      }
      default:throw new Error('Unknown storage operation.');
    }
  }else throw new Error('Unknown engine message.');
  send({kind:'reply',id:message.id,result,...(message.kind==='command'?{state:state(),views:viewState(true),uiPatch}:{})});
}
self.onmessage=({data})=>{
  tail=tail.then(()=>operate(data)).catch(error=>{
    if(data.id)send({kind:'reply',id:data.id,error:error.message||String(error)});
    else {paused=true;send({kind:'failure',error:error.message||String(error)});}
  });
};
setInterval(()=>{
  if(!initialized || paused || tickQueued)return;
  tickQueued=true;
  tail=tail.then(async()=>{
    if(paused)return;
    const start=performance.now();clock();
    const time=call(scheduler.disabled?'simulation.stepWorld':'simulation.stepLive',{dt:0.1});
    call('diagnostics.workerTick',{milliseconds:performance.now()-start});
    publish();
    if(!scheduler.disabled && typeof time==='number')scheduler.request(time,generation);
    if(!preview && performance.now()-lastSaveAt>=5000){
      lastSaveAt=performance.now();
      try{await storage.saveWorld(state());}
      catch(error){
        // Keep the authoritative world alive so a failed disk write can be
        // exported or retried. Simulation/codec faults still stop the engine.
        if(storage.saveHealth.error!==error.message && !storage.saveHealth.conflict)throw error;
        if(storage.saveHealth.conflict)paused=true;
        send({kind:'saveError',error:error.message||String(error)});
      }
    }
  }).catch(error=>{paused=true;send({kind:'failure',error:error.message||String(error)});}).finally(()=>{tickQueued=false;});
},100);
