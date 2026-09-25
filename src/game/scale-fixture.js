// Disposable, deterministic workloads shared by the browser and Node checks.
// Population in orbit is an exact aggregate; named surface bodies keep real jobs.
import { scenario } from "./scenarios.js";
import { syncPopulation } from "./population.js";
import { freePosition, canPlace } from "./geometry.js";
import { createWorld, addCreature, addObject } from "./state.js";
import { setIndependence } from "./community.js";
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

// Actual walking bodies, rather than an orbital population counter. Births are
// held so a run at 300 remains a comparable 300-body workload throughout.
export function groundFixture(count = 300) {
  const w = createWorld({empty:true});
  w.progress.hatched = w.progress.bridge = true;
  w.stage = 2;
  w.inventory.wood = 24;
  const placed = [];
  for (let camp = 0; camp < Math.ceil(count / 30); camp++) {
    const x = -24 + camp % 4 * 30, y = -24 + Math.floor(camp / 4) * 32;
    for (const [type, dx, dy] of [["orchard",-7,0],["orchard",7,0],
      ["bath",0,-7],["bath",7,-7],["bath",-7,-7],
      ["roundabout",0,7],["roundabout",7,7],["rock",-12,9],["tree",12,9]]) {
      let site;
      for (let i = 0; i < 96 && !site; i++) {
        const r = Math.floor(i / 12), angle = i * 2.399963;
        const p = {x:x+dx+Math.cos(angle)*r, y:y+dy+Math.sin(angle)*r};
        if (canPlace(w,type,p)) site = p;
      }
      if (!site) throw new Error(`No safe ${type} site in ground fixture.`);
      addObject(w,type,site.x,site.y,{stock:12});
    }
    for (let j = 0; j < 30 && placed.length < count; j++) {
      const p = freePosition(w,{x:x+j%6*1.3-3.5,y:y+Math.floor(j/6)*1.3-2.5},placed,8);
      if (!p) throw new Error("No safe body position in ground fixture.");
      const c = addCreature(w,p.x,p.y);
      if (!c) throw new Error("Ground fixture could not create the requested body count.");
      c.fed = c.clean = c.amused = 85;
      placed.push(c);
    }
  }
  setIndependence(w,true);
  w.runtime = {intelligenceAvailable:true,growth:{held:true}};
  revealColony(w);
  Object.assign(w.ui,{paused:false,x:20,y:10,zoom:.4,selected:null});
  return w;
}
