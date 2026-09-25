import { createWorld, addCreature, addObject } from "../src/game/state.js";
import { stepWorld, makePlan } from "../src/game/simulation.js";
for (const count of [8, 32, 96, 192]) {
  const w = createWorld({ empty: true });
  w.progress.hatched = true;
  for (let i = 0; i < 16; i++) {
    const type = ["orchard", "bath", "roundabout", "dwelling"][i % 4];
    addObject(w, type, 15 + (i % 4) * 6, 12 + Math.floor(i / 4) * 8, {
      stock: 12,
    });
  }
  for (let i = 0; i < count; i++)
    addCreature(w, 19 + (i % 10), 16 + Math.floor(i / 10));
  const start = performance.now();
  makePlan(w);
  const plan = performance.now() - start;
  const step = performance.now();
  for (let i = 0; i < 20; i++) stepWorld(w, 0.1);
  console.log(
    JSON.stringify({
      count,
      planMs: plan,
      twoSecondsMs: performance.now() - step,
      represented: w.creatures.length,
    }),
  );
}
