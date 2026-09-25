import { scaleFixture } from "../src/game/scale-fixture.js";
import { stepWorld } from "../src/game/simulation.js";
import { buildContext } from "../src/game/context.js";
import { migrateWorld } from "../src/game/state.js";
import { navigationMemory } from "../src/game/navigation.js";
import assert from "node:assert/strict";
const w = scaleFixture(1e6), started = performance.now();
let maxSaveBytes = 0, maxContextBytes = 0, maxLiveHeap = 0;
const before = w.metrics.completed;
// Once established, no caretaker interventions or injected resources/population.
for (let i = 0; i < 18000; i++) {
  stepWorld(w, 0.1);
  if (i % 120 === 119) {
    const snapshot = buildContext(w);
    maxContextBytes = Math.max(maxContextBytes, Buffer.byteLength(JSON.stringify(snapshot.context)));
  }
  if (i % 50 === 49) {
    const saved = migrateWorld(w);
    maxSaveBytes = Math.max(maxSaveBytes, Buffer.byteLength(JSON.stringify(saved)));
    assert.equal(saved.population, w.population);
    assert.equal(saved.creatures.length, w.creatures.length);
  }
  assert.equal(w.population, w.creatures.length + w.cohort + w.orbital.population);
  assert.ok(w.creatures.length <= 192);
  assert.ok(navigationMemory(w).bytes < 5e6);
  if (i % 3000 === 2999) {
    global.gc?.();
    const memory = process.memoryUsage();
    maxLiveHeap = Math.max(maxLiveHeap, memory.heapUsed);
    console.log(JSON.stringify({minute: (i + 1) / 600, population: w.population,
      bodies: w.creatures.length, cohort: w.cohort, deaths: w.evidence.deaths,
      pollution: w.progress.pollution, cleaned: w.evidence.cleaned,
      completed: w.metrics.completed - before, maxSaveBytes, maxContextBytes,
      navigation: navigationMemory(w), memory, elapsedMs: performance.now() - started}));
  }
}
assert.equal(w.evidence.deaths, 0);
assert.ok(w.memory.activity.clean > 0 && w.memory.activity.work > 0 && w.memory.activity.mine > 0);
assert.ok(maxSaveBytes < 2e6 && maxContextBytes < 250000);
console.log(JSON.stringify({passed: true, maxLiveHeap, jobs: w.memory.activity}));
