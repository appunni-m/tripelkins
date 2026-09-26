// Disposable saturated-world fixture: no browser save or model access.
import assert from 'node:assert/strict';
import { scaleFixture } from '../src/game/scale-fixture.js';
import { addCreature, addObject, migrateWorld, remember } from '../src/game/state.js';
import { LIMITS } from '../src/game/catalog.js';
import { beginCommand } from '../src/game/memory.js';
import { stepWorld } from '../src/game/simulation.js';
import { buildContext } from '../src/game/context.js';
import { packHostedContext } from '../src/game/context-budget.js';
import { appendTimeline, readMoment, latestWorld, historySize, TIMELINE_LIMITS } from '../src/game/timeline.js';
import { navigationMemory } from '../src/game/navigation.js';
const started=performance.now(), w=scaleFixture(1e9);
while(w.creatures.length<LIMITS.creatures) {
  const i=w.creatures.length;
  assert.ok(addCreature(w,5+i%28,34+Math.floor(i/28)));
}
while(w.objects.length<LIMITS.objects) {
  const i=w.objects.length;
  assert.ok(addObject(w,'ore',100+i%40,100+Math.floor(i/40),{stock:200}));
}
assert.equal(addObject(w,'ore',100,100),null);
let previous=migrateWorld(w), history=appendTimeline(null,null,previous), maximumSave=0, maximumContext=0;
for(let i=0;i<145;i++) {
  const command=beginCommand(w,`Maintain care while supplying the works. ${i} ${'Please keep our promises. '.repeat(20)}`,'typed',w.creatures[0].id);
  command.status='completed';command.reply='We will keep looking after everyone.';
  for(let j=0;j<4;j++)remember(w,'care',`Fixture event ${i}:${j}`);
  stepWorld(w,.1);
  const saved=migrateWorld(w), full=buildContext(w,{includePlans:i%20===0});
  maximumSave=Math.max(maximumSave,Buffer.byteLength(JSON.stringify(saved)));
  maximumContext=Math.max(maximumContext,Buffer.byteLength(JSON.stringify(full.context)));
  const packed=packHostedContext(full.context,16000);
  assert.ok(packed.bytes<=16000);
  assert.equal(packed.context.population,w.population);
  assert.deepEqual(packed.context.permissions,full.context.permissions);
  history=appendTimeline(history,previous,saved);previous=saved;
  assert.ok(historySize(history)<=TIMELINE_LIMITS.bytes);
}
assert.ok(history.branches[0].compacted>0);
assert.deepEqual(latestWorld(history.branches.at(-1)),previous);
const retained=history.branches[0], restoreId=retained.frames[Math.floor(retained.frames.length/2)].id;
const restored=readMoment(retained,restoreId), normalized=migrateWorld(restored);
assert.deepEqual(normalized.creatures.map(c=>[c.id,c.name,c.fed,c.clean,c.amused,c.carry]),restored.creatures.map(c=>[c.id,c.name,c.fed,c.clean,c.amused,c.carry]));
assert.equal(normalized.population,restored.population);
assert.deepEqual(normalized.memory.commands,restored.memory.commands);
for(let i=0;i<6;i++)history=appendTimeline(history,previous,restored,{origin:restoreId});
assert.ok(history.branches.length>1 && history.branches.length<=TIMELINE_LIMITS.branches);
assert.ok(historySize(history)<=TIMELINE_LIMITS.bytes);
assert.deepEqual(latestWorld(history.branches.at(-1)),restored);
global.gc?.();
console.log(JSON.stringify({passed:true,bodies:w.creatures.length,objects:w.objects.length,population:w.population,maximumSave,maximumContext,hostedContextBudget:16000,historyBytes:historySize(history),branches:history.branches.length,commands:w.memory.commands.length,commandsCompacted:w.memory.summary.commandsCompacted,events:w.memory.recent.length,eventsCompacted:w.memory.summary.eventsCompacted,navigation:navigationMemory(w),memory:process.memoryUsage(),elapsedMs:performance.now()-started},null,2));
