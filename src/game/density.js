// Planning costs only: these penalties never change health or remove creatures.
export const DENSITY = Object.freeze({ radius: 10, target: 6, above: 4, below: 0.6,
  buildingRadius: 12, buildingTarget: 3 });
export const SETTLEMENT_TYPES = new Set(["orchard", "bath", "roundabout", "dwelling", "theatre", "factory", "mine"]);
const worlds = new WeakMap();
function index(w) {
  const stamp = `${Math.floor(w.time)}:${w.creatures.length}:${w.navRevision}`;
  if (worlds.get(w)?.stamp === stamp) return worlds.get(w);
  const cells = new Map();
  for (const c of w.creatures) {
    const key = `${Math.floor(c.x / 10)}:${Math.floor(c.y / 10)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(c);
  }
  const result = { stamp, cells, buildings: w.objects.filter(o => SETTLEMENT_TYPES.has(o.type)) };
  worlds.set(w, result);
  return result;
}
export function densityAt(w, p) {
  const { cells, buildings } = index(w);
  let neighbors = 0;
  for (let x = Math.floor((p.x - DENSITY.radius) / 10); x <= Math.floor((p.x + DENSITY.radius) / 10); x++)
    for (let y = Math.floor((p.y - DENSITY.radius) / 10); y <= Math.floor((p.y + DENSITY.radius) / 10); y++)
      for (const c of cells.get(`${x}:${y}`) || [])
        if (Math.hypot(c.x - p.x, c.y - p.y) <= DENSITY.radius) neighbors++;
  return { residents: neighbors * 100 / (Math.PI * DENSITY.radius ** 2),
    buildings: buildings.filter(o => Math.hypot(o.x - p.x, o.y - p.y) <= DENSITY.buildingRadius).length };
}
export function densityReward(value, target = DENSITY.target) {
  const ratio = (value - target) / target;
  return -(ratio >= 0 ? DENSITY.above : DENSITY.below) * ratio * ratio;
}
export function siteDensity(w, p) {
  const density = densityAt(w, p);
  const buildingExcess = Math.max(0, density.buildings + 1 - DENSITY.buildingTarget);
  return { ...density, reward: densityReward(density.residents) - buildingExcess * buildingExcess * 2 };
}
export function densitySummary(w) {
  const seen = new Set(), areas = [];
  for (const c of w.creatures) {
    const key = `${Math.floor(c.x / 12)}:${Math.floor(c.y / 12)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const p = { x: Math.floor(c.x / 12) * 12 + 6, y: Math.floor(c.y / 12) * 12 + 6 };
    areas.push({ ...p, ...densityAt(w, p) });
  }
  areas.sort((a, b) => b.residents - a.residents);
  return { target: DENSITY.target, abovePenalty: DENSITY.above, belowPenalty: DENSITY.below,
    crowded: areas.filter(a => a.residents > DENSITY.target * 1.2).length,
    areas: areas.slice(0, 6).map(a => ({ ...a, residents: Math.round(a.residents * 10) / 10 })) };
}
