import { createHash } from "node:crypto";
import { groundFixture } from "../src/game/scale-fixture.js";
import { stepWorld } from "../src/game/simulation.js";
import { buildContext } from "../src/game/context.js";
import { settlementDecisionChoices } from "../src/game/settlement.js";
import { inspectGoal } from "../src/game/goals.js";
import { navigationMemory } from "../src/game/navigation.js";

const count=Number(process.argv[2]||300), w=groundFixture(count);
const explicitGoal=process.argv.includes("--goal");
if(explicitGoal) w.memory.goals=[{id:"benchmark",kind:"blocks",target:300,status:"active"}];
const steps=[], start=performance.now();
let contextMs=0,developmentMs=0,goalUiMs=0;
for(let i=0;i<100;i++) {
  let at=performance.now();stepWorld(w,.1);steps.push(performance.now()-at);
  if(i%40===0) {
    at=performance.now();buildContext(w);contextMs+=performance.now()-at;
    at=performance.now();settlementDecisionChoices(w);developmentMs+=performance.now()-at;
  }
  if(explicitGoal && i%4===0) {
    at=performance.now();inspectGoal(w,w.memory.goals[0]);goalUiMs+=performance.now()-at;
  }
}
const elapsedMs=performance.now()-start;
steps.sort((a,b)=>a-b);
// Actual simulation state, excluding timing/UI/diagnostic fields. This allows
// navigation implementations to be compared on the same end-to-end workload.
const state={creatures:w.creatures,objects:w.objects,inventory:w.inventory,
  progress:w.progress,activity:w.memory.activity,rng:w.rng,completed:w.metrics.completed};
console.log(JSON.stringify({count,explicitGoal,simulatedSeconds:10,elapsedMs,
  simulationMs:steps.reduce((a,b)=>a+b,0),p95StepMs:steps[95],maxStepMs:steps.at(-1),
  contextMs,developmentMs,goalUiMs,completed:w.metrics.completed,navigation:navigationMemory(w),
  stateSHA256:createHash("sha256").update(JSON.stringify(state)).digest("hex")},null,2));
