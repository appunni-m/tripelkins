import { coordinate, WORLD_EDGE } from "./map.js";

// Sixteen cells per saved region. If exploration fills the budget, merge cells
// at half resolution: old discoveries are retained, never evicted by new ones.
export const DISCOVERY_LIMIT = 2048;
export const SIGHT_RADIUS = 10;
export function createDiscovery() {
  return { version: 1, cell: 4, revision: 0, regions: {} };
}
function cellKey(x, y) {
  const cx = Math.floor(x / 4), cy = Math.floor(y / 4);
  return [`${cx}:${cy}`, 1 << ((y - cy * 4) * 4 + x - cx * 4)];
}
function known(d, x, y) {
  const [key, bit] = cellKey(x, y);
  return !!((d.regions[key] || 0) & bit);
}
function mark(d, x, y) {
  const [key, bit] = cellKey(x, y), before = d.regions[key] || 0;
  d.regions[key] = before | bit;
  return before !== d.regions[key];
}
function compact(d) {
  while (Object.keys(d.regions).length > DISCOVERY_LIMIT) {
    const old = d.regions;
    d.regions = {};
    for (const [key, mask] of Object.entries(old)) {
      const [cx, cy] = key.split(":").map(Number);
      for (let bit = 0; bit < 16; bit++) if (mask & (1 << bit))
        mark(d, Math.floor((cx * 4 + bit % 4) / 2), Math.floor((cy * 4 + Math.floor(bit / 4)) / 2));
    }
    d.cell *= 2;
  }
}
export function reveal(w, p, radius = SIGHT_RADIUS) {
  const d = w.discovery;
  if (!d || !Number.isFinite(p?.x) || !Number.isFinite(p?.y)) return false;
  let changed = false;
  const x = coordinate(p.x), y = coordinate(p.y);
  radius = Math.max(d.cell, Math.min(64, radius));
  for (let gy = Math.floor((y-radius)/d.cell); gy <= Math.floor((y+radius)/d.cell); gy++)
    for (let gx = Math.floor((x-radius)/d.cell); gx <= Math.floor((x+radius)/d.cell); gx++)
      if (Math.hypot((gx+.5)*d.cell-x,(gy+.5)*d.cell-y) <= radius)
        changed = mark(d,gx,gy) || changed;
  if (changed) { compact(d); d.revision++; }
  return changed;
}
export function isExplored(w, p) {
  if (w.stage >= 3) return true; // The final scene has its own visibility rules.
  const d = w.discovery;
  return !!d && known(d,Math.floor(p.x/d.cell),Math.floor(p.y/d.cell));
}
export function revealColony(w) {
  for (const c of w.creatures) reveal(w,c);
}
export function normalizeDiscovery(raw, w) {
  const d = createDiscovery();
  if (raw != null) {
    if (raw.version !== 1 || !Number.isInteger(raw.cell) || raw.cell < 4 || raw.cell > 2**32 ||
        !Number.isInteger(Math.log2(raw.cell)) || !raw.regions || Array.isArray(raw.regions) ||
        typeof raw.regions !== "object" || Object.keys(raw.regions).length > DISCOVERY_LIMIT)
      throw new Error("This saved world's explored map is invalid or needs a newer version.");
    d.cell = raw.cell;
    for (const [key,mask] of Object.entries(raw.regions)) {
      if (!/^-?\d{1,10}:-?\d{1,10}$/.test(key) || key.split(":").some(v=>Math.abs(+v)>WORLD_EDGE/(d.cell*4)+1) ||
          !Number.isInteger(mask) || mask < 1 || mask > 65535)
        throw new Error("This saved world's explored map is damaged.");
      d.regions[key] = mask;
    }
    d.revision = Math.max(0,Math.min(1e12,Number(raw.revision)||0));
    return d;
  }
  // Old saves had a visible clearing. Preserve it, settlements and the retained
  // scout destinations, without treating today's camera position as discovery.
  const view = {...w,discovery:d};
  reveal(view,{x:32,y:24},40);
  for (const o of w.objects.filter(o=>!['tree','rock','flowers','stump','node','mountain'].includes(o.type))) reveal(view,o);
  revealColony(view);
  for (const key of w.community.visited) {
    const [x,y] = key.split(":").map(Number);
    reveal(view,{x:x*8+4,y:y*8+4});
  }
  return d;
}
export function discoverySummary(w) {
  const d = w.discovery;
  let cells = 0;
  for (const mask of Object.values(d.regions)) {
    let bits = mask;
    while (bits) { bits &= bits-1; cells++; }
  }
  return { area:cells*d.cell*d.cell, resolution:d.cell, regions:Object.keys(d.regions).length };
}
