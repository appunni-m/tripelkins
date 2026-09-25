// Disposable verification worlds. These never touch the player's IndexedDB.
import { createWorld, addObject, addCreature } from "./state.js";
import { bridgeGeometry, freePosition } from "./geometry.js";
import { stepWorld } from "./simulation.js";
import { updateStory } from "./story.js";
export function scenario(name = "opening") {
  const w = createWorld();
  w.map.seed = 18492;
  w.ui.welcome = true;
  w.ui.paused = true;
  if (name === "opening") return w;
  const crossing = name === "bridge" || name === "bridge-stock";
  w.objects = w.objects.filter((o) => !["lander", "rock"].includes(o.type));
  w.progress.hatched = true;
  for (let i = 0; i < (crossing ? 16 : 48); i++) {
    const c = addCreature(
      w,
      (name === "industry" && i >= 24 ? 50 : 26) +
        Math.cos(i * 2.4) * (2 + Math.sqrt(i % 24)),
      26 + Math.sin(i * 2.4) * (2 + Math.sqrt(i % 24)),
    );
    c.fed = c.clean = c.amused = 80;
  }
  for (const [type, x, y] of [
    ["bath", 21, 20],
    ["bath", 28, 19],
    ["orchard", 19, 26],
    ["orchard", 30, 29],
    ["roundabout", 24, 29],
  ])
    addObject(w, type, x, y, { stock: 12 });
  w.progress.monolith = true;
  if (crossing) {
    if (name === "bridge-stock") w.inventory.wood = 24;
    else addObject(w, "log", 36, 24, { stock: 24 });
    w.ui.x = 35;
    w.ui.y = 25;
  } else {
    const b = w.objects.find((o) => o.type === "bridge");
    b.bridge = bridgeGeometry(b);
    b.bridge.complete = true;
    b.bridge.delivered.wood = 24;
    b.stock = 24;
    w.progress.bridge = true;
    w.stage = 2;
    for (const [type, x, y] of [
      ["mine", 48, 28],
      ["factory", 49, 23],
      ["dwelling", 51, 33],
      ["dwelling", 55, 27],
      ["theatre", 55, 20],
      ["cannon", 49, 17],
    ]) {
      w.objects = w.objects.filter(
        (o) => Math.hypot(o.x - x, o.y - y) > 2.6 || o.type === "bridge",
      );
      addObject(w, type, x, y, {
        stock: type === "mine" ? 10000 : 0,
        level: type === "factory" ? 2 : 1,
      });
    }
    w.pollution = [
      {
        source: w.objects.find((o) => o.type === "factory").id,
        x: 49,
        y: 23,
        radius: 5,
        amount: 55,
      },
    ];
    w.progress.pollution = 55;
    w.inventory.ore = 120;
    w.inventory.blocks = 8000;
    w.progress.peakBlocks = 8000;
    w.ui.x = 46;
    w.ui.y = 25;
  }
  // Fixtures place structures after bodies. Repair those placements before
  // exercising real jobs, using the same clearance as births/restores.
  const occupied = [];
  for (const c of w.creatures) {
    const p = freePosition(w, c, occupied, 8);
    if (p) Object.assign(c, p);
    occupied.push(c);
  }
  w.ui.paused = false;
  for (let i = 0; i < 80; i++) stepWorld(w, 0.1);
  w.ui.paused = true;
  updateStory(w);
  w.story.seen = [...w.story.completed];
  w.story.queue = [];
  w.ui.selected = w.creatures[0]?.id;
  w.navRevision++;
  return w;
}
