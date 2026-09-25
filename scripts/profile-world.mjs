import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { migrateWorld } from "../src/game/state.js";
import { stepWorld } from "../src/game/simulation.js";
const w = migrateWorld(
  JSON.parse(
    readFileSync(
      process.argv[2] || join(tmpdir(), "tripelkins-simulated-world.json"),
    ),
  ),
);
w.ui.paused = false;
const start = performance.now();
for (let i = 0; i < 100; i++) stepWorld(w, 0.1);
console.log({ seconds: 10, ms: performance.now() - start, metrics: w.metrics });
