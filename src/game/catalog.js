import { orbitalReady, ORBIT_SETTLERS } from "./orbit-rules.js";
import { bridgeProject } from "./bridge-project.js";
export const LIMITS = Object.freeze({
  // Serialization/memory safeguards, not the normal gameplay growth limit.
  // Live birth admission follows measured device headroom in growth-budget.js.
  creatures: 2048,
  objects: 2048,
  events: 160,
  summaries: 64,
  journal: 512,
});
export const BUILDINGS = {
  sculpture: {
    name: "Keepsake",
    icon: "sculpture",
    stage: 2,
    blocks: 100,
    cost: 50,
    capacity: 2,
    help: "Place it, then leave logs nearby. Twelve wood make a shared reminder.",
  },
  bath: {
    name: "Rain shower",
    icon: "bath",
    population: 6,
    wood: 6,
    capacity: 1,
    help: "A little privacy. Cleans one creature at a time.",
  },
  orchard: {
    name: "Banana grove",
    icon: "orchard",
    population: 10,
    wood: 10,
    capacity: 3,
    help: "Grows a small, replenishing supply of bananas.",
  },
  roundabout: {
    name: "Bounce garden",
    icon: "roundabout",
    population: 15,
    wood: 12,
    capacity: 5,
    help: "A place to play together.",
  },
  mine: {
    name: "Mine",
    icon: "mine",
    blocks: 50,
    cost: 25,
    wood: 12,
    capacity: 4,
    stage: 2,
    help: "Place on a stone deposit. Workers extract ore.",
  },
  dwelling: {
    name: "Cottage",
    icon: "dwelling",
    blocks: 200,
    cost: 100,
    wood: 18,
    capacity: 6,
    stage: 2,
    help: "Food, showers, and somewhere to belong.",
  },
  factory: {
    name: "Stone workshop",
    icon: "factory",
    blocks: 300,
    cost: 150,
    wood: 24,
    capacity: 5,
    stage: 2,
    help: "Turns ore into blocks. Leaves pollution behind.",
  },
  theatre: {
    name: "Clubhouse",
    icon: "theatre",
    blocks: 1000,
    cost: 500,
    wood: 36,
    capacity: 20,
    stage: 2,
    help: "Entertains a crowd and puts a spring in their step.",
  },
  flowers: {
    name: "Flowers",
    icon: "flowers",
    population: 4,
    wood: 1,
    capacity: 0,
    help: "Some things need no practical purpose.",
  },
  tnt: {
    name: "Demolition charge",
    icon: "tnt",
    energy: 1500000,
    cost: 0,
    stage: 2,
    capacity: 0,
    help: "Place by the mountain. Tap to detonate.",
  },
  cannon: {
    name: "Sky launcher",
    icon: "cannon",
    flag: "secondContact",
    cost: 0,
    capacity: 8,
    help: "Healthy volunteers travel to a shared home in orbit. Tap to see their destination and arrivals.",
  },
};
export const TOOLS = {
  inspect: {
    name: "Hand",
    icon: "hand",
    help: "Drag or use arrows to explore. Scroll, pinch or + / − to zoom. COLONY brings you home.",
  },
  banana: {
    name: "Banana",
    icon: "banana",
    help: "Tap the grass to drop a banana. Hungry creatures will find it.",
  },
  cloth: {
    name: "Cloth",
    icon: "cloth",
    help: "Tap a creature to wash them.",
  },
  cricketball: {
    name: "Cricket ball",
    icon: "cricketball",
    help: "Tap the grass to put down a cricket ball.",
  },
  axe: {
    name: "Axe",
    icon: "axe",
    population: 4,
    help: "Tap a tree. Nearby creatures carry the logs to the bridge.",
  },
  hammer: {
    name: "Hammer",
    icon: "hammer",
    population: 20,
    help: "Break rocks into ore, ore into blocks. Remove buildings or stumps.",
  },
  meteor: {
    name: "Meteor",
    icon: "meteor",
    population: 4,
    help: "Drop a meteor inside the marked circle. Destroys trees and buildings, and kills creatures caught in the impact.",
  },
  bug: {
    name: "Reclaimer",
    icon: "bug",
    flag: "monolith",
    help: "Turns a creature into bones. The colony remembers this choice.",
  },
  pickaxe: {
    name: "Pickaxe",
    icon: "pickaxe",
    blocks: 15,
    stage: 2,
    help: "Break nearby rocks into ore.",
  },
  chainsaw: {
    name: "Chainsaw",
    icon: "chainsaw",
    blocks: 400,
    stage: 2,
    help: "Clear a cluster of trees.",
  },
  grabber: {
    name: "Carry",
    icon: "hand",
    flag: "grabber",
    help: "Pick up a material stack or remains, then tap clear ground to place it.",
  },
  swarm: {
    name: "Reclaimer sweep",
    icon: "bug",
    flag: "swarm",
    help: "Reclaims an area. Creatures within it will be lost.",
  },
  mop: {
    name: "Scrub brush",
    icon: "cloth",
    flag: "pollution",
    help: "Clean polluted ground and the creatures around it.",
  },
};
export const TASK_NAMES = {
  gather: "Cutting and gathering timber",
  quarry: "Breaking stone and collecting ore",
  refine: "Working ore into blocks",
  construct: "Building for the colony",
  clean: "Caring for the clearing",
  idle: "Looking around",
  explore: "Investigating",
  social: "Spending time together",
  rest: "Resting",
  eat: "Looking for a banana",
  wash: "Taking a shower",
  play: "Playing",
  haul: "Carrying wood",
  mine: "Mining",
  work: "Making blocks",
  home: "Resting at home",
  orbit: "Going to orbit",
};
// Save-format keys are stable; only these labels belong in player-facing UI.
export function displayName(type) {
  return BUILDINGS[type]?.name || TOOLS[type]?.name || {
    tree: "Timber oak", stump: "Tree stump", rock: "Rock", node: "Stone deposit",
    log: "Timber", bone: "Bones", corpse: "Remains", ore: "Ore", blocks: "Cut stone",
    lander: "Spacecraft", monolith: "Survey beacon", mountain: "Mountain",
    bridge: "River bridge", hole: "Departure gate", creature: "Tripelkin",
  }[type] || "Colony object";
}
export function eventLabel(kind) {
  return { hatch: "arrival", monolith: "survey", tnt: "demolition", nuke: "departure" }[kind] || String(kind).replaceAll("-", " ");
}
export function buildingMaterials(spec) {
  return { wood: spec?.wood || 0, blocks: spec?.cost || 0 };
}
export function buildingCost(spec) {
  return Object.entries(buildingMaterials(spec)).filter(([,amount])=>amount>0)
    .map(([kind,amount])=>`${amount.toLocaleString()} ${kind}`).join(" + ") || "No materials";
}
export function unlocked(w, spec) {
  return (
    (!spec.population || w.population >= spec.population) &&
    (!spec.stage || w.stage >= spec.stage) &&
    (!spec.blocks || w.progress.peakBlocks >= spec.blocks) &&
    (!spec.energy || w.progress.energy >= spec.energy) &&
    (!spec.flag || w.progress[spec.flag])
  );
}
export function lockReason(spec) {
  if (spec.population) return `${spec.population} creatures`;
  if (spec.blocks) return `${spec.blocks.toLocaleString()} blocks`;
  if (spec.energy) return "1.5M energy";
  return "Keep exploring";
}
export function goal(w) {
  if (!w.progress.hatched)
    return ["A LITTLE LANDING", "Tap the spacecraft. Someone has arrived."];
  if (w.progress.hatched && w.population === 0)
    return [
      "THE CLEARING IS QUIET",
      "Your story is saved. Start a new landing in Options.",
    ];
  if (w.stage === 4)
    return ["JOURNEY RECORDED", "Open the colony journal to revisit this settlement."];
  if (w.stage === 3)
    return [
      "MAKE A CONNECTION",
      "Drag the remaining creatures into the opening.",
    ];
  if (orbitalReady(w))
    return ["ONE LAST CHANGE", "Visit the survey beacon."];
  if (w.progress.cannon)
    return ["A HOME ABOVE", `${Math.min(w.orbital.launches, ORBIT_SETTLERS)} / ${ORBIT_SETTLERS} journeys to the orbital home. Tap IN ORBIT to visit.`];
  if (w.progress.tnt && !w.progress.secondContact)
    return ["A NEW ROUTE", "Visit the survey beacon revealed near the mountain."];
  if (w.progress.tnt)
    return ["BEYOND THE SKY", "Build a sky launcher. Grow an orbital home."];
  if (w.population >= 4 && !w.progress.bridge) {
    const bridge = bridgeProject(w);
    return ["BUILD THE BRIDGE", bridge
      ? `${Math.floor(bridge.delivered)}/${bridge.required} delivered. ${bridge.carried ? `${bridge.carried} being carried.` : bridge.staged ? "Materials are ready for carriers." : "Chop trees or send stored wood."} Tap to find the crossing.`
      : "Chop trees. Your creatures will carry wood to the river."];
  }
  if (w.stage === 2 && w.progress.peakBlocks < 300)
    return [
      "BRIGHTNESS IN THE STONE",
      w.community?.consent === "accepted"
        ? "Your independent crew can quarry rocks and work ore into blocks. A stone workshop unlocks at 300 blocks."
        : "Take ore from its counter; hammer it into blocks. Unlock a stone workshop at 300 blocks.",
    ];
  if (w.stage === 2)
    return w.progress.energy >= 1500000
      ? ["THE MOUNTAIN", "Place a demolition charge beside the mountain, then tap the charge."]
      : ["A NEW KIND OF WORLD", "Mine ore. Make blocks. Reach 1.5M energy."];
  if (w.population < 4)
    return [
      "GROW TRIPELKIN NUMBERS",
      "Keep each little one fed, clean and amused.",
    ];
  return [
    "WHAT LIES BEYOND?",
    "Chop trees. Your creatures will carry wood to the bridge.",
  ];
}
