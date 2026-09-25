import { BUILDINGS, unlocked } from "./catalog.js";

export const CARE_BUILDINGS = ["orchard", "bath", "roundabout"];
export const INDEPENDENT_BUILDINGS = [...CARE_BUILDINGS, "mine", "factory", "dwelling", "theatre"];
export const RESOURCE_PROJECTS = {
  timber: { name: "Timber reserve", material: "wood" },
  quarry: { name: "Stone gathering", material: "ore" },
  refine: { name: "Block workshop", material: "blocks" },
  crossing: { name: "Supply the bridge", material: "wood" },
};
export const DEVELOPMENT_TYPES = [...INDEPENDENT_BUILDINGS, ...Object.keys(RESOURCE_PROJECTS)];
// The story's visible objective must reach both planners even when the player
// has not spoken an explicit command. Player goals always take precedence.
export function colonyMilestone(w) {
  if (w.memory.goals.some(g=>g.status==="active") || w.stage>=3 || !w.progress.hatched) return null;
  if (w.stage===2 && w.progress.peakBlocks<300) return {
    id:"story-first-blocks", kind:"blocks", project:"refine", target:300,
    value:w.progress.peakBlocks, remaining:Math.max(0,300-w.progress.peakBlocks),
    title:"Brightness in the stone", step:"Quarry rocks, collect ore and refine the first 300 blocks to unlock a stone workshop.",
  };
  return null;
}
export const projectName = (p) => (BUILDINGS[p?.type] || RESOURCE_PROJECTS[p?.type])?.name || "Colony work";
export const isConstruction = (p) => INDEPENDENT_BUILDINGS.includes(p?.type);
export const projectFunded = (w, p = w.community.project) => p &&
  w.inventory.wood >= (BUILDINGS[p.type]?.wood || 0) &&
  w.inventory.blocks >= (BUILDINGS[p.type]?.cost || 0);

// Refill in batches, leaving room for the next building. This is a planning
// target, not a spending lock: care/building crews may always use stored wood.
// A single development crew works at a time, so huge colonies need no huge pile.
export function timberReserve(w) {
  const largest = Math.max(12,...INDEPENDENT_BUILDINGS
    .filter(type=>unlocked(w,BUILDINGS[type]))
    .map(type=>BUILDINGS[type].wood || 0));
  const target = Math.max(24,largest*2,Math.min(144,Math.ceil(w.creatures.length/8)*6));
  const minimum = Math.max(12,largest,Math.ceil(target/2));
  const stock = Math.floor(w.inventory.wood);
  const goal = w.memory.goals.find(g=>g.status==="active");
  return { stock, minimum, target, short:Math.max(0,target-stock),
    refill:stock<minimum && (!goal || ["grow","care"].includes(goal.kind)) };
}
export function projectPercent(w,p) {
  const value = p.type === "crossing" ? (w.objects.find(o=>o.type==="bridge")?.stock || 0)/24
    : RESOURCE_PROJECTS[p.type] ? w.inventory[RESOURCE_PROJECTS[p.type].material]/p.target
    : p.progress/p.required;
  return Math.min(100,Math.floor(100*value));
}
export function projectStatus(w, p = w.community.project) {
  if (!p) return "";
  if (p.type === "crossing") return "Cutting timber and carrying wood to the river.";
  const material = RESOURCE_PROJECTS[p.type]?.material;
  if (material) return `${Math.floor(w.inventory[material])}/${p.target} ${material} · ${p.type === "refine" ? "gather stone, then work the ore into blocks" : "gather nearby resources"}`;
  const spec = BUILDINGS[p.type];
  if (w.inventory.wood < (spec.wood || 0)) return `Gathering wood: ${w.inventory.wood}/${spec.wood}`;
  if (w.inventory.blocks < (spec.cost || 0)) return `Waiting for blocks: ${w.inventory.blocks}/${spec.cost}`;
  return "The crew is building; care comes first.";
}
