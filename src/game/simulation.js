import { workerProject } from "./work-projects.js";
import { orbitalReady } from "./orbit-rules.js";
import { acceptsProject, projectState, supplyProject } from "./projects.js";
import { NEED_DECAY, USEFUL_TASKS } from "./work-balance.js";
import { requestAccess, reviewAccess, clearanceTask } from "./access.js";
import { bridgeProject } from "./bridge-project.js";
import { meteorImpact } from "./destruction.js";
import { canEnterBridge } from "./traffic.js";
import { BUILDINGS, TOOLS, LIMITS, unlocked, displayName, buildingCost } from "./catalog.js";
import {
  addCreature,
  addObject,
  random,
  remember,
  materializeObject,
  clamp,
} from "./state.js";
import {
  nearbyObjects,
  naturalObject,
  clearNatural,
  isGround,
  westBank,
} from "./map.js";
import { waypoint } from "./navigation.js";
import { makePlan, applyPlan, minimum, syncGroups, capacity } from "./jobs.js";
import {
  bridgeGeometry,
  serviceSlots,
  sweptMove,
  steerMove,
  separateBodies,
  canPlace,
  clearPosition,
  freePosition,
} from "./geometry.js";
import { advanceGoals, goalPolicy } from "./goals.js";
import { encounter } from "./identity.js";
import {
  deliver,
  releaseCargo,
  die,
  deposit,
  pollute,
  pollutionAt,
  cleanPollution,
  maintainFactory,
} from "./resources.js";
import {
  stepCohorts,
  launch,
  syncPopulation,
  refreshDistrict,
} from "./population.js";
import { updateStory, noteEvidence, assessment } from "./story.js";
import { SOCIAL } from "./story-content.js";
import { offerIndependence, visitFrontier, activity, postMessage } from "./community.js";
import { independent, projectAllowed, prepareTimber, finishSettlement, storedSupply, deliveryStock, refiningOreReserve, factoryInputTarget } from "./settlement.js";
import { projectFunded } from "./development.js";
export { makePlan, applyPlan, capacity };
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
import { revealColony } from "./discovery.js";
import { updateDevelopmentPlan } from "./development-plan.js";
import { densityAt, DENSITY } from "./density.js";
export function reachable(w, c, o) {
  return serviceSlots(w, o, c).some(
    (p) => waypoint(w, c, p) || distance(c, p) < 0.3,
  );
}
function finish(w, c, result = "completed") {
  if (result === "completed" && USEFUL_TASKS.has(c.task)) c.workCycles = (c.workCycles || 0) + 1;
  w.memory.activity[c.task] = (w.memory.activity[c.task] || 0) + 1;
  w.memory.jobs.push({
    task: c.task,
    unit: c.id,
    target: c.target || "",
    tick: Math.floor(w.time),
  });
  w.memory.jobs = w.memory.jobs.slice(-64);
  if (c.job) c.job.state = result;
  w.metrics.completed++;
  c.work = 0;
  c.task = "idle";
  c.target = null;
}
function block(w, c, reason) {
  if (c.job?.point && /path|route|position/.test(reason)) requestAccess(w,{
    unit:c.id,task:c.task,target:c.target,project:c.job.project,point:c.job.point,reason});
  if (c.target) {
    c.blocked.push({
      target: c.target,
      until: w.time + 20,
      revision: w.navRevision,
    });
    c.blocked = c.blocked.slice(-8);
  }
  w.metrics.stalls++;
  if (c.job) c.job.state = "blocked";
  c.work = 0;
  c.task = "idle";
  c.target = null;
  if (w.time - (w.runtime?.lastBlockReport || 0) > 30) {
    remember(w, "blocked", `${c.name}: ${reason}`, c.id);
    w.runtime = { ...(w.runtime || {}), lastBlockReport: w.time };
  }
}
const paths = new WeakMap();
function travel(w, c, dt) {
  const job = c.job;
  if (!job?.point) return false;
  const len = distance(c, job.point);
  if (job.bestDistance == null || len < job.bestDistance - 0.15) {
    job.bestDistance = len;
    job.progressAt = w.time;
  }
  const target = w.objects.find((o) => o.id === c.target);
  const loose = ["banana", "log", "ore", "bone"].includes(target?.type);
  // Interaction has an arm's reach. Requiring an exact point made nearby food
  // unreachable when another body's edge occupied the last few centimetres.
  if (len < 0.42 || (loose && distance(c, target) < 0.85)) {
    job.state = "working";
    return true;
  }
  if (!canEnterBridge(w, c, job.point)) {
    job.state = "queued";
    job.lastProgress = w.time;
    job.progressAt = w.time;
    job.started += dt;
    return false;
  }
  const signature = `${w.navRevision}:${w.map.revision}:${job.point.x}:${job.point.y}`;
  let path = paths.get(c);
  if (path && path.signature === signature && distance(c,path.point)<0.2)
    job.progressAt = w.time; // Progress along a detour need not approach the final point.
  if (
    !path ||
    path.signature !== signature ||
    distance(c, path.point) < 0.2 ||
    w.time - path.at > 3
  ) {
    const point = waypoint(w, c, job.point);
    path = point ? { signature, point, at: w.time, bestDistance:distance(c,point) } : null;
    if (path) paths.set(c, path);
    else paths.delete(c);
  }
  const p = path?.point;
  if (!p) {
    block(w, c, "No clear path to the work position.");
    return false;
  }
  const dx = p.x - c.x,
    dy = p.y - c.y,
    d = Math.hypot(dx, dy),
    speed = c.boostUntil > w.time ? 2.1 : 1.65;
  const stride = Math.min(speed * dt, d),
    moved = steerMove(
      w,
      c,
      (dx / Math.max(d, 0.001)) * stride,
      (dy / Math.max(d, 0.001)) * stride,
    );
  job.state = moved > 0.001 ? "travelling" : "queued";
  if (moved > 0.01) {
    job.lastProgress = w.time;
    c.heading = Math.atan2(dy, dx);
    // Long bridge approaches may move away from the final destination for
    // more than 30 seconds. Count forward progress along the current leg;
    // the overall journey deadline still catches endless detours/oscillation.
    const remaining=distance(c,p);
    if (remaining < path.bestDistance-.15) {
      path.bestDistance=remaining;
      job.progressAt=w.time;
    }
  }
  if (
    w.time - job.lastProgress > 8 ||
    w.time - (job.progressAt ?? job.started) > 30 ||
    w.time - job.started > job.expected + 45
  )
    block(w, c, "The route or service position stayed blocked.");
  return false;
}
export function stepWorld(w, dt) {
  if (w.ui.paused || !w.progress.hatched || w.stage >= 3) return;
  dt = clamp(dt, 0, 0.1);
  w.time += dt;
  if (!w.runtime || w.time - (w.runtime.lastSchedule ?? -10) >= 2) {
    for (const g of advanceGoals(w))
      remember(w, "goal-complete", `We reached our goal: ${g.kind}.`);
    applyPlan(w, makePlan(w, goalPolicy(w)));
    w.runtime = { ...(w.runtime || {}), lastSchedule: w.time };
    revealColony(w);
    syncGroups(w);
    updateStory(w);
    offerIndependence(w);
    prepareTimber(w);
    reviewAccess(w);
    updateDevelopmentPlan(w);
  }
  const deaths = [],
    births = [];
  // Get a new colony to its first 21 named residents quickly, then return to
  // the long-term growth pace. Device headroom and care remain separate gates.
  const earlyGrowth = w.creatures.length < 20;
  const configuredGrowthLimit = Number(w.runtime?.growth?.limit ?? LIMITS.creatures);
  const growthLimit = Math.min(LIMITS.creatures,
    Number.isFinite(configuredGrowthLimit) ? Math.max(0, Math.floor(configuredGrowthLimit)) : LIMITS.creatures,
    earlyGrowth ? 21 : LIMITS.creatures);
  const growthSeconds = earlyGrowth ? 5 : 180;
  for (const c of [...w.creatures]) {
    if (
      c.carry > 0 &&
      !w.objects.some((o) =>
        c.cargoKind === "ore"
          ? o.type === "factory" && (o.inputOre || 0) < 60
          : (o.type === "bridge" && !bridgeGeometry(o).complete) ||
            acceptsProject(o, c.cargoKind),
      )
    )
      releaseCargo(w, c);
    c.age += dt;
    c.fed = Math.max(0, c.fed - dt * NEED_DECAY.fed);
    c.clean = Math.max(0, c.clean - dt * NEED_DECAY.clean);
    c.amused = Math.max(0, c.amused - dt * NEED_DECAY.amused);
    const exposure = pollutionAt(w, c);
    c.sickness = clamp(
      (c.sickness || 0) + dt * (exposure > 12 ? exposure * 0.025 : -0.5),
      0,
      100,
    );
    c.clean = Math.max(0, c.clean - dt * exposure * 0.004);
    if (minimum(c) <= 0 || c.sickness >= 100) c.deadTime += dt;
    else c.deadTime = 0;
    if (c.deadTime >= 28) {
      deaths.push({ c, cause: c.sickness >= 100 ? "pollution" : "neglect" });
      continue;
    }
    c.growth =
      minimum(c) > 65 && c.sickness < 25
        ? Math.min(50, c.growth + dt * 50 / growthSeconds *
          Math.min(1, DENSITY.target / Math.max(DENSITY.target, densityAt(w,c).residents)))
        : Math.max(0, c.growth - dt * 0.25);
    if (
      c.growth >= 50 &&
      w.population < 1e15 && w.creatures.length < growthLimit &&
      !w.runtime?.growth?.held
    ) {
      births.push(c);
    }
    if (c.task === "idle" || !c.job || ["completed", "blocked", "cancelled"].includes(c.job.state))
      continue;
    const o = w.objects.find((o) => o.id === c.target);
    if (["gather", "quarry", "refine", "construct"].includes(c.task) && clearanceTask(w,c)?.task!==c.task && (!projectAllowed(w,c) ||
        (["construct","refine"].includes(c.task) && c.job.project !== workerProject(w,c)?.id))) {
      c.task = "idle"; c.target = null; c.job = null; continue;
    }
    if (c.target && !o) {
      block(w, c, "That destination is no longer here.");
      continue;
    }
    if (!travel(w, c, dt)) continue;
    c.work += dt;
    c.job.lastProgress = w.time;
    if (c.carry && ["eat", "wash", "play", "home"].includes(c.task)) {
      deposit(
        w,
        c.cargoKind === "bones"
          ? "bone"
          : c.cargoKind === "ore"
            ? "ore"
            : "log",
        c.x,
        c.y,
        c.carry,
        addObject,
      );
      c.carry = 0;
      c.cargoKind = null;
    }
    if (c.task === "eat") {
      if (!o?.stock) {
        block(w, c, "The last banana was eaten.");
        continue;
      }
      c.fed = Math.min(100, c.fed + dt * 26);
      if (c.work >= 1.5) {
        o.stock--;
        if (o.type === "banana" && o.stock <= 0) o.remove = true;
        noteEvidence(w, "care", `${c.name} finished a meal.`, 1, c.id);
        finish(w, c);
      }
    } else if (c.task === "wash") {
      c.clean = Math.min(100, c.clean + dt * 24);
      c.sickness = Math.max(0, c.sickness - dt * 3);
      if (c.clean >= 98) finish(w, c);
    } else if (c.task === "play") {
      c.amused = Math.min(100, c.amused + dt * 18);
      if (o?.type === "theatre") {
        c.boostUntil = w.time + 60;
        c.sickness = Math.max(0, c.sickness - dt * 4);
      }
      if (c.amused >= 98) finish(w, c);
    } else if (c.task === "home") {
      c.fed = Math.min(100, c.fed + dt * 14);
      c.clean = Math.min(100, c.clean + dt * 16);
      c.sickness = Math.max(0, c.sickness - dt * 2);
      if (Math.min(c.fed, c.clean) >= 97) finish(w, c);
    } else if (c.task === "clean") {
      const removed = maintainFactory(w, o, dt * 4);
      if (removed) noteEvidence(w, "cleaned", `${c.name} maintained the works.`, removed, c.id);
      if (c.work >= 5 || !removed) finish(w, c);
    } else if (c.task === "haul" && c.work >= 1.2) {
      const supply = !c.carry && o && storedSupply(w,c,o);
      if (supply) {
        const limit = supply==="wood" ? bridgeGeometry(o).required-o.stock : factoryInputTarget(o)-(o.inputOre||0);
        const amount = Math.min(3,deliveryStock(w,supply),limit);
        w.inventory[supply]-=amount;
        if (supply==="ore") o.inputOre=(o.inputOre||0)+amount;
        else { c.carry=amount;c.cargoKind="wood";deliver(w,c,o,remember); }
        finish(w,c);
      } else if (!c.carry && ["bridge","factory"].includes(o?.type)) {
        block(w,c,"The stored delivery is no longer available.");
      } else if (acceptsProject(o, c.cargoKind)) {
        supplyProject(w, c, o, remember, noteEvidence);
        finish(w, c);
      } else if (o?.type === "bridge") {
        deliver(w, c, o, remember);
        finish(w, c);
      } else if (o?.type === "factory" && c.cargoKind === "ore") {
        const amount = Math.min(c.carry, 60 - (o.inputOre || 0));
        o.inputOre = (o.inputOre || 0) + amount;
        c.carry -= amount;
        if (!c.carry) c.cargoKind = null;
        finish(w, c);
      } else if (o?.stock > 0) {
        const kind =
          o.type === "bone" ? "bones" : o.type === "ore" ? "ore" : "wood";
        const amount = Math.min(o.stock, kind === "bones" ? 4 : 3);
        o.stock -= amount;
        if(kind==="ore" && workerProject(w,c)?.type==="refine") w.inventory.ore+=amount;
        else { c.carry += amount; c.cargoKind = kind; }
        if (!o.stock) o.remove = true;
        finish(w, c);
      } else block(w, c, "The material was already collected.");
    } else if (c.task === "mine" && c.work >= 3) {
      const n = Math.min(o.stock, 3 * o.level * (o.quality || 1));
      o.stock -= n;
      if (
        w.objects.some((o) => o.type === "factory") && w.inventory.ore>=refiningOreReserve(w) &&
        !w.memory.goals.some((g) => g.kind === "ore" && g.status === "active")
      ) {
        c.carry = n;
        c.cargoKind = "ore";
      } else w.inventory.ore += n;
      finish(w, c);
    } else if (c.task === "work" && c.work >= 2.8) {
      const amount = Math.min(o.inputOre || 0, 3 * o.level);
      if (!amount) {
        block(w, c, "The works need a delivery of ore.");
        continue;
      }
      o.inputOre -= amount;
      const blocks = amount * 8;
      w.inventory.blocks += blocks;
      w.progress.energy += blocks * 1024;
      pollute(w, o, 0.5 * o.level);
      finish(w, c);
    } else if (c.task === "orbit" && c.work >= 5) {
      finish(w, c);
      launch(w, c, remember);
    } else if (c.task === "gather" && c.work >= 6) {
      if (o?.type === "tree") {
        o.type = "stump";
        w.inventory.wood += 6;
        w.progress.chopped++;
        w.navRevision++;
        remember(w,"self-gather",`${c.name} cut a tree and gathered six wood for the colony.`,c.id);
      } else if (o?.type === "log" && o.stock > 0) {
        const amount = Math.min(3,o.stock);
        o.stock -= amount; w.inventory.wood += amount;
        if (!o.stock) o.remove = true;
      }
      finish(w,c);
    } else if (c.task === "quarry" && c.work >= 6) {
      if (o?.type === "rock") {
        o.type="ore";o.stock=3;w.navRevision++;
        remember(w,"self-quarry",`${c.name} broke a rock into three ore.`,c.id);
        activity(w,"quarry",`${c.name} broke a rock into ore.`,"Instincts");
      } else if (o?.type === "ore" && o.stock>0) {
        const amount=Math.min(3,o.stock);o.stock-=amount;w.inventory.ore+=amount;
        if (!o.stock) o.remove=true;
      }
      finish(w,c);
    } else if (c.task === "refine" && c.work >= 3) {
      if (w.inventory.ore<1) { block(w,c,"The workshop needs more ore.");continue; }
      w.inventory.ore--;w.inventory.blocks+=10;w.progress.energy+=10;
      finish(w,c);
    } else if (c.task === "construct") {
      const project = workerProject(w,c);
      if (independent(w) && projectFunded(w,project))
        project.progress = Math.min(project.required,project.progress+dt);
    } else if (c.task === "explore" && c.work >= 3) {
      encounter(c, "discovery", o?.id || `ground:${Math.floor(c.x/8)}:${Math.floor(c.y/8)}`, w.time);
      noteEvidence(
        w,
        "discovered",
        o ? `${c.name} inspected the ${displayName(o.type).toLowerCase()}.` : `${c.name} scouted new ground.`,
        1,
        c.id,
      );
      if (o) o.discovered = true;
      else visitFrontier(w,c);
      activity(w,"explore",o ? `${c.name} inspected the ${displayName(o.type).toLowerCase()}.` : `${c.name} reached new ground.`,"Instincts",`At ${Math.round(c.x)}, ${Math.round(c.y)}. Care remains the first priority.`);
      finish(w, c);
    } else if (c.task === "social" && c.work >= 3) {
      const partner = w.creatures.find((o) => o.id === c.job.partner);
      const recentLoss = c.encounters.some(
          (e) => e.kind === "loss" && w.time - e.tick < 30,
        ),
        recentBirth = c.encounters.some(
          (e) => e.kind === "birth" && w.time - e.tick < 20,
        );
      const kind = recentLoss
        ? c.traits.sociability > 0.5
          ? "comfort"
          : "mourning"
        : recentBirth
          ? "celebration"
          : w.orbital.lastLaunch > 0 && w.time - w.orbital.lastLaunch < 15
            ? "farewell"
            : c.encounters.some(
                  (e) => e.kind === "discovery" && w.time - e.tick < 20,
                )
              ? "question"
              : !c.relationships.some((r) => r.id === partner?.id)
                ? "greeting"
                : c.amused > 65 && partner?.amused > 65
                  ? "song"
                  : "shared-play";
      if (partner && distance(c, partner) < 3) {
        encounter(c, kind, partner.id, w.time);
        encounter(partner, kind, c.id, w.time);
        c.amused = Math.min(100, c.amused + 12);
        partner.amused = Math.min(100, partner.amused + 8);
        c.gesture = { kind, until: w.time + 2 };
        partner.gesture = { kind, until: w.time + 2 };
      }
      finish(w, c);
    } else if (c.task === "rest" && c.work >= 4) {
      if (c.amused < 70) c.amused = Math.min(70, c.amused + 3);
      finish(w, c);
    }
  }
  for (const { c, cause } of deaths)
    die(w, [c], cause, addObject, remember, "world");
  for (let i = 0; i < births.length; i++) {
    const parent = births[i];
    if (w.creatures.length >= growthLimit) {
      if (earlyGrowth) for (const waiting of births.slice(i)) waiting.growth = 0;
      break;
    }
    if (w.creatures.includes(parent)) {
      const before = w.population;
      const c = addCreature(w, parent.x + 0.7, parent.y, parent);
      if (w.population > before) {
        parent.growth = 0;
        parent.fed -= 10;
        parent.clean -= 6;
        parent.amused -= 6;
      }
      if (c) {
        encounter(c, "birth", parent.id, w.time);
        encounter(parent, "birth", c.id, w.time);
        remember(w, "birth", `${c.name} joined us.`, c.id);
      }
    }
  }
  separateBodies(w);
  const builtProjects = finishSettlement(w,placeBuilding);
  if (builtProjects.length)
    for (const c of w.creatures)
      if (c.task === "construct" && builtProjects.includes(c.job?.project)) finish(w,c);
  stepCohorts(w, dt);
  for (const o of w.objects) {
    if (o.type === "orchard") {
      o.progress += dt;
      if (o.progress >= 4) {
        o.stock = Math.min(12 * o.level, o.stock + Math.floor(o.progress / 4));
        o.progress %= 4;
      }
    }
    if (o.type === "cricketball") {
      o.progress += dt;
      if (o.progress >= 240) o.remove = true;
    }
  }
  if (w.objects.some((o) => o.remove)) {
    w.objects = w.objects.filter((o) => !o.remove);
  }
  w.progress.peakBlocks = Math.max(w.progress.peakBlocks, w.inventory.blocks);
  w.progress.grabber = w.stage >= 2 && w.progress.chopped >= 12;
  w.progress.swarm = w.stage >= 2 && w.progress.bugs >= 3;
  w.revision++;
  for (const d of w.decisions)
    if (!d.observed && w.time - d.tick >= 20) {
      d.completed = w.metrics.completed - d.baseline;
      d.observed = `${d.completed} tasks finished in 20 seconds; ${w.creatures.filter((c) => minimum(c) < 30).length} urgent individuals.`;
    }
}
export function placeBuilding(w, type, x, y) {
  const spec = BUILDINGS[type];
  if (!spec || !unlocked(w, spec)) return "That has not been discovered yet.";
  if (w.objects.length >= LIMITS.objects)
    return "There are too many saved objects. Remove something first; you can still explore.";
  if (!isGround(w, x, y) || (!w.progress.bridge && !westBank(w, { x, y })))
    return "Find a clear patch of reachable ground.";
  if (
    w.inventory.wood < (spec.wood || 0) ||
    w.inventory.blocks < (spec.cost || 0)
  )
    return `We need ${buildingCost(spec)} for this building.`;
  let node;
  if (type === "mine") {
    node = nearbyObjects(w, x, y, 3).find(
      (o) => o.type === "node" && distance(o, { x, y }) < 2,
    );
    if (!node) return "Mines belong on sparkling nodes.";
    x = node.x;
    y = node.y;
  }
  if (!canPlace(w, type, { x, y }, node?.id))
    return "There is something in the way. Leave room for entrances and walking.";
  if (node && !clearNatural(w, node))
    return "This world's saved changes are full. You can keep exploring or start another world in Options.";
  w.inventory.wood -= spec.wood || 0;
  w.inventory.blocks -= spec.cost || 0;
  if (node) w.objects = w.objects.filter((o) => o.id !== node.id);
  addObject(w, type, x, y, {
    stock: type === "orchard" ? 6 : node?.stock || 0,
    level: 1,
    quality: node?.level || 1,
  });
  if (type === "cannon") w.progress.cannon = true;
  w.navRevision++;
  w.commandRevision++;
  remember(w, "build", `Built ${spec.name.toLowerCase()}.`);
  return null;
}
export function interact(w, tool, x, y, entity) {
  if (tool.startsWith("build:"))
    return {
      message:
        placeBuilding(w, tool.slice(6), x, y) || "A new place for the colony.",
      sound: "build",
    };
  const spec = TOOLS[tool];
  // Putting down a stack already withdrawn from storage does not require the
  // later Grabber upgrade. Picking up objects still requires that upgrade.
  if (spec && !unlocked(w, spec) && !(tool === "grabber" && w.ui.held))
    return { message: "Keep growing to discover this tool." };
  const c = w.creatures.find((c) => c.id === entity?.id);
  const o =
    w.objects.find((o) => o.id === entity?.id) || naturalObject(w, entity?.id);
  if (tool === "meteor") return meteorImpact(w,x,y);
  if (tool === "inspect") {
    if (o?.type === "bridge") {
      w.ui.selected = o.id;
      return {};
    }
    const project = o && projectState(o);
    if (project)
      return {
        message: project.complete
          ? project.completion
          : `We have ${project.delivered} of ${project.required} ${project.material}. Leave logs nearby and we will bring them.`,
      };
    if (o?.type === "lander") {
      w.objects = w.objects.filter((a) => a.id !== o.id);
      const baby = addCreature(w, o.x, o.y);
      w.progress.hatched = true;
      w.ui.selected = baby?.id || null;
      remember(w, "hatch", "Hello. Are you looking after me?");
      return { message: "Hello. Are you looking after me?", sound: "birth" };
    }
    if (o?.type === "monolith") {
      if (!w.progress.monolith) return { choice: "monolith" };
      if (o.contact === 2 && !w.progress.secondContact)
        return { choice: "second-contact" };
      if (orbitalReady(w))
        return { choice: "nuke" };
      return { message: "We are becoming something larger." };
    }
    if (o?.type === "tnt") {
      if (!w.objects.some((a) => a.type === "mountain" && distance(a, o) < 10))
        return { message: "The TNT needs to be closer to the mountain." };
      w.objects = w.objects.filter((a) => a.id !== o.id);
      w.progress.tnt = true;
      const second = addObject(w, "monolith", 52, 13, { contact: 2 });
      w.navRevision++;
      w.commandRevision++;
      noteEvidence(
        w,
        "discovered",
        "The demolition charge uncovered another survey beacon.",
      );
      w.objects = w.objects.filter((a) => a.id !== o.id);
      remember(w, "tnt", "The mountain remains. We need more than force.");
      return {
        message: "It was not enough. Perhaps the answer is above us.",
        sound: "build",
      };
    }
    w.ui.selected = entity?.id || null;
    return {};
  }
  if (tool === "banana") {
    if (
      !clearPosition(w, { x, y }) ||
      (!w.progress.bridge && !westBank(w, { x, y }))
    )
      return { message: "Drop it on reachable grass." };
    if (w.objects.filter((o) => o.type === "banana").length >= 32)
      return { message: "There are still bananas on the ground." };
    if (!addObject(w, "banana", x, y, { stock: 1 }))
      return {
        message:
          "There are too many things in this world. Clear unused objects first.",
      };
    remember(w, "feed", "A banana, given freely.");
    return { sound: "care" };
  }
  if (tool === "cricketball") {
    if (
      !clearPosition(w, { x, y }) ||
      (!w.progress.bridge && !westBank(w, { x, y }))
    )
      return { message: "Find some reachable grass to play on." };
    if (w.objects.filter((o) => o.type === "cricketball").length >= 8)
      return { message: "There are enough balls to share." };
    if (!addObject(w, "cricketball", x, y))
      return {
        message:
          "There are too many things in this world. Clear unused objects first.",
      };
    remember(w, "play", "Made time for play.");
    return { sound: "care" };
  }
  if (tool === "cloth") {
    if (c) {
      c.clean = 100;
      noteEvidence(w, "care", `Washed ${c.name}.`, 1, c.id);
      remember(w, "wash", `Washed ${c.name}.`, c.id);
      return { message: "Squeaky clean.", sound: "care" };
    }
    return { message: "Use the cloth on a creature." };
  }
  if (tool === "axe" || tool === "chainsaw") {
    let count = 0,
      blockedEdit = false;
    for (const tree of nearbyObjects(w, x, y, 8))
      if (
        tree.type === "tree" &&
        (tree.id === o?.id ||
          (tool === "chainsaw" && distance(tree, { x, y }) < 3))
      ) {
        if (tree.id.startsWith("g:") && w.objects.length >= LIMITS.objects) {
          blockedEdit = true;
          continue;
        }
        const saved = materializeObject(w, tree);
        if (!saved) {
          blockedEdit = true;
          continue;
        }
        saved.type = "stump";
        deposit(w, "log", tree.x + 0.7, tree.y + 0.6, 6, addObject);
        w.navRevision++;
        count++;
      }
    if (count) {
      w.progress.chopped += count;
      remember(w, "chop", `Chopped ${count} tree${count > 1 ? "s" : ""}.`);
      return { sound: "build", message: "They will put this wood to work." };
    }
    return {
      message: blockedEdit
        ? "There is no room to save more changes. Clear unused objects or start another world in Options."
        : "Tap a tree to chop it.",
    };
  }
  if (tool === "hammer" && c) {
    die(w, [c], "hammer", addObject, remember);
    return { message: `${c.name} was beneath the hammer.`, sound: "loss" };
  }
  if (tool === "hammer" || tool === "pickaxe") {
    let changed = 0,
      blockedEdit = false;
    for (let target of nearbyObjects(w, x, y, 8))
      if (
        target.id === o?.id ||
        (tool === "pickaxe" &&
          target.type === "rock" &&
          distance(target, { x, y }) < 3)
      ) {
        if (target.type === "rock") {
          target = materializeObject(w, target);
          if (!target) {
            blockedEdit = true;
            continue;
          }
          target.type = "ore";
          target.stock = 3;
          changed++;
        } else if (target.type === "ore" && tool === "hammer") {
          w.inventory.blocks += target.stock * 10;
          w.progress.energy += target.stock * 10;
          w.progress.peakBlocks = Math.max(w.progress.peakBlocks, w.inventory.blocks);
          w.objects = w.objects.filter((a) => a.id !== target.id);
          changed++;
        } else if (
          tool === "hammer" &&
          ["stump", "corpse", "flowers", ...Object.keys(BUILDINGS)].includes(
            target.type,
          )
        ) {
          if (!clearNatural(w, target)) {
            blockedEdit = true;
            continue;
          }
          w.inventory.ore += target.inputOre || 0;
          w.objects = w.objects.filter((a) => a.id !== target.id);
          if (target.type === "mine")
            addObject(w, "node", target.x, target.y, {
              stock: target.stock,
              level: target.quality || 1,
            });
          remember(w, "remove", `Removed ${displayName(target.type).toLowerCase()}.`);
          changed++;
        }
      }
    if (changed) {
      w.navRevision++;
      w.commandRevision++;
      remember(
        w,
        "hammer",
        `Worked ${changed} resource${changed > 1 ? "s" : ""}.`,
      );
      return {
        sound: "build",
        message:
          tool === "pickaxe"
            ? "Ore uncovered. Use the hammer to make blocks."
            : "A little work goes a long way.",
      };
    }
    return {
      message: blockedEdit
        ? "There is no room to save more changes. Clear unused objects or start another world in Options."
        : "Use this on rocks, loose ore, or a building.",
    };
  }
  if (tool === "bug" || tool === "swarm") {
    if (c) return { choice: tool, entity: c.id };
    if (o?.type === "corpse") {
      o.type = "bone";
      o.stock = 8 * Math.max(1, o.stock);
      if (tool === "bug") w.progress.bugs++;
      remember(w, "bones", "Even a life that ended can become a bridge.");
      return { sound: "build" };
    }
    return { message: "The bug needs a creature." };
  }
  if (tool === "mop") {
    cleanPollution(w, { x, y }, remember);
    return { sound: "care" };
  }
  if (tool === "grabber") {
    if (w.ui.held) {
      if (!clearPosition(w, { x, y }) ||
          (!w.progress.bridge && !westBank(w, { x, y })) ||
          w.objects.length >= LIMITS.objects)
        return { message: "Find a clear patch with room to put this down." };
      addObject(w, w.ui.held.type, x, y, { stock: w.ui.held.stock });
      remember(w, "relocate", `Placed ${displayName(w.ui.held.type).toLowerCase()}.`);
      w.ui.held = null;
      w.navRevision++;
      w.commandRevision++;
      return { message: "Right here.", sound: "care" };
    }
    if (o && ["log", "bone", "ore", "corpse"].includes(o.type)) {
      w.ui.held = { id: o.id, type: o.type, stock: o.stock };
      w.objects = w.objects.filter((a) => a.id !== o.id);
      w.navRevision++;
      w.commandRevision++;
      return {
        message: `Carrying ${displayName(o.type).toLowerCase()}. Tap clear ground to put it down.`,
        sound: "care",
      };
    }
    return {
      message: "Pick up logs, bones, ore or remains, then tap to place them.",
    };
  }
  return {};
}
export function choose(w, kind, answer, entity) {
  w.memory.choices.push(`${kind}:${answer}`);
  w.memory.choices = w.memory.choices.slice(-32);
  w.commandRevision++;
  if (kind === "monolith" && !w.progress.monolith) {
    w.progress.monolith = true;
    w.stage = w.progress.bridge ? 2 : 1;
    w.inventory.blocks += 30;
    w.progress.peakBlocks = Math.max(w.progress.peakBlocks, 30);
    noteEvidence(w, "discovered", "Activated the survey beacon.");
    postMessage(w, { key:"bridge-materials", title:"A way across",
      text:"The survey beacon unlocked the Reclaimer. Bones were someone; wood can carry us just as well. Chop trees or send stored wood at the bridge. Finishing the crossing opens the mines and the mountain." });
    if (answer === "care") w.directives.careFloor = 55;
    remember(
      w,
      "choice",
      answer === "care"
        ? "We promised to put life before output."
        : "We agreed to discover what we could become.",
    );
  }
  if (kind === "second-contact" && w.progress.tnt) {
    w.progress.secondContact = true;
    noteEvidence(
      w,
      "discovered",
      "The mountain survey beacon revealed a route into orbit.",
    );
    remember(w, "choice", "A new question points toward the sky.");
  }
  if (["bug", "swarm"].includes(kind) && answer === "yes") {
    const c = w.creatures.find((c) => c.id === entity);
    if (!c) return "They are no longer here.";
    const victims = w.creatures.filter(
      (a) => a.id === c.id || (kind === "swarm" && distance(a, c) < 3),
    );
    const count = die(w, victims, kind, addObject, remember);
    if (kind === "bug") w.progress.bugs++;
    remember(w, "sacrifice", `${count} lives became materials.`);
  }
  if (kind === "nuke") {
    if (answer !== "yes") {
      w.story.refusals.push("nuke");
      noteEvidence(
        w,
        "autonomy",
        "Chose to keep the colony and decline the final destructive project.",
      );
      return "We can stay here. The choice is yours.";
    }
    if (!orbitalReady(w))
      return "The collective is not ready.";
    // The caller checkpoints before this synchronous transaction. Preserve three
    // real survivors; every other person is accounted for, including orbit.
    const survivors = w.creatures.slice(0, Math.min(3, w.creatures.length));
    const lost = w.population - survivors.length;
    noteEvidence(
      w,
      "deaths",
      `The final transformation ended ${lost.toLocaleString()} lives.`,
      lost,
    );
    for (const c of survivors) {
      releaseCargo(w, c);
      c.job = null;
      c.task = "idle";
      c.target = null;
    }
    w.creatures = survivors;
    w.cohort = 0;
    w.orbital.population = 0;
    w.objects = [];
    w.pollution = [];
    w.progress.pollution = 0;
    w.stage = 3;
    w.progress.finalRequired = survivors.length;
    w.ui.held = null;
    w.ui.x = 24;
    w.ui.y = 24;
    addObject(w, "hole", 24, 24);
    survivors.forEach((c, i) => {
      c.x = 20 + i * 2;
      c.y = 27;
    });
    w.navRevision++;
    syncPopulation(w);
    refreshDistrict(w);
    w.story.assessments = assessment(w);
    updateStory(w);
    remember(
      w,
      "nuke",
      `The world opened. ${lost.toLocaleString()} lives ended; ${survivors.length} remain at the connection.`,
    );
    if (!survivors.length) w.stage = 4;
  }
  return "We will remember.";
}
export function relocate(w, entity, p) {
  const o =
    w.objects.find((o) => o.id === entity.id) || naturalObject(w, entity.id);
  if (o?.type !== "rock") return "Only a loose rock can be dragged this way.";
  if (!canPlace(w, "rock", p, o.id))
    return "There is no room for the rock there.";
  const saved = materializeObject(w, o);
  if (!saved) return "There is no room to save another change.";
  saved.x = p.x;
  saved.y = p.y;
  w.navRevision++;
  w.commandRevision++;
  remember(w, "relocate", "Moved a rock out of the way.", saved.id);
  return null;
}
export function connectSurvivor(w, id) {
  const c = w.creatures.find((c) => c.id === id);
  if (w.stage !== 3 || !c || !w.objects.some((o) => o.type === "hole"))
    return false;
  w.creatures = w.creatures.filter((o) => o.id !== id);
  w.progress.uplinks++;
  w.departed.push({
    id: c.id,
    name: c.name,
    cause: "connection",
    tick: w.time,
  });
  w.departed = w.departed.slice(-32);
  syncPopulation(w);
  w.commandRevision++;
  w.revision++;
  remember(w, "uplink", `${c.name} joined the connection.`, c.id);
  if (w.progress.uplinks >= w.progress.finalRequired) w.stage = 4;
  return true;
}
export function withdrawMaterial(w, kind) {
  const types = { wood: "log", bones: "bone", ore: "ore", corpses: "corpse" };
  if (w.ui.held || !types[kind] || !w.inventory[kind]) return false;
  const amount = Math.min(w.inventory[kind], kind === "corpses" ? 1 : 6);
  w.inventory[kind] -= amount;
  w.ui.held = { type: types[kind], stock: amount, id: null };
  w.ui.tool = "grabber";
  w.commandRevision++;
  remember(w, "withdraw", `Took ${amount} ${kind} from storage to place in the world.`);
  return true;
}
export function supplyBridge(w, id) {
  const bridge = w.objects.find((o) => o.id === id && o.type === "bridge");
  const project = bridgeProject(w, bridge);
  if (!bridge || !project || project.complete) return "This crossing needs no more wood.";
  if (!w.creatures.length) return "We need living carriers to build the bridge.";
  const amount = Math.floor(Math.min(project.needed, w.inventory.wood));
  if (!amount) return project.needed ? "Chop more trees to provide wood." : "There are already enough materials waiting at the crossing.";
  const g = bridgeGeometry(bridge);
  const point = freePosition(w, { x:g.a.x-2.7, y:g.a.y-1 }, [], 4);
  if (!point || !westBank(w, point) || w.objects.length >= LIMITS.objects)
    return "Clear some space on this bank for a wood pile.";
  const stack = addObject(w, "log", point.x, point.y, { stock:amount });
  if (!stack) return "There is no room for another wood pile.";
  w.inventory.wood -= amount;
  w.commandRevision++;
  remember(w, "bridge-supply", `Set out ${amount} stored wood for the river crossing.`, bridge.id);
  activity(w, "bridge", `${amount} wood is waiting for carriers at the bridge.`, "You");
  return `${amount} wood set out. We will carry it when our needs are met.`;
}
export function upgrade(w, o) {
  const threshold = { factory: 5000, mine: 120000, dwelling: 200000 }[o?.type];
  if (!threshold || o.level >= 2) return "This structure cannot be upgraded.";
  if (w.progress.peakBlocks < threshold)
    return `Discover ${threshold.toLocaleString()} blocks to unlock this upgrade.`;
  const price = Math.floor(threshold / 2);
  if (w.inventory.blocks < price)
    return `The upgrade costs ${price.toLocaleString()} blocks.`;
  w.inventory.blocks -= price;
  o.level = 2;
  w.navRevision++;
  w.commandRevision++;
  remember(w, "upgrade", `Upgraded ${displayName(o.type).toLowerCase()}.`);
  return "A little more efficient.";
}
