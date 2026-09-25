// Disposable, deterministic workloads shared by the browser and Node checks.
// Population in orbit is an exact aggregate; named surface bodies keep real jobs.
import { scenario } from "./scenarios.js";
import { syncPopulation } from "./population.js";
import { freePosition } from "./geometry.js";
import { revealColony } from "./discovery.js";
import { makePlan, applyPlan } from "./simulation.js";
export function scaleFixture(population) {
  const w = scenario("industry");
  // Exercise multiple neighborhoods on both riverbanks, including procedural
  // terrain. The industry preview's warm-up otherwise gathers most bodies at
  // the same few facilities before the measurement even starts.
  const columns = [8, 16, 24, 32, 48, 56, 64, 72], placed = [];
  for (const [index, creature] of w.creatures.entries()) {
    const position = freePosition(w, {
      x: columns[index % columns.length],
      y: 6 + Math.floor(index / columns.length) * 7,
    }, placed, 3);
    if (!position) throw new Error("No clear position for the distributed workload.");
    Object.assign(creature, position, {
      task: "idle", target: null, job: null, work: 0, blocked: [],
      wanderX: position.x, wanderY: position.y,
    });
    placed.push(creature);
  }
  revealColony(w);
  w.navRevision++;
  w.orbital.population = Math.max(0, population - w.creatures.length);
  syncPopulation(w);
  applyPlan(w, makePlan(w));
  Object.assign(w.ui, { x: 40, y: 24, zoom: 0.55, selected: null });
  w.ui.paused = false;
  return w;
}
