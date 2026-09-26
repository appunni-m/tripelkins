import { BUILDINGS, unlocked } from "./catalog.js";
import { workProjects } from "./work-projects.js";

export const CARE_BUILDINGS = ["orchard", "bath", "roundabout"];
export const INDEPENDENT_BUILDINGS = [...CARE_BUILDINGS, "mine", "factory", "dwelling", "theatre", "cannon"];
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
  if (w.population >= 4 && !w.progress.bridge) {
    const bridge = w.objects.find(o=>o.type==="bridge");
    const value = bridge?.stock || 0;
    return {id:"story-bridge",kind:"bridge",project:"crossing",target:24,value,
      remaining:Math.max(0,24-value),title:"Build the river bridge",
      step:"Gather timber and carry 24 logs to open the way to the mountain."};
  }
  if (w.stage===2 && w.progress.peakBlocks<300) return {
    id:"story-first-blocks", kind:"blocks", project:"refine", target:300,
    value:w.progress.peakBlocks, remaining:Math.max(0,300-w.progress.peakBlocks),
    title:"Brightness in the stone", step:"Quarry rocks, collect ore and refine the first 300 blocks to unlock a stone workshop.",
  };
  return null;
}
export function industryMilestone(w) {
  if(w.memory.goals.some(g=>g.status==="active") || w.stage!==2 || w.progress.peakBlocks<300 || w.progress.energy>=1500000) return null;
  return {id:"story-industry",kind:"energy",project:"industry",target:1500000,
    value:w.progress.energy,remaining:1500000-w.progress.energy,title:"A new kind of world",
    step:"Build stocked mines and stone workshops in local neighborhoods; carry ore and produce energy. Keep care available."};
}
export function nextIndustryBuilding(w) {
  const projects=workProjects(w);
  const factories=w.objects.filter(o=>o.type==="factory").length+
    projects.filter(p=>p.type==="factory").length;
  const mines=w.objects.filter(o=>o.type==="mine" && o.stock>0).length+
    projects.filter(p=>p.type==="mine").length;
  const wantedMines=Math.min(Math.ceil(w.creatures.length/32),Math.max(1,Math.ceil(
    Math.max(1,factories)*(BUILDINGS.factory.capacity*3/2.8)/(BUILDINGS.mine.capacity*3/3))));
  if (mines<wantedMines) return "mine";
  if (factories<Math.ceil(w.creatures.length/48)) return "factory";
  return null;
}
export const projectName = (p) => (BUILDINGS[p?.type] || RESOURCE_PROJECTS[p?.type])?.name || "Colony work";
export const isConstruction = (p) => INDEPENDENT_BUILDINGS.includes(p?.type);
export function projectRequirements(w,p) {
  const result={wood:BUILDINGS[p?.type]?.wood||0,blocks:BUILDINGS[p?.type]?.cost||0};
  for(const earlier of workProjects(w)) {
    if(earlier.id===p?.id) break;
    result.wood+=BUILDINGS[earlier.type]?.wood||0;
    result.blocks+=BUILDINGS[earlier.type]?.cost||0;
  }
  return result;
}
export const projectFunded = (w, p = w.community.project) => {
  if(!p) return false;
  const needed=projectRequirements(w,p);
  return w.inventory.wood>=needed.wood && w.inventory.blocks>=needed.blocks;
};
export const uncommittedBlocks = w => Math.max(0,w.inventory.blocks-
  workProjects(w).reduce((n,p)=>n+(BUILDINGS[p.type]?.cost||0),0));

// Refill in batches, leaving room for the next building. This is a planning
// target, not a spending lock: care/building crews may always use stored wood.
// Account for concurrent building crews, while bounding the spare reserve.
export function timberReserve(w) {
  const largest = Math.max(12,...INDEPENDENT_BUILDINGS
    .filter(type=>unlocked(w,BUILDINGS[type]))
    .map(type=>BUILDINGS[type].wood || 0));
  const committed=workProjects(w).reduce((n,p)=>n+(BUILDINGS[p.type]?.wood||0),0);
  const target = Math.max(24,largest*2,Math.min(144,Math.ceil(w.creatures.length/8)*6))+committed;
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
  const needed=projectRequirements(w,p);
  if (w.inventory.wood < needed.wood) return `Gathering wood: ${w.inventory.wood}/${needed.wood}, including earlier crews`;
  if (w.inventory.blocks < needed.blocks) return `Waiting for blocks: ${w.inventory.blocks}/${needed.blocks}, including earlier crews`;
  return "The crew is building; care comes first.";
}
