import { orbitalReady } from "../src/game/orbit-rules.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync, readFileSync } from "node:fs";
import { createWorld, migrateWorld } from "../src/game/state.js";
import {
  stepWorld,
  interact,
  choose,
  placeBuilding,
  withdrawMaterial,
  connectSurvivor,
} from "../src/game/simulation.js";
import { BUILDINGS, unlocked } from "../src/game/catalog.js";
import { canPlace, freePosition, ASSETS } from "../src/game/geometry.js";
import { setIndependence } from "../src/game/community.js";
const resume = process.argv.indexOf("--resume");
const w =
  resume >= 0
    ? migrateWorld(JSON.parse(readFileSync(process.argv[resume + 1])))
    : createWorld();
w.map.seed = 18492;
w.ui.paused = false;
w.runtime = { ...(w.runtime || {}), intelligenceAvailable: true };
const events = [],
  counts = { banana: 0, cloth: 0, cricketball: 0, chop: 0, build: 0, hammer: 0 };
const report = (message) => {
  const e = {
    minute: +(w.time / 60).toFixed(1),
    message,
    population: w.population,
    blocks: Math.floor(w.inventory.blocks),
    ore: Math.floor(w.inventory.ore),
    energy: Math.floor(w.progress.energy),
    losses: w.evidence.deaths,
    stalls: w.metrics.stalls,
  };
  events.push(e);
  console.log(JSON.stringify(e));
};
function build(type, max) {
  if (
    w.objects.filter((o) => o.type === type).length >= max ||
    !unlocked(w, BUILDINGS[type])
  )
    return;
  const candidates =
    type === "mine"
      ? w.objects.filter((o) => o.type === "node")
      : [
          ...(type === "factory" || type === "theatre" || type === "dwelling"
            ? Array.from({ length: 24 }, (_, i) => ({
                x: 46.7 + (i % 4) * 3.8,
                y: 17 + Math.floor(i / 4) * 3.8,
              }))
            : []),
          ...Array.from({ length: 70 }, (_, i) => ({
            x: 18 + (i % 7) * 3.7,
            y: 15 + Math.floor(i / 7) * 3.8,
          })),
          ...Array.from({ length: 24 }, (_, i) => ({
            x: 47 + (i % 3) * 4,
            y: 17 + Math.floor(i / 3) * 3.8,
          })),
        ];
  const sharedCare = ["bath", "orchard", "roundabout"].includes(type);
  if (
    sharedCare &&
    w.progress.bridge &&
    w.objects.filter((o) => o.type === type).length % 2 === 0
  )
    candidates.sort((a, b) => (b.x > 43) - (a.x > 43));
  for (const p of candidates) {
    if (type === "factory" && p.x < 43) continue;
    if (w.population >= 20 && (!sharedCare || w.progress.bridge)) {
      const f = ASSETS[type]?.footprint || [0.5, 0.5];
      for (const o of [...w.objects])
        if (Math.abs(o.x - p.x) < f[0] + 1 && Math.abs(o.y - p.y) < f[1] + 1) {
          if (o.type === "tree") {
            interact(w, "axe", o.x, o.y, o);
            counts.chop++;
          }
          if (o.type === "rock") {
            interact(w, "hammer", o.x, o.y, o);
            counts.hammer++;
          }
          if (o.type === "ore") {
            interact(w, "hammer", o.x, o.y, o);
            counts.hammer++;
          }
        }
    }
    if (!placeBuilding(w, type, p.x, p.y)) {
      counts.build++;
      report(`Built ${type}`);
      break;
    }
  }
}
let prior = "";
for (let tick = 0; w.time < 2400 && w.stage < 3; tick++) {
  if (tick % 50 === 0) {
    if (w.community.consent === "offered") {
      setIndependence(w, true);
      report("Independence accepted");
    }
    if (!w.progress.hatched) {
      const lander = w.objects.find((o) => o.type === "lander");
      interact(w, "inspect", lander.x, lander.y, lander);
      report("Spacecraft arrival");
    }
    for (const c of w.creatures) {
      // A caretaker covers only unmet urgent needs. Shared facilities do normal care.
      if (c.fed < 38) {
        const p = freePosition(w, c, [], 2);
        if (p) {
          interact(w, "banana", p.x, p.y, null);
          counts.banana++;
        }
      }
      if (c.clean < 40) {
        interact(w, "cloth", c.x, c.y, c);
        counts.cloth++;
      }
      if (
        c.amused < 50 &&
        !w.objects.some(
          (o) =>
            ["cricketball", "roundabout", "theatre"].includes(o.type) &&
            Math.hypot(o.x - c.x, o.y - c.y) < 8,
        )
      ) {
        const p = freePosition(w, c, [], 2);
        if (p) {
          interact(w, "cricketball", p.x, p.y);
          counts.cricketball++;
        }
      }
    }
    if (w.population < 6) {
      const c = w.creatures[0];
      if (c && c.fed < 80) {
        const p = freePosition(w, c, [], 2);
        if (p) {
          interact(w, "banana", p.x, p.y);
          counts.banana++;
        }
      }
      if (c && c.clean < 80) {
        interact(w, "cloth", c.x, c.y, c);
        counts.cloth++;
      }
    }
    if (w.population >= 4 && !w.progress.monolith) {
      choose(w, "monolith", "care");
      report("First contact");
    }
    if (
      w.population >= 4 &&
      (w.inventory.wood < 60 || !w.progress.bridge) &&
      w.objects.filter((o) => o.type === "log").length < 8
    ) {
      const tree = w.objects
        .filter((o) => o.type === "tree" && o.x < 39)
        .sort(
          (a, b) =>
            Math.hypot(a.x - 27, a.y - 25) - Math.hypot(b.x - 27, b.y - 25),
        )[0];
      if (tree) {
        interact(w, "axe", tree.x, tree.y, tree);
        counts.chop++;
      }
    }
    build("bath", Math.max(1, Math.ceil(w.creatures.length / 12)));
    build("orchard", Math.max(1, Math.ceil(w.creatures.length / 8)));
    build("roundabout", Math.max(1, Math.ceil(w.creatures.length / 20)));
    if (w.stage >= 2) {
      if (unlocked(w, { population: 20 })) {
        const resource =
          w.objects.find((o) => o.type === "ore") ||
          w.objects.find((o) => o.type === "rock");
        if (resource) {
          interact(w, "hammer", resource.x, resource.y, resource);
          counts.hammer++;
        }
      }
      if (w.inventory.ore >= 6 && w.inventory.blocks < 500 && !w.ui.held) {
        const p = freePosition(w, { x: 24, y: 24 }, [], 6);
        if (p && withdrawMaterial(w, "ore")) {
          interact(w, "grabber", p.x, p.y);
          const ore = w.objects.find(
            (o) => o.type === "ore" && Math.hypot(o.x - p.x, o.y - p.y) < 0.1,
          );
          if (ore) {
            interact(w, "hammer", p.x, p.y, ore);
            counts.hammer++;
          }
        }
      }
      build("mine", 3);
      build("factory", 2);
      build("dwelling", 4);
      build("theatre", 2);
      for (const z of [...w.pollution])
        if (z.amount > 35) interact(w, "mop", z.x, z.y);
      if (w.progress.energy >= 1500000 && !w.progress.tnt) {
        if (!w.objects.some((o) => o.type === "tnt")) {
          const mountain = w.objects.find((o) => o.type === "mountain");
          for (let i = 0; i < 48; i++) {
            const r = 5 + Math.floor(i / 16) * 2,
              a = (i * Math.PI) / 8;
            if (
              !placeBuilding(
                w,
                "tnt",
                mountain.x + Math.cos(a) * r,
                mountain.y + Math.sin(a) * r,
              )
            )
              break;
          }
        }
        const tnt = w.objects.find((o) => o.type === "tnt");
        if (tnt) {
          interact(w, "inspect", tnt.x, tnt.y, tnt);
          report("Demolition / mountain beacon");
        }
      }
      if (w.progress.tnt && !w.progress.secondContact) {
        choose(w, "second-contact", "yes");
        report("Second contact");
      }
      if (w.progress.secondContact) build("cannon", 1);
      if (orbitalReady(w)) {
        choose(w, "nuke", "yes");
        report("Final transformation");
        break;
      }
    }
  }
  stepWorld(w, 0.1);
  const key = [w.progress.bridge, w.orbital.population > 0].join(":");
  if (prior !== key) {
    prior = key;
    report(`Milestone ${key}`);
  }
  if (tick % 3000 === 0) {
    report("Progress");
    writeFileSync(
      join(tmpdir(), "tripelkins-simulated-world.json"),
      JSON.stringify(w),
    );
  }
}
if (w.stage === 3) {
  for (const c of [...w.creatures]) connectSurvivor(w, c.id);
  report("Final connection");
}
writeFileSync(join(tmpdir(), "tripelkins-final-world.json"), JSON.stringify(w));
report("Session finished");
console.log(
  JSON.stringify(
    {
      counts,
      creatures: w.creatures.length,
      inventory: w.inventory,
      buildings: w.objects.filter((o) => BUILDINGS[o.type]).map((o) => o.type),
      jobs: w.memory.activity,
      metrics: w.metrics,
      dead: w.evidence.deaths,
      complete: w.stage === 4,
    },
    null,
    2,
  ),
);
if (process.argv.includes("--require-ending") && w.stage !== 4)
  process.exitCode = 1;
