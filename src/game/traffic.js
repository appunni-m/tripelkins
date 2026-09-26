import { bridgePoint, bridgeGeometry, clearPosition } from "./geometry.js";
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
    if (!g.complete || g.width >= 2) continue;
    const at = bridgePoint(bridge, c),
      to = bridgePoint(bridge, destination);
    if (at.t > 0.02 && at.t < 0.98 && at.distance < g.width / 2) return true;
    if (at.t < 0.5 === to.t < 0.5) continue;
    let record = traffic.get(bridge.id);
    const registered = record?.waiting.has(c.id) || false;
    const entry = at.t < 0.5 ? g.a : g.b;
    if (!registered && Math.hypot(c.x - entry.x, c.y - entry.y) > 6) continue;
    if (!record) {
      record = { waiting: new Map(), direction: null, until: 0 };
      traffic.set(bridge.id, record);
    }
    const direction = at.t < 0.5 ? 1 : -1;
    const waiting = record.waiting.get(c.id);
    if (!waiting) {
      record.waiting.set(c.id, { direction, since: w.time, lastSeen: w.time });
    } else if (waiting.direction !== direction) {
      record.waiting.set(c.id, { direction, since: w.time, lastSeen: w.time });
    } else {
      waiting.lastSeen = w.time;
    }
    for (const [id, value] of record.waiting)
      if (w.time - value.lastSeen >= 1) record.waiting.delete(id);
    const onDeck = w.creatures.some((other) => {
      const p = bridgePoint(bridge, other);
      return p.t > 0.02 && p.t < 0.98 && p.distance < g.width / 2;
    });
    if (onDeck) {
      const allowed = record.direction === direction && w.time < record.until;
      if (allowed) record.waiting.delete(c.id);
      return allowed;
    }
    if (w.time >= record.until || record.direction == null) {
      const first = [...record.waiting.entries()].sort(
        (a, b) => a[1].since - b[1].since || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
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

// Kept as an internal export so simulation travel can move queued residents
// clear of a narrow bridge entrance without exposing a new engine operation.
export function bridgeWaitingPoint(w, c) {
  for (const bridge of w.objects) {
    const waiting = worlds.get(w)?.get(bridge.id)?.waiting.get(c.id);
    if (!waiting) continue;
    const g = bridgeGeometry(bridge), { dx, dy } = bridgePoint(bridge, c);
    const sign = waiting.direction;
    const entry = sign === 1 ? g.a : g.b;
    const delta = { x: c.x - entry.x, y: c.y - entry.y };
    const back = Math.max(-sign * (delta.x * dx + delta.y * dy), 2.4);
    const side = Math.max(sign * (-delta.x * dy + delta.y * dx), 1.2);
    const point = {
      x: entry.x - dx * sign * back - dy * sign * side,
      y: entry.y - dy * sign * back + dx * sign * side,
    };
    return clearPosition(w, point) ? point : null;
  }
  return null;
}
