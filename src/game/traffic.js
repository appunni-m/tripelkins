import { bridgePoint, bridgeGeometry } from "./geometry.js";
const worlds = new WeakMap();
// Narrow decks admit one direction at a time. Wide decks use two spatial lanes.
// This is derived traffic state; it is rebuilt from bodies after a rewind.
export function canEnterBridge(w, c, destination) {
  let traffic = worlds.get(w);
  if (!traffic) {
    traffic = new Map();
    worlds.set(w, traffic);
  }
  for (const bridge of w.objects) {
    if (bridge.type !== "bridge") continue;
    const g = bridgeGeometry(bridge);
    if (!g.complete || g.width >= 1.7) continue;
    const at = bridgePoint(bridge, c),
      to = bridgePoint(bridge, destination);
    if (at.t > 0.02 && at.t < 0.98 && at.distance < g.width / 2) return true;
    if (at.t < 0.5 === to.t < 0.5) continue;
    const entry = at.t < 0.5 ? g.a : g.b;
    if (Math.hypot(c.x - entry.x, c.y - entry.y) > 1.8) continue;
    let record = traffic.get(bridge.id);
    if (!record) {
      record = { waiting: new Map(), direction: null, until: 0 };
      traffic.set(bridge.id, record);
    }
    const direction = at.t < 0.5 ? 1 : -1;
    if (!record.waiting.has(c.id))
      record.waiting.set(c.id, { direction, since: w.time });
    for (const id of record.waiting.keys())
      if (!w.creatures.some((c) => c.id === id)) record.waiting.delete(id);
    const onDeck = w.creatures.filter((other) => {
      const p = bridgePoint(bridge, other);
      return p.t > 0.02 && p.t < 0.98 && p.distance < g.width / 2;
    });
    if (onDeck.length)
      return record.direction === direction && w.time < record.until;
    if (w.time >= record.until || record.direction == null) {
      const first = [...record.waiting.entries()].sort(
        (a, b) => a[1].since - b[1].since || a[0].localeCompare(b[0]),
      )[0];
      record.direction = first?.[1].direction || direction;
      record.until = w.time + 4;
    }
    if (record.direction === direction) {
      record.waiting.delete(c.id);
      return true;
    }
    return false;
  }
  return true;
}
