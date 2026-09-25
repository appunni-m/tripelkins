// Disposable, deterministic diagnostics. Never read or save the player's world.
import { settlementWorld } from "./settlement-evaluation.js";
import { addCreature, addObject } from "./state.js";
import { buildContext } from "./context.js";
import { bestPlan, selectPlan } from "./decisions.js";
import { stepWorld, applyPlan } from "./simulation.js";
import { settlementDecisionChoices, settlementDecisionInput, startSettlement } from "./settlement.js";
import { discoverySummary } from "./discovery.js";
import { USEFUL_TASKS } from "./work-balance.js";
import { decisionEvent, decisionDue } from "../intelligence-settings.js";
import { workProjects } from "./work-projects.js";
import { projectPercent } from "./development.js";

export function auditWorld() {
  const w = settlementWorld("none");
  const c = addCreature(w, 25, 25);
  c.fed = c.clean = c.amused = 85;
  addObject(w, "bridge", 42, 25);
  w.runtime.growth = { held: true }; // Hold population at 25 to isolate scheduling.
  return w;
}
export const taskCounts = members => members.reduce((out,c) => {
  out[c.task] = (out[c.task] || 0) + 1; return out;
}, {});
const rounded = value => Math.round(value * 100) / 100;
export function auditSample(w) {
  return { tick: Math.round(w.time), population: w.creatures.length,
    tasks: taskCounts(w.creatures), states: w.creatures.reduce((out,c)=>{
      const key=c.job?.state||"none";out[key]=(out[key]||0)+1;return out;
    },{}),
    nearCenter: w.creatures.filter(c=>Math.hypot(c.x-24,c.y-24)<10).length,
    exploredArea: discoverySummary(w).area, stalls: w.metrics.stalls,
    minimumNeeds: Object.fromEntries(["fed","clean","amused"].map(k=>[k,rounded(Math.min(...w.creatures.map(c=>c[k])))])),
    project: w.community.project ? {type:w.community.project.type,crew:w.community.project.crew.length,
      progress:projectPercent(w,w.community.project),blocked:w.community.project.blocked} : null,
    crews:workProjects(w).map(p=>({id:p.id,type:p.type,at:[Math.round(p.x),Math.round(p.y)],
      workers:p.crew.length,progress:projectPercent(w,p),blocked:p.blocked})),
    completedProjects:w.community.completed, inventory:{...w.inventory},
    peakBlocks:w.progress.peakBlocks,energy:w.progress.energy,
    facilities:Object.fromEntries(["mine","factory","orchard","bath","roundabout"].map(type=>[type,w.objects.filter(o=>o.type===type).length])),
  };
}
// Callbacks return real provider responses in the browser. The CLI deliberately
// uses a labelled rule reference; those selections are never called model calls.
export async function auditColony({ seconds=300, world=auditWorld(), chooseSchedule, chooseDevelopment, onProgress=()=>{} } = {}) {
  const w=world, occupancy={}, positions=new Map(w.creatures.map(c=>[c.id,{x:c.x,y:c.y,distance:0}]));
  const reviews=[], projects=[], samples=[auditSample(w)];
  let modelCalls=0, singleChoice=0;
  let scheduleAt=-Infinity, developmentAt=-Infinity, lastScheduleEvent, lastDevelopmentEvent;
  for(let tick=0;tick<seconds*10;tick++) {
    const developmentEvent=decisionEvent(w,"development");
    if(decisionDue(w.settings,"development",w.time-developmentAt,developmentEvent!==lastDevelopmentEvent)) {
      developmentAt=w.time;lastDevelopmentEvent=developmentEvent;
      const choices=settlementDecisionChoices(w);
      if(choices.length) {
        const result=chooseDevelopment ? await chooseDevelopment(w,choices,settlementDecisionInput(w,choices))
          : {policy:choices[0].key,source:"Diagnostic rule reference"};
        if(chooseDevelopment) modelCalls++;
        const choice=choices.find(c=>c.key===result.policy);
        const started=!!choice && startSettlement(w,choice,result.source);
        projects.push({tick:Math.round(w.time),selected:result.policy,started,source:result.source,
          options:choices.map(c=>({id:c.key,type:c.id,priority:c.priority,at:[c.x,c.y]}))});
      }
    }
    const scheduleEvent=decisionEvent(w,"schedule");
    if(decisionDue(w.settings,"schedule",w.time-scheduleAt,scheduleEvent!==lastScheduleEvent)) {
      scheduleAt=w.time;lastScheduleEvent=scheduleEvent;
      const snapshot=buildContext(w);
      let result;
      if(snapshot.plans.length>1 && chooseSchedule) {
        result=await chooseSchedule(w,snapshot); modelCalls++;
      } else {
        if(snapshot.plans.length<=1) singleChoice++;
        result={policy:bestPlan(w,snapshot.plans).id,source:"Diagnostic rule reference"};
      }
      const decision=selectPlan(w,result.policy,result.source,"",snapshot.plans);
      const applied=applyPlan(w,decision.plan);
      if(applied) w.memory.lastPlan={policy:decision.policy,source:decision.source,tick:Math.floor(w.time),goalId:null};
      reviews.push({tick:Math.round(w.time),selected:decision.policy,applied,source:result.source,timing:result.timing,distribution:result.distribution,
        options:snapshot.plans.map(p=>({id:p.id,tasks:taskCounts(p.assignments),effects:p.effects}))});
    }
    stepWorld(w,.1);
    for(const c of w.creatures) {
      occupancy[c.task]=(occupancy[c.task]||0)+.1;
      const p=positions.get(c.id);p.distance+=Math.hypot(c.x-p.x,c.y-p.y);p.x=c.x;p.y=c.y;
    }
    if(tick%300===299) { samples.push(auditSample(w)); await onProgress(samples.at(-1)); }
  }
  const total=Object.values(occupancy).reduce((a,b)=>a+b,0);
  return { seconds, fixedPopulation:positions.size, modelCalls, scheduleReviews:reviews.length, singleChoiceReviews:singleChoice,
    occupancyPercent:Object.fromEntries(Object.entries(occupancy).map(([k,v])=>[k,rounded(v/total*100)])),
    usefulPercent:rounded(Object.entries(occupancy).reduce((n,[k,v])=>n+(USEFUL_TASKS.has(k)?v:0),0)/total*100),
    usefulWorkers:w.creatures.filter(c=>c.workCycles>0).length,
    completedTasks:{...w.memory.activity}, samples,reviews,projects,
    residents:w.creatures.map(c=>({id:c.id,name:c.name,task:c.task,reason:c.job?.purpose,state:c.job?.state,
      at:[rounded(c.x),rounded(c.y)],distance:rounded(positions.get(c.id).distance),workCycles:c.workCycles||0})),
  };
}
