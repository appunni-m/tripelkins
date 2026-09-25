import { LIMITS } from "./catalog.js";
import { bridgeGeometry } from "./geometry.js";
import { encounter } from "./identity.js";
import { noteEvidence } from "./story.js";
import { activity, postMessage } from "./community.js";
const types = { log: "wood", bone: "bones", ore: "ore", corpse: "corpses" };
export function releaseCargo(w, c) {
  if (c.carry > 0) {
    w.inventory[c.cargoKind || "wood"] += c.carry;
    c.carry = 0;
    c.cargoKind = null;
  }
}
export function deposit(w, type, x, y, stock, addObject) {
  const nearby = w.objects.find(
    (o) => o.type === type && Math.hypot(o.x - x, o.y - y) < 2,
  );
  if (nearby) {
    nearby.stock += stock;
    return nearby;
  }
  if (w.objects.length < LIMITS.objects)
    return addObject(w, type, x, y, { stock });
  // The recovery store is always available, even when every object slot is used.
  // A corpse is stored as a corpse, never silently converted to bones.
  const kind = types[type];
  if (kind) w.inventory[kind] = (w.inventory[kind] || 0) + stock;
  return null;
}
export function die(
  w,
  victims,
  cause,
  addObject,
  remember,
  actor = "caretaker",
) {
  const living = victims.filter((c) => w.creatures.some((o) => o.id === c.id));
  if (!living.length) return 0;
  for (const c of living) {
    releaseCargo(w, c);
    const sacrifice = cause === "bug" || cause === "swarm";
    deposit(
      w,
      sacrifice ? "bone" : "corpse",
      c.x,
      c.y,
      sacrifice ? 8 : 1,
      addObject,
    );
    for (const other of w.creatures)
      if (other.id !== c.id && Math.hypot(other.x - c.x, other.y - c.y) < 6)
        encounter(other, "loss", c.id, w.time);
    w.departed.push({ id: c.id, name: c.name, cause, tick: w.time, actor });
    remember(
      w,
      "loss",
      `${c.name} died (${cause}). ${sacrifice ? "Eight bones remain." : "Their remains are kept."}`,
      c.id,
    );
    noteEvidence(w, "deaths", `${c.name} died from ${cause}.`, 1, c.id);
    const dimension = sacrifice
      ? "sacrificed"
      : cause === "hammer"
        ? "hammer"
        : cause === "meteor"
          ? "meteorDeaths"
        : cause === "pollution"
          ? "pollutionDeaths"
          : "neglect";
    noteEvidence(w, dimension, `${c.name}: ${cause}.`, 1, c.id);
  }
  const ids = new Set(living.map((c) => c.id));
  w.creatures = w.creatures.filter((c) => !ids.has(c.id));
  w.departed = w.departed.slice(-32);
  w.population = w.creatures.length + w.cohort + w.orbital.population;
  w.commandRevision++;
  return living.length;
}
export function deliver(w, c, o, remember) {
  const g = bridgeGeometry(o),
    kind = c.cargoKind || "wood";
  if (g.complete) {
    releaseCargo(w, c);
    return;
  }
  const remaining = g.required - g.delivered.wood - g.delivered.bones,
    amount = Math.min(c.carry, remaining);
  g.delivered[kind] = (g.delivered[kind] || 0) + amount;
  c.carry -= amount;
  noteEvidence(
    w,
    "deliveries",
    `${c.name} delivered ${amount} ${kind}.`,
    1,
    c.id,
  );
  noteEvidence(
    w,
    kind === "bones" ? "bonesDelivered" : "woodDelivered",
    `${amount} ${kind} became part of the bridge.`,
    amount,
    c.id,
  );
  o.stock = g.delivered.wood + g.delivered.bones;
  activity(w, "bridge", `${c.name} delivered ${amount} ${kind}. Bridge: ${o.stock}/${g.required}.`);
  if (o.stock >= g.required) {
    g.complete = true;
    w.progress.bridge = true;
    w.stage = Math.max(w.stage, 2);
    w.navRevision++;
    w.commandRevision++;
    remember(
      w,
      "bridge",
      "The bridge is complete. Both banks are connected.",
      o.id,
    );
    postMessage(w, { key:`bridge-complete:${o.id}`, title:"The other bank",
      text:"We finished the crossing. The ore deposits and mountain are within reach now. Our world has room to grow." });
  }
  o.bridge = g;
  if (c.carry) releaseCargo(w, c);
  else c.cargoKind = null;
}
export function pollutionAt(w, p) {
  return w.pollution.reduce(
    (sum, z) =>
      sum +
      z.amount * Math.max(0, 1 - Math.hypot(p.x - z.x, p.y - z.y) / z.radius),
    0,
  );
}
export function pollute(w, o, amount) {
  let z = w.pollution.find((z) => z.source === o.id);
  if (!z) {
    z = { source: o.id, x: o.x, y: o.y, radius: 5, amount: 0 };
    w.pollution.push(z);
  }
  z.amount = Math.min(250, z.amount + amount);
  w.pollution = w.pollution.slice(-64);
  w.progress.pollution = Math.min(
    1000,
    w.pollution.reduce((s, z) => s + z.amount, 0),
  );
}
export function cleanPollution(w, p, remember) {
  let removed = 0;
  for (const z of w.pollution)
    if (Math.hypot(z.x - p.x, z.y - p.y) < z.radius + 3) {
      const n = Math.min(40, z.amount);
      z.amount -= n;
      removed += n;
    }
  w.pollution = w.pollution.filter((z) => z.amount > 0.1);
  w.progress.pollution = w.pollution.reduce((s, z) => s + z.amount, 0);
  for (const c of w.creatures)
    if (Math.hypot(c.x - p.x, c.y - p.y) < 4) {
      c.clean = Math.max(c.clean, 90);
      c.sickness = Math.max(0, c.sickness - 30);
    }
  if (removed) {
    noteEvidence(
      w,
      "cleaned",
      `Cleaned ${Math.round(removed)} pollution near (${Math.round(p.x)}, ${Math.round(p.y)}).`,
      removed,
    );
    remember(
      w,
      "cleanup",
      "The air clears around this part of the settlement.",
    );
  }
}

// Worker maintenance removes only actual pollution at the serviced factory.
// No free need restoration, material creation, or per-resident history entries.
export function maintainFactory(w, factory, amount) {
  const zone = w.pollution.find((z) => z.source === factory.id);
  if (!zone) return 0;
  const removed = Math.min(Math.max(0, amount), zone.amount);
  zone.amount -= removed;
  if (zone.amount <= 0) w.pollution = w.pollution.filter((z) => z !== zone);
  w.progress.pollution = w.pollution.reduce((sum, z) => sum + z.amount, 0);
  return removed;
}
