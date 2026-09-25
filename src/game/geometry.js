import { workProjects } from "./work-projects.js";
import {
  isGround,
  isWater,
  nearbyObjects,
  naturalObjects,
  WORLD_EDGE,
} from "./map.js";

// Logical units are shared by physics, interaction, terrain and the pixel atlas.
export const BODY_RADIUS = 0.28;
export const TILE = Object.freeze({ x: 12, y: 6 });
export const project = (x, y) => ({
  x: (x - y) * TILE.x,
  y: -(x + y) * TILE.y,
});
export const unproject = (x, y) => ({
  x: x / (2 * TILE.x) - y / (2 * TILE.y),
  y: -x / (2 * TILE.x) - y / (2 * TILE.y),
});
export const ASSETS = Object.freeze({
  sculpture: { size: [42, 64], footprint: [0.7, 0.7], slots: 2 },
  creature: { size: [19, 25], radius: BODY_RADIUS },
  tree: { size: [46, 64], footprint: [0.48, 0.48] },
  rock: { size: [29, 25], footprint: [0.55, 0.5] },
  node: { size: [35, 29], footprint: [0.65, 0.65] },
  mountain: { size: [142, 158], footprint: [3, 3] },
  monolith: { size: [33, 67], footprint: [0.55, 0.55] },
  bath: { size: [43, 35], footprint: [0.85, 0.65], slots: 1 },
  orchard: { size: [53, 70], footprint: [0.6, 0.6], slots: 3 },
  roundabout: { size: [62, 42], footprint: [1.15, 1.15], slots: 5 },
  mine: { size: [64, 58], footprint: [1.3, 1], slots: 4 },
  dwelling: { size: [65, 69], footprint: [1.25, 1.05], slots: 6 },
  factory: { size: [77, 78], footprint: [1.6, 1.4], slots: 5 },
  theatre: { size: [91, 80], footprint: [1.8, 1.5], slots: 12 },
  cannon: { size: [68, 74], footprint: [1.4, 1.3], slots: 4 },
  bridge: { size: [115, 65], slots: 4 },
  lander: { size: [42, 48] },
  banana: { size: [15, 19], slots: 1 },
  cricketball: { size: [22, 25], slots: 4 },
  flowers: { size: [29, 30] },
  log: { size: [24, 20], slots: 1 },
  bone: { size: [22, 18], slots: 1 },
  ore: { size: [24, 23], slots: 1 },
  stump: { size: [22, 18] },
  corpse: { size: [20, 15] },
  hole: { size: [90, 62] },
  tnt: { size: [31, 30] },
});
export const footprint = (o) => ASSETS[o.type]?.footprint || null;
export function bridgeGeometry(o) {
  const g = o.bridge;
  return {
    a: { x: g?.a?.x ?? o.x - 3.3, y: g?.a?.y ?? o.y },
    b: { x: g?.b?.x ?? o.x + 3.3, y: g?.b?.y ?? o.y },
    width: g?.width ?? 2.4,
    elevation: 0.18,
    required: g?.required ?? 24,
    delivered: g?.delivered || { wood: o.stock || 0, bones: 0 },
    complete: g?.complete ?? o.stock >= 24,
  };
}
export function bridgePoint(o, p) {
  const g = bridgeGeometry(o),
    dx = g.b.x - g.a.x,
    dy = g.b.y - g.a.y;
  const length = Math.hypot(dx, dy),
    t = ((p.x - g.a.x) * dx + (p.y - g.a.y) * dy) / (length * length);
  return {
    g,
    t,
    distance: Math.abs((p.x - g.a.x) * dy - (p.y - g.a.y) * dx) / length,
    length,
    dx: dx / length,
    dy: dy / length,
  };
}
export function bridgeAt(w, p, radius = BODY_RADIUS) {
  return w.objects.find((o) => {
    if (o.type !== "bridge") return false;
    const { g, t, distance } = bridgePoint(o, p);
    return g.complete && t >= 0 && t <= 1 && distance <= g.width / 2 - radius;
  });
}
export function walkableSurface(w, x, y, radius = BODY_RADIUS) {
  if (
    !Number.isFinite(x + y) ||
    Math.abs(x) > WORLD_EDGE - 4 ||
    Math.abs(y) > WORLD_EDGE - 4
  )
    return false;
  if (
    !isWater(w, x, y) &&
    !isWater(w, x + radius, y) && !isWater(w, x - radius, y) &&
    !isWater(w, x, y + radius) && !isWater(w, x, y - radius)
  )
    return true;
  return !!bridgeAt(w, { x, y }, radius);
}
export function hitsFootprint(x, y, r, o) {
  const f = footprint(o);
  if (!f) return false;
  const dx = Math.max(0, Math.abs(x - o.x) - f[0]),
    dy = Math.max(0, Math.abs(y - o.y) - f[1]);
  return dx * dx + dy * dy < r * r;
}
const obstacleCache = new WeakMap();
export function nearbyObstacles(w, x, y, r = 5) {
  const stamp = `${w.navRevision}:${w.map.revision}`;
  let cache = obstacleCache.get(w);
  if (cache?.stamp !== stamp) {
    cache = {
      stamp,
      cells: new Map(),
      bridges: w.objects.filter((o) => o.type === "bridge"),
    };
    const obstacles = [...w.objects,...workProjects(w).map(p=>({...p,id:`construction:${p.id}`}))];
    for (const o of obstacles.filter(footprint)) {
      const f = footprint(o);
      for (
        let gx = Math.floor((o.x - f[0]) / 8);
        gx <= Math.floor((o.x + f[0]) / 8);
        gx++
      )
        for (
          let gy = Math.floor((o.y - f[1]) / 8);
          gy <= Math.floor((o.y + f[1]) / 8);
          gy++
        ) {
          const key = `${gx}:${gy}`;
          if (!cache.cells.has(key)) cache.cells.set(key, []);
          cache.cells.get(key).push(o);
        }
    }
    obstacleCache.set(w, cache);
  }
  const found = new Set();
  for (let gx = Math.floor((x - r) / 8); gx <= Math.floor((x + r) / 8); gx++)
    for (let gy = Math.floor((y - r) / 8); gy <= Math.floor((y + r) / 8); gy++)
      for (const o of cache.cells.get(`${gx}:${gy}`) || []) found.add(o);
  if (x - r < 0 || y - r < 0 || x + r > 64 || y + r > 48)
    for (const o of naturalObjects(
      w,
      x - r - 2,
      y - r - 2,
      x + r + 2,
      y + r + 2,
    ))
      if (footprint(o)) found.add(o);
  return [...found];
}
export function clearPosition(
  w,
  p,
  r = BODY_RADIUS,
  ignore = null,
  objects = null,
) {
  return (
    walkableSurface(w, p.x, p.y, r) &&
    !(objects || nearbyObstacles(w, p.x, p.y, r)).some(
      (o) => o.id !== ignore && hitsFootprint(p.x, p.y, r, o),
    )
  );
}
export function canPlace(w, type, p, ignore = null, { ignoreCreatures = false } = {}) {
  const f = ASSETS[type]?.footprint || [0.4, 0.4];
  if (
    !ignoreCreatures && w.creatures.some((c) =>
      hitsFootprint(c.x, c.y, BODY_RADIUS, { ...p, type }),
    )
  )
    return false;
  // Keep both bridge approaches clear, including the swept body clearance.
  // A legal building must not seal the only route between story regions.
  for (const bridge of w.objects.filter((o) => o.type === "bridge")) {
    const { g, t, distance, length, dx, dy } = bridgePoint(bridge, p);
    const along = Math.abs(dx) * f[0] + Math.abs(dy) * f[1] + 1.2;
    const across = Math.abs(dy) * f[0] + Math.abs(dx) * f[1] + BODY_RADIUS;
    if (
      t * length > -along &&
      t * length < length + along &&
      distance < g.width / 2 + across
    )
      return false;
  }
  for (const dx of [-f[0], 0, f[0]])
    for (const dy of [-f[1], 0, f[1]])
      if (
        !isGround(w, p.x + dx, p.y + dy) ||
        bridgeAt(w, { x: p.x + dx, y: p.y + dy }, 0)
      )
        return false;
  return !nearbyObjects(w, p.x, p.y, 8).some((o) => {
    if (o.id === ignore || ["flowers", "stump"].includes(o.type)) return false;
    const b = footprint(o) || [0.28, 0.28];
    return (
      Math.abs(o.x - p.x) < f[0] + b[0] + 0.35 &&
      Math.abs(o.y - p.y) < f[1] + b[1] + 0.35
    );
  });
}
export function serviceSlots(w, o, from = o) {
  if (o.type === "bridge") {
    const g = bridgeGeometry(o),
      bank =
        Math.hypot(from.x - g.a.x, from.y - g.a.y) <
        Math.hypot(from.x - g.b.x, from.y - g.b.y)
          ? g.a
          : g.b;
    return [-0.95, -0.3, 0.35, 1]
      .map((d, i) => ({
        x: bank.x,
        y: bank.y + d,
        slot: i,
        side: bank === g.a ? "a" : "b",
      }))
      .filter((p) => clearPosition(w, p));
  }
  const f = footprint(o) || [0.2, 0.2],
    n = Math.min(24, (ASSETS[o.type]?.slots || 1) * (o.level || 1));
  // Sample a perimeter at body clearance, then spread service positions around it.
  const rx = f[0] + 0.55,
    ry = f[1] + 0.55,
    points = [];
  for (let i = 0; i < n; i++) {
    // A one-slot object still has several possible entrances. A tree at its
    // northeast corner must not make every other side of a bath/mountain vanish.
    for (const offset of [0, 0.25, -0.25, 0.5, -0.5, 0.75, -0.75, 1]) {
      const angle = (2 * Math.PI * i) / n + Math.PI / 4 + offset*Math.PI/n;
      const scale = 1 / Math.max(Math.abs(Math.cos(angle)), Math.abs(Math.sin(angle)));
      const p = {x:o.x+Math.cos(angle)*rx*scale, y:o.y+Math.sin(angle)*ry*scale, slot:i};
      if (clearPosition(w,p) && points.every(q=>Math.hypot(q.x-p.x,q.y-p.y)>=0.6)) {
        points.push(p);
        // Alternate entrances share slot 0, so they do not add service capacity.
        if (n>1) break;
      }
    }
  }
  return n===1 ? points.sort((a,b)=>Math.hypot(a.x-from.x,a.y-from.y)-Math.hypot(b.x-from.x,b.y-from.y)) : points;
}
export function freePosition(w, p, others = w.creatures, maxRadius = 6) {
  for (let ring = 0; ring <= maxRadius; ring += 0.65)
    for (let a = 0; a < (ring ? 12 : 1); a++) {
      const q = {
        x: p.x + Math.cos((a * Math.PI) / 6) * ring,
        y: p.y + Math.sin((a * Math.PI) / 6) * ring,
      };
      if (
        clearPosition(w, q) &&
        !others.some(
          (c) => Math.hypot(c.x - q.x, c.y - q.y) < BODY_RADIUS * 2 + 0.06,
        )
      )
        return q;
    }
  return null;
}
export function sweptMove(w, c, dx, dy, objects = null) {
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 0.14));
  let moved = 0;
  for (let i = 0; i < n; i++) {
    const x = c.x,
      y = c.y;
    if (
      clearPosition(
        w,
        { x: x + dx / n, y: y + dy / n },
        BODY_RADIUS,
        null,
        objects,
      )
    ) {
      c.x += dx / n;
      c.y += dy / n;
    } else if (
      clearPosition(w, { x: x + dx / n, y }, BODY_RADIUS, null, objects)
    )
      c.x += dx / n;
    else if (
      clearPosition(w, { x: c.x, y: y + dy / n }, BODY_RADIUS, null, objects)
    )
      c.y += dy / n;
    moved += Math.hypot(c.x - x, c.y - y);
  }
  return moved;
}
export function separateBodies(w) {
  const cells = new Map(),
    key = (x, y) => `${Math.floor(x)}:${Math.floor(y)}`;
  for (const c of w.creatures) {
    const k = key(c.x, c.y);
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(c);
  }
  for (const c of w.creatures)
    for (let x = Math.floor(c.x) - 1; x <= Math.floor(c.x) + 1; x++)
      for (let y = Math.floor(c.y) - 1; y <= Math.floor(c.y) + 1; y++)
        for (const other of cells.get(`${x}:${y}`) || []) {
          if (c.id >= other.id) continue;
          let dx = c.x - other.x,
            dy = c.y - other.y,
            d = Math.hypot(dx, dy);
          if (d >= BODY_RADIUS * 2 + 0.03) continue;
          if (d < 0.001) {
            dx = c.id < other.id ? 1 : -1;
            dy = 0;
            d = 1e-3;
          }
          const push = Math.min(0.1, (BODY_RADIUS * 2 + 0.03 - d) / 2);
          const nx = dx / (d < 0.002 ? 1 : d),
            ny = dy / (d < 0.002 ? 1 : d);
          sweptMove(w, c, nx * push, ny * push);
          sweptMove(w, other, -nx * push, -ny * push);
        }
}

