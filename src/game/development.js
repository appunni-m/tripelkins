import { BUILDINGS } from "./catalog.js";

export const CARE_BUILDINGS = ["orchard", "bath", "roundabout"];
export const INDEPENDENT_BUILDINGS = [...CARE_BUILDINGS, "mine", "factory", "dwelling", "theatre"];
export const RESOURCE_PROJECTS = {
  timber: { name: "Timber reserve", material: "wood" },
  quarry: { name: "Stone gathering", material: "ore" },
  refine: { name: "Block workshop", material: "blocks" },
  crossing: { name: "Supply the bridge", material: "wood" },
};
export const DEVELOPMENT_TYPES = [...INDEPENDENT_BUILDINGS, ...Object.keys(RESOURCE_PROJECTS)];
export const projectName = (p) => (BUILDINGS[p?.type] || RESOURCE_PROJECTS[p?.type])?.name || "Colony work";
export const isConstruction = (p) => INDEPENDENT_BUILDINGS.includes(p?.type);
export const projectFunded = (w, p = w.community.project) => p &&
  w.inventory.wood >= (BUILDINGS[p.type]?.wood || 0) &&
  w.inventory.blocks >= (BUILDINGS[p.type]?.cost || 0);
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
