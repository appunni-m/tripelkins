import { isExplored } from "./discovery.js";
import { freePosition, serviceSlots } from "./geometry.js";
import { routeCost } from "./navigation.js";
import { westBank } from "./map.js";
import { densityAt, densityReward } from "./density.js";
import { NEED_DECAY } from "./work-balance.js";
export function scoutLimit(w) { return Math.min(64, Math.max(1, Math.ceil(w.creatures.length / 12))); }
export function discoveryGain(w, p) {
  let gain = isExplored(w, p) ? 0 : 2;
  for (let i = 0; i < 8; i++)
    if (!isExplored(w, { x: p.x + Math.cos(i * Math.PI / 4) * 8,
      y: p.y + Math.sin(i * Math.PI / 4) * 8 })) gain++;
  return gain;
}
export function frontier(w, c, assignments) {
  if (Math.min(c.fed, c.clean, c.amused) < 68 || c.sickness > 20 || c.carry ||
      assignments.filter(a => a.task === "explore").length >= scoutLimit(w)) return null;
  const camps = w.objects.filter(o => ["orchard", "dwelling"].includes(o.type));
  const anchors = camps.length ? camps.slice().sort((a,b) =>
    Math.hypot(a.x-c.x,a.y-c.y)-Math.hypot(b.x-c.x,b.y-c.y)).slice(0,3) : [c];
  const phase = c.birthOrdinal * 2.399963, candidates = [];
  const scope = w.directives.members;
  // Follow a moving frontier. New food outposts extend the safe scouting range.
  for (const camp of anchors) for (let i = 0; i < 16; i++) {
    const angle = phase + i * Math.PI / 8;
    for (const radius of camps.length ? [16, 28, 40, 52] : [8, 14]) {
      const p = { x: camp.x + Math.cos(angle)*radius, y: camp.y + Math.sin(angle)*radius };
      if (Math.hypot(c.x-p.x,c.y-p.y)>60 || (!w.progress.bridge && !westBank(w,p))) continue;
      if (w.directives.region && (!scope.length || scope.includes(c.id)) && (p.x>42)!==(w.directives.region.x>42)) continue;
      if (assignments.some(a => a.task === "explore" && Math.hypot(a.point.x-p.x,a.point.y-p.y)<10)) continue;
      const gain = discoveryGain(w,p);
      if (gain) candidates.push({ ...p, score: gain*4-Math.hypot(c.x-p.x,c.y-p.y)*0.15+densityReward(densityAt(w,p).residents) });
    }
  }
  candidates.sort((a,b) => b.score-a.score);
  for (const candidate of candidates.slice(0,8)) {
    const p = freePosition(w,candidate,assignments.map(a=>a.point),2);
    if (!p || (!w.progress.bridge && !westBank(w,p)) || !discoveryGain(w,p)) continue;
    const cost = routeCost(w,c,p);
    // Budget the round trip to a reachable food entrance before hunger takes over.
    const home = camps.length ? Math.min(...anchors.flatMap(o=>serviceSlots(w,o).map(s=>routeCost(w,p,s)))) : cost;
    if (Number.isFinite(cost) && Number.isFinite(home) && (cost+home)/1.65*NEED_DECAY.fed<c.fed-45)
      return { x:p.x, y:p.y };
  }
  return null;
}
