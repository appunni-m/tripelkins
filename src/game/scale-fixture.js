// Disposable, deterministic workloads shared by the browser and Node checks.
// Population in orbit is an exact aggregate; named surface bodies keep real jobs.
import { scenario } from "./scenarios.js";
import { syncPopulation } from "./population.js";
export function scaleFixture(population) {
  const w = scenario("industry");
  w.orbital.population = Math.max(0, population - w.creatures.length);
  syncPopulation(w);
  w.ui.paused = false;
  return w;
}
