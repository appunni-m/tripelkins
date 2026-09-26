import test from 'node:test';
import assert from 'node:assert/strict';
import { EngineClient } from '../src/engine/client.js';

const world = (time = 0) => ({time,ui:{x:24,y:24,paused:false},settings:{provider:'laya'},creatures:[{id:'c1',x:time}]});
function harness(t,options={}) {
  const OriginalWorker=globalThis.Worker;
  class FakeWorker {
    sent=[];terminated=false;throwOnPost=false;
    postMessage(message){if(this.throwOnPost)throw new Error('Cannot clone message');this.sent.push(structuredClone(message));}
    terminate(){this.terminated=true;}
    emit(message){this.onmessage?.({data:{protocol:1,generation:0,...message}});}
  }
  globalThis.Worker=FakeWorker;
  const client=new EngineClient(options),worker=client.worker;
  t.after(()=>{client.dispose();globalThis.Worker=OriginalWorker;});
  async function initialize(){const pending=client.initialize({preview:true});worker.emit({kind:'reply',id:worker.sent.at(-1).id,state:world(),result:true});await pending;}
  return {client,worker,initialize};
}

test('engine frames keep world identity and locally controlled presentation',async t=>{
  const {client,worker,initialize}=harness(t);await initialize();const initial=client.world;client.world.ui.x=91;client.world.settings.provider='openrouter';
  worker.emit({kind:'frame',state:world(2)});
  assert.equal(client.world,initial);assert.equal(client.world.time,2);assert.equal(client.world.creatures[0].x,2);assert.equal(client.world.ui.x,91);assert.equal(client.world.settings.provider,'openrouter');assert.equal(worker.sent.at(-1).kind,'ack');
});

test('compact presentation frames update motion while preserving resident identity data',async t=>{
  const {client,worker,initialize}=harness(t);await initialize();
  Object.assign(client.world.creatures[0],{name:'Pip',traits:{curiosity:.7},encounters:[{kind:'arrival'}],x:1,task:'rest'});
  client.world.discovery={revision:4,cells:{'1:1':15}};
  const resident=client.world.creatures[0];
  worker.emit({kind:'frame',frame:{time:2,creatures:[{id:'c1',x:9,task:'gather'}]}});
  assert.equal(client.world.creatures[0],resident);
  assert.equal(resident.name,'Pip');assert.deepEqual(resident.traits,{curiosity:.7});
  assert.deepEqual(resident.encounters,[{kind:'arrival'}]);assert.equal(resident.x,9);assert.equal(resident.task,'gather');
  assert.deepEqual(client.world.discovery,{revision:4,cells:{'1:1':15}});
  assert.equal(client.world.time,2);assert.equal(worker.sent.at(-1).kind,'ack');
});

test('presentation backpressure keeps only the latest unsent camera state',async t=>{
  const {client,worker,initialize}=harness(t);await initialize();const count=worker.sent.length;
  for(const x of [1,2,3])client.updatePresentation({paused:false,ui:{x},settings:{provider:'laya'}});
  assert.equal(worker.sent.length,count+1);assert.equal(worker.sent.at(-1).ui.x,1);
  worker.emit({kind:'presentationAck'});assert.equal(worker.sent.length,count+2);assert.equal(worker.sent.at(-1).ui.x,3);
  worker.emit({kind:'presentationAck'});assert.equal(worker.sent.length,count+2);
});

test('restore creates a new identity and ignores previous generation frames',async t=>{
  const {client,worker,initialize}=harness(t);await initialize();const initial=client.world;
  const restoring=client.replace(world(8));const request=worker.sent.at(-1);worker.emit({kind:'reply',id:request.id,result:world(8)});
  await Promise.resolve();await Promise.resolve();const adoption=worker.sent.at(-1);assert.equal(adoption.kind,'adoptGeneration');assert.equal(adoption.generation,1);
  worker.emit({kind:'reply',generation:1,id:adoption.id,result:true});await restoring;
  assert.notEqual(client.world,initial);assert.equal(client.world.time,8);worker.emit({kind:'frame',generation:0,state:world(99)});assert.equal(client.world.time,8);
});

