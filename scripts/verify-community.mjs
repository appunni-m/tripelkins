import assert from 'node:assert/strict';
import { settlementWorld } from '../src/game/settlement-evaluation.js';
import { settlementChoices, startSettlement } from '../src/game/settlement.js';
import { stepWorld } from '../src/game/simulation.js';
import { collectStoryMessages } from '../src/game/story.js';
import { migrateWorld } from '../src/game/state.js';
let world=settlementWorld('roundabout'),last=-30,restored=false;
const builds=[];
for(let tick=0;tick<18000;tick++) {
  if(world.time-last>=30) {
    last=world.time;
    const choices=settlementChoices(world);
    if(choices.length && startSettlement(world,choices[0],'Deterministic verification planner'))
      builds.push({tick:Math.floor(world.time),type:choices[0].id});
  }
  stepWorld(world,.1);
  collectStoryMessages(world);
  if(!restored && world.time>=900) {
    world=migrateWorld(world);world.runtime={intelligenceAvailable:true};restored=true;
  }
}
assert.equal(world.evidence.deaths,0,'Independent care lost residents.');
assert.ok(world.community.completed>=3,'Too few care projects finished.');
assert.ok(world.community.explored>30,'Scouting stopped.');
assert.ok(world.community.inbox.length<=64 && world.community.activity.length<=40 && world.community.visited.length<=64);
const costs={orchard:10,bath:6,roundabout:12};
const paid=world.objects.filter(o=>costs[o.type]).reduce((sum,o)=>sum+costs[o.type],0)-38; // Two starting orchards and three baths.
assert.equal(world.inventory.wood+paid,world.progress.chopped*6,'Timber was lost or invented.');
console.log(JSON.stringify({scope:'30 simulated minutes with a deterministic project selector, not model inference; restored at minute 15',
  population:world.population,losses:world.evidence.deaths,completed:world.community.completed,scouted:world.community.explored,
  wood:world.inventory.wood,woodPaid:paid,treesGathered:world.progress.chopped,objects:world.objects.length,builds,
  stalls:world.metrics.stalls,project:world.community.project,inbox:world.community.inbox.length,activity:world.community.activity.length,
  visited:world.community.visited.length,jobCounts:world.memory.activity,
  range:{x:[Math.min(...world.creatures.map(c=>c.x)),Math.max(...world.creatures.map(c=>c.x))],y:[Math.min(...world.creatures.map(c=>c.y)),Math.max(...world.creatures.map(c=>c.y))]}},null,2));
