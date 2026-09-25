import { BUILDINGS } from "./catalog.js";
import { nearbyObjects, isGround, westBank, clearNatural } from "./map.js";
import { addObject, materializeObject, remember } from "./state.js";
import { die } from "./resources.js";
import { noteEvidence } from "./story.js";
import { activity, postMessage } from "./community.js";

// An original caretaker tool. This is deliberately absent from model actions.
export const METEOR_RADIUS = 2.5;
export function meteorTargetError(w,x,y) {
  if (w.stage >= 3) return "This story has reached the connection.";
  if (!Number.isFinite(x+y) || !isGround(w,x,y) || (!w.progress.bridge && !westBank(w,{x,y})))
    return "Aim at reachable ground.";
  return null;
}
const destructible = new Set([
  "tree", "rock", "stump", "flowers", "cricketball", ...Object.keys(BUILDINGS)
].filter((type) => !["tnt", "cannon"].includes(type)));
export function meteorImpact(w, x, y) {
  const error=meteorTargetError(w,x,y);
  if (error) return {message:error};
  const victims = w.creatures.filter((c) => Math.hypot(c.x-x,c.y-y) <= METEOR_RADIUS);
  const targets = nearbyObjects(w,x,y,METEOR_RADIUS+2).filter((o) =>
    destructible.has(o.type) && Math.hypot(o.x-x,o.y-y) <= METEOR_RADIUS);
  let destroyed = 0, blocked = 0;
  for (let o of targets) {
    if (o.type === "tree") {
      o = materializeObject(w,o);
      if (!o) { blocked++;continue; }
      o.type = "stump"; // Burning a tree yields no building materials.
    } else {
      if (!clearNatural(w,o)) { blocked++;continue; }
      w.objects = w.objects.filter((a) => a.id !== o.id);
      w.inventory.ore += o.inputOre || 0;
      if (o.type === "mine") addObject(w,"node",o.x,o.y,{stock:o.stock,level:o.quality || 1});
    }
    destroyed++;
  }
  const lost = die(w,victims,"meteor",addObject,remember);
  // Finish/cancel pending work at an erased site on the next scheduler pass.
  for (const c of w.creatures) if (targets.some((o) => o.id === c.target)) {
    c.task = "idle"; c.target = null; c.job = null; c.work = 0;
  }
  const project = w.community.project;
  if (project && Math.hypot(project.x-x,project.y-y) <= METEOR_RADIUS) {
    w.community.project = null;
    w.community.lastProjectAt = w.time;
    activity(w,"construction","The meteor destroyed our unfinished building.","You");
  }
  w.navRevision++;
  w.commandRevision++;
  const detail = `${lost} lives lost; ${destroyed} trees, rocks or structures struck.`;
  noteEvidence(w,"meteor",`A meteor fell at (${Math.round(x)}, ${Math.round(y)}). ${detail}`);
  remember(w,"meteor",detail);
  activity(w,"meteor",detail,"You");
  postMessage(w,{ key:"meteor-first", title:"Something fell from the sky",
    text:lost ? "The same sky that gave us bananas took someone away. We remember who was here."
      : "Something fell from the sky. We saw what it could do to the world around us." });
  return { sound:"meteor", effect:{type:"meteor",x,y},
    message: `${detail}${blocked ? " Some ground could not be changed because the saved map is full." : ""}` };
}
