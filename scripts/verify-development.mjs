import assert from "node:assert/strict";
import { developmentWorld } from "../src/game/settlement-evaluation.js";
import { settlementChoices, startSettlement } from "../src/game/settlement.js";
import { stepWorld } from "../src/game/simulation.js";
import { addObject, migrateWorld } from "../src/game/state.js";
import { writeFileSync } from "node:fs";

let w=developmentWorld("crossing"), restored=false;
addObject(w,"node",48,28,{stock:10000});
addObject(w,"node",51,17,{stock:10000});
const started=[];
for(let tick=0;tick<18000;tick++) {
  if(tick%300===0) {
    const choices=settlementChoices(w);
    if(choices.length && startSettlement(w,choices[0],"Deterministic verification planner"))
      started.push({second:Math.round(w.time),type:choices[0].id});
  }
  stepWorld(w,.1);
  if(!restored && w.time>=900) {
    w=migrateWorld(w);w.runtime={intelligenceAvailable:true};restored=true;
  }
}
const result={scope:"30 simulated minutes with a deterministic project selector; no caretaker tools; restore at minute 15",
  population:w.population,losses:w.evidence.deaths,bridge:w.progress.bridge,inventory:w.inventory,energy:w.progress.energy,
  facilities:Object.fromEntries(["orchard","bath","roundabout","mine","factory","dwelling","theatre"].map(t=>[t,w.objects.filter(o=>o.type===t).length])),
  completed:w.community.completed,project:w.community.project,started,jobs:w.memory.activity,
  retained:{objects:w.objects.length,inbox:w.community.inbox.length,activity:w.community.activity.length,visited:w.community.visited.length}};
console.log(JSON.stringify(result,null,2));
if(process.argv.includes("--snapshot")) writeFileSync("/tmp/tripelkins-development-world.json",JSON.stringify(w));
assert.equal(w.evidence.deaths,0,"Independent development displaced care.");
assert.equal(w.progress.bridge,true,"The crossing was not completed.");
assert.ok(result.facilities.mine && result.facilities.factory && result.facilities.dwelling,"The colony did not establish industry and housing.");
assert.ok(w.progress.energy>1500000,"Industrial growth stalled.");
assert.ok(Object.values(w.inventory).every(n=>n>=0),"Resources went negative.");
assert.ok(w.objects.length<=768 && w.community.inbox.length<=64 && w.community.activity.length<=40 && w.community.visited.length<=64);
