import test from "node:test";
import assert from "node:assert/strict";
import { auditWorld } from "../src/game/colony-audit.js";
import { makePlan, applyPlan } from "../src/game/jobs.js";
import { feasiblePlans, judgePlan, planReward } from "../src/game/decisions.js";
import { buildContext } from "../src/game/context.js";
import { packHostedContext } from "../src/game/context-budget.js";
import { decisionDue, decisionEvent } from "../src/intelligence-settings.js";
import { settlementDecisionChoices, settlementDecisionInput } from "../src/game/settlement.js";
import { askJev } from "../src/providers/jev.js";
import { carePressureWorld } from "../src/game/settlement-evaluation.js";

test("25 healthy residents offer distinct recovery, balanced and exploration allocations",()=>{
  const w=auditWorld(), scouts=policy=>makePlan(w,policy).assignments.filter(a=>a.task==="explore").length;
  assert.equal(scouts("care"),2);
  assert.equal(scouts("balanced"),3);
  assert.equal(scouts("expand"),5);
  const choices=feasiblePlans(w);
  assert.ok(choices.length>=2,"the model must have a real allocation choice");
  assert.ok(choices.some(p=>p.id==="expand"));
  assert.ok(!choices.some(p=>p.id==="care"),"fully healthy residents have no recovery deficit");
});
test("finished useful work triggers bounded early model reviews; rest does not",()=>{
  const w=auditWorld(), before=decisionEvent(w,"schedule");
  w.memory.activity.rest=20;
  assert.equal(decisionEvent(w,"schedule"),before);
  w.memory.activity.explore=1;
  assert.notEqual(decisionEvent(w,"schedule"),before);
  assert.equal(decisionDue(w.settings,"schedule",3,true),false);
  assert.equal(decisionDue(w.settings,"schedule",4,true),true);
  assert.equal(decisionDue(w.settings,"schedule",4,false),false);
  assert.equal(decisionDue(w.settings,"schedule",12,false),true);
});
test("development choices tell small models what progression resources unlock",()=>{
  const w=auditWorld(), choices=settlementDecisionChoices(w), input=settlementDecisionInput(w,choices);
  assert.match(input.options.crossing,/bridge.*open land and mining/);
  assert.match(input.requiredContext,/Bridge unlocks land and mining/);
});
test("urgent care context keeps unrelated unlocks out of the local model's attention",()=>{
  const w=carePressureWorld("orchard"), input=settlementDecisionInput(w,settlementDecisionChoices(w));
  assert.match(input.requiredContext,/Urgent care first/);
  assert.doesNotMatch(input.requiredContext,/Blocks unlock|Bridge unlocks/);
  assert.match(input.options.wait,/no new care capacity/);
});
test("a work pause cannot mobilize the larger expansion expedition",()=>{
  const w=auditWorld();w.directives.pauseWork=true;
  const scouts=policy=>makePlan(w,policy).assignments.filter(a=>a.task==="explore").length;
  assert.equal(scouts("expand"),scouts("balanced"));
});
test("Jev receives real crew alternatives, available workers and signed rewards",async()=>{
  const snapshot=buildContext(auditWorld());let sent;
  const response=await askJev({settings:{},token:"fixture-key",state:packHostedContext(snapshot.context,16000).context,
    question:snapshot.question,options:snapshot.options,
    fetcher:async(_url,init)=>{sent=JSON.parse(init.body);return new Response(JSON.stringify({answers:{decision:{type:"choice",choice:"expand"}}}));}});
  assert.equal(response.policy,"expand");
  assert.equal(sent.state.workload.available,25);
  assert.match(sent.questions.decision.criteria.expand,/5 scouts/);
  assert.ok(sent.state.candidateEffects.find(c=>c.id==="expand").reward.components.travel<0);
  assert.equal(sent.state.candidateEffects.find(c=>c.id==="expand").allocation.explore,5);
});
test("care reward measures the treated need, and healthy top-ups do not dominate work",()=>{
  const w=auditWorld(), c=w.creatures[0];
  c.fed=20;c.clean=99;c.amused=90;
  const plan=task=>({assignments:[{id:c.id,task,point:{x:c.x,y:c.y}}]});
  assert.equal(judgePlan(w,plan("wash")).effects.care,0);
  assert.ok(judgePlan(w,plan("eat")).effects.care>0);
  c.fed=c.clean=c.amused=85;
  assert.equal(judgePlan(w,plan("eat")).effects.care,0);
  const reward=planReward(w,makePlan(w,"expand"));
  assert.ok(reward.components.travel<0);
  assert.equal(reward.total,Object.values(reward.components).reduce((a,b)=>a+b,0));
});
test("a smaller scouting allocation completes journeys already underway",()=>{
  const w=auditWorld(), plan=makePlan(w,"expand");
  assert.equal(applyPlan(w,plan),true);
  const scouts=plan.assignments.filter(a=>a.task==="explore");
  const recovery=makePlan(w,"care");
  assert.ok(scouts.every(a=>recovery.assignments.some(b=>b.id===a.id&&b.task==="explore"&&b.keep)));
});
test("Laya and hosted context include worker availability and signed planning costs",()=>{
  const w=auditWorld(), snapshot=buildContext(w);
  assert.equal(snapshot.context.workload.available,25);
  assert.match(snapshot.localParts[0],/25\/25 healthy residents available/);
  assert.ok(snapshot.localParts.some(p=>/density cost -/.test(p)));
  assert.ok(snapshot.localParts.some(p=>/travel cost -/.test(p)));
  assert.match(snapshot.options.expand,/5 scout/);
  const packed=packHostedContext(snapshot.context,16000).context;
  assert.equal(packed.workload.available,25);
  assert.ok(packed.candidateEffects.every(c=>Number.isFinite(c.reward.total)));
});