const bodyCache = new WeakMap();
function neighbors(w, c) {
  let cache = bodyCache.get(w);
  if (!cache || cache.time !== w.time || cache.count !== w.creatures.length) {
    cache = { time: w.time, count: w.creatures.length, cells: new Map() };
    for (const other of w.creatures) {
      const key = `${Math.floor(other.x)}:${Math.floor(other.y)}`;
      if (!cache.cells.has(key)) cache.cells.set(key, []);
      cache.cells.get(key).push(other);
    }
    bodyCache.set(w, cache);
  }
  const result = [];
  for (let x = Math.floor(c.x) - 1; x <= Math.floor(c.x) + 1; x++)
    for (let y = Math.floor(c.y) - 1; y <= Math.floor(c.y) + 1; y++)
      for (const other of cache.cells.get(`${x}:${y}`) || [])
        if (other !== c) result.push(other);
  return result;
}
export function steerMove(w, c, dx, dy) {
  const near = neighbors(w, c),
    length = Math.hypot(dx, dy);
  if (!near.length) return sweptMove(w, c, dx, dy);
  const available = (x, y) =>
    near.every((o) => Math.hypot(o.x - x, o.y - y) >= BODY_RADIUS * 2 - 0.015);
  const angle = Math.atan2(dy, dx),
    n = Math.max(1, Math.ceil(length / 0.12));
  let moved = 0;
  for (let i = 0; i < n; i++) {
    let found = false;
    // A deterministic side preference makes opposing walkers separate rather than
    // oscillate between equally good passing sides. Bodies never take model paths.
    for (const offset of [0, 0.55, 1, 1.57, 2.1, -0.55, -1, -1.57, -2.1]) {
      const vx = (Math.cos(angle + offset) * length) / n,
        vy = (Math.sin(angle + offset) * length) / n;
      if (
        !available(c.x + vx, c.y + vy) ||
        !clearPosition(w, { x: c.x + vx, y: c.y + vy })
      )
        continue;
      moved += sweptMove(w, c, vx, vy);
      found = true;
      break;
    }
    if (!found) break;
  }
  return moved;
}
