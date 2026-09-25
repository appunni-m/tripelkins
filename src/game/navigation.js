import { naturalObjects, WORLD_EDGE } from "./map.js";
import { copyOccupancy, NAV_CELL } from "./navigation-grid.js";
import {
  nearbyObstacles,
  BODY_RADIUS,
  hitsFootprint,
  footprint,
  walkableSurface,
  bridgeGeometry,
  bridgePoint,
  clearPosition,
} from "./geometry.js";
export const JOB_RADIUS = 64;
const CELL = NAV_CELL,
  WIDTH = 112,
  MAX_FIELDS = 192;
const worlds = new WeakMap();
// A candidate set asks the same route question for several policies. Reuse only
// within that synchronous planning operation: positions and topology cannot
// change, and no cache of past coordinates grows as the colony moves.
const planningCosts = new WeakMap();
export function withRouteCosts(w, operation) {
  if (planningCosts.has(w)) return operation();
  planningCosts.set(w, new Map());
  try {
    return operation();
  } finally {
    planningCosts.delete(w);
  }
}
function navigation(w) {
  const signature = `${w.map.revision}:${w.navRevision || 0}:${w.progress.bridge}`;
  let nav = worlds.get(w);
  if (nav?.signature === signature) return nav;
  nav = {
    signature, fields: new Map(), tiles: new Map(),
    grid: new Uint8Array(WIDTH * WIDTH),
    queue: new Uint16Array(WIDTH * WIDTH),
  };
  worlds.set(w, nav);
  return nav;
}
export function navigationMemory(w) {
  const nav = worlds.get(w);
  if (!nav) return { fields: 0, bytes: 0, limit: MAX_FIELDS };
  return {
    fields: nav.fields.size,
    bytes: nav.grid.byteLength + nav.queue.byteLength + nav.tiles.size * 1024 +
      [...nav.fields.values()].reduce((sum, field) => sum + field.costs.byteLength, 0),
    limit: MAX_FIELDS,
  };
}
export function lineClear(w, a, b, objects) {
  const dx = b.x - a.x, dy = b.y - a.y,
    steps = Math.ceil(Math.hypot(dx, dy) / 0.3);
  // A route's square neighborhood can contain hundreds of trees. Only those
  // whose expanded bounding box meets this segment can affect its samples.
  // Broad phase is conservative; the original rounded-footprint test remains.
  const possible = objects.filter((o) => segmentMayHit(a, dx, dy, o));
  for (let step = 0; step <= steps; step++) {
    const t = step / Math.max(1, steps),
      x = a.x + (b.x - a.x) * t,
      y = a.y + (b.y - a.y) * t;
    if (
      !walkableSurface(w, x, y) ||
      possible.some((o) => hitsFootprint(x, y, BODY_RADIUS, o))
    )
      return false;
  }
  return true;
}
function segmentMayHit(a, dx, dy, o) {
  const f = footprint(o);
  if (!f) return false;
  const rx = f[0] + BODY_RADIUS + 1e-9,
    ry = f[1] + BODY_RADIUS + 1e-9;
  let lo = 0, hi = 1;
  if (!dx) { if (Math.abs(a.x - o.x) > rx) return false; }
  else {
    const t0 = (o.x - rx - a.x) / dx, t1 = (o.x + rx - a.x) / dx;
    lo = Math.max(lo, Math.min(t0, t1));
    hi = Math.min(hi, Math.max(t0, t1));
  }
  if (!dy) { if (Math.abs(a.y - o.y) > ry) return false; }
  else {
    const t0 = (o.y - ry - a.y) / dy, t1 = (o.y + ry - a.y) / dy;
    lo = Math.max(lo, Math.min(t0, t1));
    hi = Math.min(hi, Math.max(t0, t1));
  }
  return lo <= hi;
}
function portal(w, c, target) {
  // River portals are actual completed bridge endpoints. This also handles trips
  // longer than a local field without allocating a world-sized navigation grid.
  const bridges = w.objects.filter(
    (o) => o.type === "bridge" && bridgeGeometry(o).complete,
  );
  let best = null;
  for (const b of bridges) {
    const { g, t, distance, dx, dy } = bridgePoint(b, c),
      to = bridgePoint(b, target);
    // A destination on the deck is already a final surface, not another bank.
    if (to.t >= 0 && to.t <= 1 && to.distance <= g.width / 2 - BODY_RADIUS)
      return null;
    const cside = t < 0.5 ? "a" : "b",
      tside = to.t < 0.5 ? "a" : "b";
    if (cside === tside && !(t > 0.04 && t < 0.96 && distance < g.width / 2))
      continue;
    const sign = tside === "b" ? 1 : -1,
      lane = g.width >= 2 ? Math.min(0.55, g.width / 2 - BODY_RADIUS - 0.1) : 0;
    const start = tside === "b" ? g.a : g.b,
      end = tside === "b" ? g.b : g.a;
    let bank = { x: start.x - dy * lane * sign, y: start.y + dx * lane * sign };
    let exit = { x: end.x - dy * lane * sign, y: end.y + dx * lane * sign };
    // Old saves may have construction close to an approach. Choose a clear
    // lane rather than treating one blocked preferred endpoint as no bridge.
    if (!clearPosition(w, bank) || !clearPosition(w, exit)) {
      const offset = [
        -lane * sign,
        0,
        g.width / 2 - BODY_RADIUS - 0.04,
        -g.width / 2 + BODY_RADIUS + 0.04,
      ].find(
        (offset) =>
          clearPosition(w, {
            x: start.x - dy * offset,
            y: start.y + dx * offset,
          }) &&
          clearPosition(w, { x: end.x - dy * offset, y: end.y + dx * offset }),
      );
      if (offset === undefined) continue;
      bank = { x: start.x - dy * offset, y: start.y + dx * offset };
      exit = { x: end.x - dy * offset, y: end.y + dx * offset };
    }
    const crossing = t > 0.04 && t < 0.96 && distance < g.width / 2;
    const point =
      crossing || Math.hypot(c.x - bank.x, c.y - bank.y) < 0.55 ? exit : bank;
    const cost =
      Math.hypot(c.x - bank.x, c.y - bank.y) +
      Math.hypot(target.x - exit.x, target.y - exit.y);
    if (!best || cost < best.cost) best = { ...point, cost };
  }
  return best;
}
function fieldFor(w, target, from = target) {
  const nav = navigation(w),
    tx = Math.round(target.x / CELL),
    ty = Math.round(target.y / CELL),
    // A target-centered 84-unit field excluded valid jobs 42–64 units away.
    // Shift the same bounded grid toward the worker for these longer routes.
    sx = Math.abs(from.x-target.x)>35 ? Math.sign(from.x-target.x)*32 : 0,
    sy = Math.abs(from.y-target.y)>35 ? Math.sign(from.y-target.y)*32 : 0,
    key = `${tx}:${ty}:${sx}:${sy}`;
  if (nav.fields.has(key)) return nav.fields.get(key);
  const ox = (tx + sx - WIDTH / 2) * CELL,
    oy = (ty + sy - WIDTH / 2) * CELL;
  const objects = [
    ...w.objects,
    ...(w.community?.project ? [{...w.community.project,id:`construction:${w.community.project.id}`}] : []),
    ...naturalObjects(
      w,
      ox - 4,
      oy - 4,
      ox + WIDTH * CELL + 4,
      oy + WIDTH * CELL + 4,
    ),
  ].filter(footprint);
  const count = WIDTH * WIDTH,
    grid = nav.grid,
    costs = new Int16Array(count).fill(-1);
  copyOccupancy(w,nav.tiles,grid,WIDTH,tx+sx-WIDTH/2,ty+sy-WIDTH/2);
  let start = -1,
    best = Infinity;
  const targetObjects = nearbyObstacles(w,target.x,target.y,CELL*3);
  for (let y = WIDTH / 2 - sy - 2; y <= WIDTH / 2 - sy + 2; y++)
    for (let x = WIDTH / 2 - sx - 2; x <= WIDTH / 2 - sx + 2; x++) {
      const i = y * WIDTH + x,
        p = { x: ox + x * CELL, y: oy + y * CELL },
        d = Math.hypot(p.x - target.x, p.y - target.y);
      if (!grid[i] && d < best && lineClear(w, p, target, targetObjects)) {
        best = d;
        start = i;
      }
    }
  if (start >= 0) {
    const queue = nav.queue;
    let head = 0,
      tail = 0;
    queue[tail++] = start;
    costs[start] = 0;
    while (head < tail) {
      const at = queue[head++],
        x = at % WIDTH,
        y = Math.floor(at / WIDTH);
      for (const n of [
        x > 0 ? at - 1 : -1,
        x < WIDTH - 1 ? at + 1 : -1,
        y > 0 ? at - WIDTH : -1,
        y < WIDTH - 1 ? at + WIDTH : -1,
      ])
        if (n >= 0 && costs[n] < 0 && !grid[n]) {
          costs[n] = costs[at] + 1;
          queue[tail++] = n;
        }
    }
  }
  // The cost sentinel already represents blocked/unreachable cells. Keep only
  // that array per destination; occupancy and BFS queue are shared scratch.
  const field = { ox, oy, costs, objects };
  nav.fields.set(key, field);
  if (nav.fields.size > MAX_FIELDS)
    nav.fields.delete(nav.fields.keys().next().value);
  return field;
}
export function waypoint(w, c, destination) {
  if (!destination || Math.abs(destination.x) > WORLD_EDGE - 4) return null;
  let target = destination;
  const bridge = portal(w, c, target);
  if (bridge) target = bridge;
  const len = Math.hypot(target.x - c.x, target.y - c.y);
  if (len > JOB_RADIUS) {
    // Coarse open-land leg, bounded by the same collision layer; never crosses water.
    target = {
      x: c.x + ((target.x - c.x) * 32) / len,
      y: c.y + ((target.y - c.y) * 32) / len,
    };
    if (!clearPosition(w, target)) return null;
  }
  const directObjects = nearbyObstacles(
    w,
    (c.x + target.x) / 2,
    (c.y + target.y) / 2,
    Math.hypot(target.x - c.x, target.y - c.y) / 2 + 4,
  );
  if (lineClear(w, c, target, directObjects)) return target;
  const field = fieldFor(w, target, c),
    { ox, oy, costs, objects } = field;
  if (
    Math.hypot(target.x - c.x, target.y - c.y) < 5 &&
    lineClear(w, c, target, objects)
  )
    return target;
  const cx = Math.round((c.x - ox) / CELL),
    cy = Math.round((c.y - oy) / CELL);
  if (cx < 1 || cy < 1 || cx >= WIDTH - 1 || cy >= WIDTH - 1) return null;
  let best = null,
    score = Infinity;
  // Every connector stays within 3 grid cells plus rounding of this body.
  // A destination's full 84-unit obstacle list made these short checks costly
  // for every resident in a spread-out colony.
  const connectorObjects = nearbyObstacles(w,c.x,c.y,CELL*3.5+BODY_RADIUS);
  // Steering can enter a legal gap narrower than a grid cell. Reconnect from
  // continuous space to a farther cell only when the near ring has no route.
  // Every connector is swept through the same obstacle/surface checks.
  for (let ring = 1; ring <= 3 && !best; ring++) {
  for (let dy = -ring; dy <= ring; dy++) for (let dx = -ring; dx <= ring; dx++) {
    if (ring > 1 && Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
    const x = cx + dx,
      y = cy + dy,
      i = y * WIDTH + x;
    if (x < 0 || y < 0 || x >= WIDTH || y >= WIDTH) continue;
    if (costs[i] < 0) continue;
    const p = { x: ox + x * CELL, y: oy + y * CELL };
    if (!lineClear(w, c, p, connectorObjects)) continue;
    if (Math.hypot(p.x - c.x, p.y - c.y) < 0.12) continue;
    const value = costs[i] + Math.hypot(p.x - c.x, p.y - c.y) * 0.15;
    if (value < score) {
      score = value;
      best = p;
    }
  }
  }
  return best;
}
export function routeCost(w, c, p) {
  const cache = planningCosts.get(w);
  if (!cache) return calculateRouteCost(w, c, p);
  const key = `${c.x}:${c.y}:${p.x}:${p.y}`;
  if (cache.has(key)) return cache.get(key);
  const cost = calculateRouteCost(w, c, p);
  if (cache.size < 8192) cache.set(key, cost);
  return cost;
}
function calculateRouteCost(w, c, p) {
  if (Math.hypot(c.x - p.x, c.y - p.y) > JOB_RADIUS) return Infinity;
  const directObjects = nearbyObstacles(
    w,
    (c.x + p.x) / 2,
    (c.y + p.y) / 2,
    Math.hypot(p.x - c.x, p.y - c.y) / 2 + 4,
  );
  if (lineClear(w, c, p, directObjects))
    return Math.hypot(p.x - c.x, p.y - c.y);
  if (!waypoint(w, c, p) && Math.hypot(c.x - p.x, c.y - p.y) > 0.25)
    return Infinity;
  const { ox, oy, costs } = fieldFor(w, p, c),
    x = Math.round((c.x - ox) / CELL),
    y = Math.round((c.y - oy) / CELL);
  const n =
    x >= 0 && y >= 0 && x < WIDTH && y < WIDTH ? costs[y * WIDTH + x] : -1;
  return n >= 0 ? n * CELL : Math.hypot(c.x - p.x, c.y - p.y);
}
