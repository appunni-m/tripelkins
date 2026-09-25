import test from 'node:test';
import assert from 'node:assert/strict';
import {rustPlanner} from '../src/engine/planner.js';
import {configurePlanner, converse} from '../src/brain.js';

const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};

test('planner refreshes candidates before recording a revision-guarded decision',async()=>{
  const world={commandRevision:7},calls=[];
  const engine={world,query:async(operation,input,options)=>{
    calls.push({operation,input,options});
    return operation==='planning.feasiblePlans'?[{id:'care'}]:{policy:'care'};
  }};
  assert.deepEqual(await rustPlanner(engine).selectPlan(world,'care','Laya'),{policy:'care'});
  assert.deepEqual(calls.map(c=>c.operation),['planning.feasiblePlans','planning.selectPlan']);
  assert.equal(calls[1].input.expectedCommandRevision,7);
  assert.deepEqual(calls[1].input.initial,[{id:'care'}]);
});

test('a newer command during candidate preparation cannot record the old decision',async()=>{
  const world={commandRevision:7},wait=deferred(),calls=[];
  const engine={world,query:(operation)=>{calls.push(operation);return wait.promise;}};
  const result=rustPlanner(engine).selectPlan(world,'care','Laya');
  world.commandRevision++;
  wait.resolve([{id:'care'}]);
  await assert.rejects(result,/changed while planning/);
  assert.deepEqual(calls,['planning.feasiblePlans']);
});

test('a preview planner keeps both preparation and recording on its snapshot',async()=>{
  const preview={commandRevision:2},calls=[];
  const engine={world:{commandRevision:7},query:async(operation,input,options)=>{
    calls.push(options);return operation==='planning.feasiblePlans'?[]:{};
  }};
  await rustPlanner(engine).selectPlan(preview,'care','Laya');
  assert.ok(calls.every(c=>c.snapshot===preview));
});

test('conversation rejects a command change while its final reply is being assembled',async()=>{
  const world={commandRevision:3,settings:{}},wait=deferred();
  configurePlanner({parseConstraints:async()=>({question:true,listener:null}),informationReply:()=>wait.promise});
  const result=converse(world,'How are you?',null,null,new AbortController().signal);
  await Promise.resolve();await Promise.resolve();
  world.commandRevision++;
  wait.resolve('We are feeling better.');
  await assert.rejects(result,/changed while listening/);
});

test('conversation returns the revision of the context it actually used',async()=>{
  const world={commandRevision:3,settings:{}};
  configurePlanner({parseConstraints:async()=>({question:true,listener:null}),informationReply:async()=> 'We are feeling better.'});
  const result=await converse(world,'How are you?',null,null,new AbortController().signal);
  assert.equal(result.revision,3);
  assert.equal(result.reply,'We are feeling better.');
});
