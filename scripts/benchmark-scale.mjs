import { performance } from "node:perf_hooks";
import { scaleFixture } from "../src/game/scale-fixture.js";
import { stepWorld } from "../src/game/simulation.js";
import { buildContext } from "../src/game/context.js";
import { migrateWorld } from "../src/game/state.js";
import { navigationMemory } from "../src/game/navigation.js";

for (const population of [48, 1e6, 1e9]) {
  const w = scaleFixture(population);
  const start = performance.now(), cpu = process.cpuUsage(), steps = [];
  let contextMs = 0, contextBytes = 0;
  const completed = w.metrics.completed;
  for (let i = 0; i < 600; i++) {
    const t = performance.now(); stepWorld(w, 0.1); steps.push(performance.now() - t);
    if (i % 120 === 0) {
      const t = performance.now(), snapshot = buildContext(w);
      contextMs += performance.now() - t;
      contextBytes = Math.max(contextBytes, Buffer.byteLength(JSON.stringify(snapshot.context)));
    }
  }
  const elapsedMs = performance.now() - start, used = process.cpuUsage(cpu);
  const saveBytes = Buffer.byteLength(JSON.stringify(migrateWorld(w)));
  global.gc?.();
  steps.sort((a,b) => a-b);
  console.log(JSON.stringify({ initialPopulation: population, population: w.population,
    bodies: w.creatures.length, simulatedSeconds: 60, elapsedMs,
    cpuMs: (used.user + used.system) / 1000, stepP95Ms: steps[570],
    stepMaxMs: steps.at(-1), contextMs, contextBytes, saveBytes,
    completed: w.metrics.completed - completed, deaths: w.evidence.deaths,
    navigation: navigationMemory(w), nodeMemory: process.memoryUsage(),
  }));
}
