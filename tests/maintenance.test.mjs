import test from "node:test";
import assert from "node:assert/strict";
import { createWorld, addCreature, addObject, migrateWorld } from "../src/game/state.js";
import { makePlan, applyPlan, stepWorld } from "../src/game/simulation.js";
import { pollute, maintainFactory } from "../src/game/resources.js";

function works() {
  const w=createWorld({empty:true});w.stage=2;w.progress.hatched=true;
  const factory=addObject(w,"factory",20,20);
  const c=addCreature(w,16,20);c.fed=c.clean=c.amused=90;
  w.runtime={growth:{held:true}};
  pollute(w,factory,80);
  return {w,c,factory};
}
test("healthy workers physically maintain pollution without creating resources or free care",()=>{
  const {w,c}=works(), before={...w.inventory};
  assert.equal(makePlan(w).assignments[0].task,"clean");
  for(let i=0;i<200;i++)stepWorld(w,.1);
  assert.ok(w.evidence.cleaned>0);
  assert.ok(w.progress.pollution<80);
  assert.ok(Math.abs(w.evidence.cleaned+w.progress.pollution-80)<1e-8);
  assert.ok(c.clean<90);
  assert.deepEqual(w.inventory,before);
  assert.ok(w.memory.activity.clean>0);
});
test("maintenance removes only the serviced zone and cannot go below zero",()=>{
  const {w,factory}=works(),other=addObject(w,"factory",30,30);pollute(w,other,80);
  assert.equal(maintainFactory(w,factory,500),80);
  assert.equal(w.progress.pollution,80);
  assert.equal(w.pollution.length,1);assert.equal(w.pollution[0].source,other.id);
  assert.equal(maintainFactory(w,other,-1),0);
});
test("sickness interrupts industrial commitment and saved maintenance survives restore",()=>{
  const {w,c}=works();
  assert.equal(applyPlan(w,makePlan(w)),true);
  const saved=migrateWorld(w);assert.equal(saved.creatures[0].task,"clean");
  assert.equal(saved.creatures[0].job.purpose,c.job.purpose);
  addObject(w,"bath",15,16);c.sickness=70;
  assert.equal(makePlan(w).assignments[0].task,"wash");
  c.sickness=0;w.settings.autonomy=false;c.job=null;c.task="idle";c.target=null;
  assert.notEqual(makePlan(w).assignments[0].task,"clean");
});
test("sick hungry workers address hunger before another wash",()=>{
  const {w,c}=works();addObject(w,"bath",15,16);addObject(w,"dwelling",12,20);
  c.fed=5;c.clean=98;c.sickness=70;
  assert.equal(makePlan(w).assignments[0].task,"home");
});

test("factual questions cannot change instructions or create work",async()=>{
  const {parseConstraints,commandInput}=await import('../src/game/commands.js');
  const {informationReply}=await import('../src/game/conversation.js');
  const w=createWorld({empty:true});w.inventory.ore=200;
  for(const text of ['How much ore do we have?','Why stop work?','What is our next project?']) {
    const result=parseConstraints(w,text);
    assert.equal(result.question,true);assert.deepEqual(result.changes,{});
  }
  assert.equal(informationReply(w,'How much ore do we have?'), 'We have 200 ore stored.');
  assert.equal(parseConstraints(w,'Can you collect 200 ore?').question,undefined);
  const request=commandInput('Keep everyone fed and collect 200 ore');
  assert.deepEqual(request.contextParts,[]);
  assert.ok(request.requiredContext.includes('Keep everyone fed and collect 200 ore'));
});

test("explicit resources constrain model options without selecting a goal for it",async()=>{
  const {commandOptions}=await import('../src/game/commands.js');
  assert.deepEqual(Object.keys(commandOptions('Please help us reach 80 Tripelkins')),['none','grow']);
  assert.deepEqual(Object.keys(commandOptions('Keep everyone fed and collect 200 ore')),['none','care','ore']);
  assert.ok(Object.keys(commandOptions('What should we do?')).length>2);
});