test('a stale failure cannot stop a successfully restored generation',async t=>{
  const {client,worker,initialize}=harness(t);await initialize();client.generation=1;
  worker.emit({kind:'failure',generation:0,error:'Old world failure'});
  assert.equal(client.failed,null);assert.equal(worker.terminated,false);
});

test('fatal protocol failure stops simulation and rejects pending work',async t=>{
  const {client,worker,initialize}=harness(t);await initialize();const pending=client.query('snapshot').catch(e=>e);
  worker.emit({protocol:2,kind:'frame',state:world(3)});
  assert.match((await pending).message,/protocol/i);assert.equal(worker.terminated,true);assert.equal(client.pending.size,0);
});

test('late state is ignored after a fatal transport failure',async t=>{
  const {client,worker,initialize}=harness(t);await initialize();client.fail(new Error('Transport broke'));
  worker.emit({kind:'frame',state:world(99)});assert.equal(client.world.time,0);
});

test('bounded request queue refuses overflow and clears all waiters on disposal',async t=>{
  const {client,worker,initialize}=harness(t);await initialize();const pending=Array.from({length:64},()=>client.query('snapshot').catch(e=>e));
  await assert.rejects(client.query('snapshot'),/catching up/);client.dispose();await Promise.all(pending);assert.equal(client.pending.size,0);assert.equal(worker.terminated,true);
});

test('postMessage failure clears the pending request immediately',async t=>{
  const {client,worker,initialize}=harness(t);await initialize();worker.throwOnPost=true;
  await assert.rejects(client.query('snapshot'),/Cannot clone/);assert.equal(client.pending.size,0);
});

test('an uncertain mutating timeout stops the worker instead of silently continuing',async t=>{
  const {client,worker,initialize}=harness(t);await initialize();
  await assert.rejects(client.send('command',{operation:'state.random',input:{}},5),/timed out|uncertain/i);
  assert.ok(client.failed);assert.equal(worker.terminated,true);
});

test('restore rejects pending work from the previous world',async t=>{
  const {client,worker,initialize}=harness(t);await initialize();
  const oldCommand=client.command('community.postMessage',{text:'old world'}).catch(e=>e);
  const oldId=worker.sent.at(-1).id;
  const restoring=client.replace(world(12));worker.emit({kind:'reply',id:worker.sent.at(-1).id,result:world(12)});
  await Promise.resolve();await Promise.resolve();const adoption=worker.sent.at(-1);
  assert.match((await oldCommand).message,/different saved world/);
  worker.emit({kind:'reply',generation:0,id:oldId,state:world(900),result:true});
  worker.emit({kind:'reply',generation:1,id:adoption.id,result:true});await restoring;
  assert.equal(client.world.time,12);assert.equal(client.pending.size,0);
});

test('worker UI patches apply without losing local camera and settings',async t=>{
  const {client,worker,initialize}=harness(t);await initialize();client.world.ui.x=91;client.world.settings.provider='openrouter';
  const pending=client.command('story.answerStory',{response:'yes'});const id=worker.sent.at(-1).id;
  worker.emit({kind:'reply',id,state:world(3),uiPatch:{paused:true,selected:'c2'},result:true});await pending;
  assert.equal(client.world.ui.x,91);assert.equal(client.world.ui.paused,true);assert.equal(client.world.ui.selected,'c2');assert.equal(client.world.settings.provider,'openrouter');
});

test('an uncertain restore timeout explains how to recover the committed save',async t=>{
  const {client,worker,initialize}=harness(t);await initialize();
  await assert.rejects(client.send('storage',{operation:'replace',input:{}},5),/Reload to see which saved world was committed/);
  assert.ok(client.failed);assert.equal(worker.terminated,true);
});

test('a generation adoption timeout stops the worker after committed restore',async t=>{
  const {client,worker,initialize}=harness(t);await initialize();
  await assert.rejects(client.send('adoptGeneration',{},5),/timed out/);
  assert.ok(client.failed);assert.equal(worker.terminated,true);
});
