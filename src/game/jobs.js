import { isExplored } from "./discovery.js";
import { CARE_START, USEFUL_TASKS, workOrder, workRole, recordWork } from "./work-balance.js";
import { clearanceTask, requestAccess, accessPoint } from "./access.js";
import { acceptsProject } from "./projects.js";
import {
  serviceSlots,
  bridgeGeometry,
  clearPosition,
  freePosition,
} from "./geometry.js";
import { routeCost, JOB_RADIUS } from "./navigation.js";
import { frontier } from "./exploration.js";
import { densityAt, densityReward, DENSITY } from "./density.js";
import { constructionSlots, projectAllowed, projectTask, storedSupply } from "./settlement.js";
import { projectFunded, projectName } from "./development.js";
export const TASKS = [
  "idle",
  "eat",
  "wash",
  "play",
  "haul",
  "mine",
  "work",
  "home",
  "orbit",
  "explore",
  "social",
  "rest",
  "clean",
  "gather",
  "quarry",
  "refine",
  "construct",
];
export const JOB_STATES = [
  "proposed",
  "reserved",
  "travelling",
  "queued",
  "working",
  "completed",
  "blocked",
  "cancelled",
];
export const capacity = (o) => (o.type === "bridge" ? 4 : serviceCapacity(o));
function serviceCapacity(o) {
  return (
    ({
      banana: 1,
      orchard: 3,
      bath: 1,
      cricketball: 4,
      roundabout: 5,
      theatre: 12,
      dwelling: 6,
      mine: 4,
      factory: 5,
      cannon: 4,
      log: 1,
      bone: 1,
      ore: 1,
      monolith: 1,
      mountain: 1,
      sculpture: 2,
    }[o.type] || 0) * (o.level || 1)
  );
}
export function minimum(c) {
  return Math.min(c.fed, c.clean, c.amused);
}
function isCrowded(w, c) {
  if (densityAt(w,c).residents > DENSITY.target) return true;
  let close = 0;
  for (const other of w.creatures)
    if (other.id !== c.id && Math.hypot(other.x-c.x,other.y-c.y)<3 && ++close >= 4) return true;
  return false;
}
export function allowsTask(w, task, c) {
  if (["gather", "quarry", "refine", "construct"].includes(task) &&
      clearanceTask(w,c)?.task !== task &&
      (!projectAllowed(w, c) || projectTask(w,c)!==task)) return false;
  const scope = w.directives?.members;
  if (scope?.length && !scope.includes(c.id)) return true;
  if (
    w.directives?.pauseWork &&
    ["haul", "mine", "work", "orbit"].includes(task)
  )
    return false;
  if (w.directives?.avoidPollution && task === "work") return false;
  return true;
}
function workTargets(w, c, task) {
  return w.objects.filter((o) => {
    if (!isExplored(w,o)) return false;
    if (Math.hypot(c.x - o.x, c.y - o.y) > JOB_RADIUS) return false;
    const scope = w.directives?.members;
    if (
      w.directives?.region &&
      (!scope?.length || scope.includes(c.id)) &&
      ["mine", "work", "explore", "orbit", "gather", "quarry"].includes(task) &&
      o.x > 42 !== w.directives.region.x > 42
    )
      return false;
    if (task === "eat")
      return ["banana", "orchard"].includes(o.type) && o.stock > 0;
    const clearance=clearanceTask(w,c);
    if (clearance && ["gather","quarry"].includes(task)) return task===clearance.task && o.id===clearance.target;
    if (task === "gather") return projectTask(w,c)==="gather" &&
      (o.type === "tree" || (o.type === "log" && o.stock > 0));
    if (task === "quarry") return projectTask(w,c)==="quarry" &&
      (o.type === "rock" || (o.type === "ore" && o.stock > 0));
    if (task === "wash") return o.type === "bath";
    if (task === "play")
      return ["cricketball", "roundabout", "theatre"].includes(o.type);
    if (task === "home") return o.type === "dwelling";
    if (task === "clean") return o.type === "factory" &&
      w.pollution.some((z) => z.source === o.id && z.amount > 0);
    if (task === "haul")
      return c.carry > 0
        ? c.cargoKind === "ore"
          ? o.type === "factory" && (o.inputOre || 0) < 60
          : (o.type === "bridge" && !bridgeGeometry(o).complete) ||
            acceptsProject(o, c.cargoKind)
        : (["log", "bone", "ore"].includes(o.type) && o.stock > 0) || !!storedSupply(w,c,o);
    if (task === "mine") return o.type === "mine" && o.stock > 0;
    if (task === "work")
      return (
        o.type === "factory" &&
        (o.inputOre || 0) >= 3 &&
        !w.memory.goals.some((g) => g.status === "active" && g.kind === "ore")
      );
    if (task === "orbit")
      return o.type === "cannon" && w.creatures.length > 8 && !c.favorite;
    if (task === "explore")
      return (
        ["monolith", "mountain", "node"].includes(o.type) &&
        !o.discovered &&
        !c.encounters?.some((e) => e.kind === "discovery" && e.other === o.id)
      );
    return false;
  });
}
function desired(w, c, policy) {
  const needs = [
    ["fed", "eat"],
    ["clean", "wash"],
    ["amused", "play"],
  ].sort((a, b) => c[a[0]] - c[b[0]]);
  const urgent = needs
    .filter(([key]) => c[key] < (w.directives?.careFloor || 35))
    .flatMap(([key, task]) => (key === "amused" ? [task] : [task, "home"]));
  if (c.sickness >= 50)
    return [...new Set([...(c.fed < 35 ? ["home", "eat"] : []), "wash", "home", ...urgent, "rest"])];
  if (urgent.length) return [...new Set([...urgent, "rest"])];
  if (c.carry > 0)
    return [
      "haul",
      ...needs.filter(([key]) => c[key] < 55).map(([, task]) => task),
      "rest",
    ];
  const care = needs
    .filter(([key]) => c[key] < (policy === "care" ? 78 : CARE_START))
    .flatMap(([key, task]) => (key === "amused" ? [task] : [task, "home"]));
  if (
    w.directives?.members?.length &&
    !w.directives.members.includes(c.id) &&
    policy === "build"
  )
    policy = "balanced";
  const work =
    policy === "build"
      ? ["haul"]
      : policy === "mine"
        ? ["mine"]
        : policy === "industry"
          ? ["work", "mine", "orbit"]
          : ["haul", "work", "mine", "orbit"];
  const role = workRole(w, c);
  // Maintenance is shared, physical work at a polluted factory. Healthy workers
  // take it before adding more pollution; sick workers seek a bath/home above.
  const maintain = w.settings.autonomy !== false && w.pollution.some((z) => z.amount >= 20);
  if (policy === "balanced" && role === 0)
    work.sort((a, b) => (a === "haul" ? -1 : b === "haul" ? 1 : 0));
  if (policy === "balanced" && role === 1)
    work.sort((a, b) => (a === "mine" ? -1 : b === "mine" ? 1 : 0));
  if (policy === "balanced" && role === 2)
    work.sort((a, b) => (a === "work" ? -1 : b === "work" ? 1 : 0));
  if ((policy === "expand" || (policy === "balanced" && role === 3)) && minimum(c) >= 76)
    work.unshift("explore");
  return [
    ...new Set([
      ...care,
      ...(maintain ? ["clean"] : []),
      ...(clearanceTask(w,c) ? [clearanceTask(w,c).task] : []),
      ...(projectTask(w,c) ? [projectTask(w,c)] : []),
      ...work,
      // A bounded scouting crew can include any healthy resident with no work.
      ...(minimum(c) >= 76 && !c.carry && isCrowded(w,c) ? ["explore"] : []),
      ...needs.filter(([key]) => c[key] < 85).map(([, task]) => task),
      ...(role === 3 ? ["explore"] : []),
      "social",
      "rest",
    ]),
  ].filter((t) => allowsTask(w, t, c));
}
function reserve(w, slots, stock, a) {
  if (["construct","refine"].includes(a.task)) slots.add(`construction:${a.slot}`);
  if (a.task === "refine") stock.set("inventory:ore",(stock.get("inventory:ore")||0)+1);
  const c = w.creatures.find(c=>c.id===a.id), target=w.objects.find(o=>o.id===a.target);
  const supply = a.task==="haul" && !c.carry && target && storedSupply(w,c,target);
  if (supply) stock.set(`inventory:${supply}`,(stock.get(`inventory:${supply}`)||0)+3);
  if (a.target) {
    slots.add(`${a.target}:${a.slot}`);
    if (["eat", "mine", "haul", "work", "gather", "quarry"].includes(a.task)) {
      const key = a.task === "work" ? `${a.target}:ore` : a.target;
      stock.set(key, (stock.get(key) || 0) + (a.task === "work" ? 3 : 1));
    }
  }
}
export function makePlan(w, policy = "balanced") {
  const started = performance.now(),
    slots = new Set(),
    stock = new Map(),
    assignments = [], access = [],
    slotCache = new Map();
  const floor = w.directives?.careFloor || 35;
  const priority = c => minimum(c) < floor || c.sickness >= 50 ? 0 :
    c.job && !["completed", "blocked", "cancelled"].includes(c.job.state) &&
      !["idle", "rest", "social"].includes(c.task) ? 1 : 2;
  const members = [...w.creatures].sort((a,b) => priority(a)-priority(b) ||
    (priority(a)===0 ? minimum(a)-minimum(b) : 0) || workOrder(a,b));
  for (const c of members) {
    const tasks = desired(w, c, policy),
      old = c.job,
      target = w.objects.find((o) => o.id === c.target);
    const servingCare =
      ["eat", "wash", "play", "home"].includes(c.task) &&
      !(minimum(c) < 10 && !tasks.slice(0, 2).includes(c.task));
    const preserve =
      !["idle","rest","social"].includes(c.task) &&
      (!c.carry || ["haul", "eat", "wash", "home", "play"].includes(c.task)) &&
      old &&
      (!["construct","refine"].includes(c.task) || (old.project === w.community.project?.id &&
        (c.task==="construct" ? projectFunded(w) : w.inventory.ore-(stock.get("inventory:ore")||0)>0) && !slots.has(`construction:${old.slot}`))) &&
      !["blocked", "cancelled", "completed"].includes(old.state) &&
      allowsTask(w, c.task, c) &&
      (servingCare ||
        (c.sickness < 50 && minimum(c) >= (w.directives?.careFloor || 35)) ||
        tasks.slice(0, 2).includes(c.task));
    const oldTargetValid =
      !c.target || workTargets(w, c, c.task).some((o) => o.id === c.target);
    const oldStockValid =
      !target ||
      !["eat", "mine", "haul"].includes(c.task) ||
      ["bridge", "factory", "sculpture"].includes(target.type) ||
      target.stock - (stock.get(target.id) || 0) >= 1;
    if (
      preserve &&
      oldTargetValid &&
      oldStockValid &&
      !(c.task==="haul" && !c.carry && storedSupply(w,c,target||{}) &&
        w.inventory[storedSupply(w,c,target)]-(stock.get(`inventory:${storedSupply(w,c,target)}`)||0)<=0) &&
      old.point &&
      clearPosition(w, old.point) &&
      !assignments.some(
        (a) =>
          Math.hypot(a.point.x - old.point.x, a.point.y - old.point.y) < 0.6,
      ) &&
      w.time - (old.lastProgress ?? old.started) < 45 &&
      !slots.has(`${c.target}:${old.slot}`) &&
      (c.task !== "work" ||
        (target?.inputOre || 0) - (stock.get(`${c.target}:ore`) || 0) >= 3)
    ) {
      const a = {
        id: c.id,
        task: c.task,
        target: c.target,
        slot: old.slot,
        point: old.point,
        purpose: old.purpose,
        keep: true,
        project: old.project,
      };
      assignments.push(a);
      reserve(w, slots, stock, a);
      continue;
    }
    let chosen, obstruction;
    for (const task of tasks) {
      if (["construct","refine"].includes(task)) {
        const p = (task==="construct" ? projectFunded(w) : w.inventory.ore-(stock.get("inventory:ore")||0)>0) &&
          constructionSlots(w).find((p) => !slots.has(`construction:${p.slot}`) &&
            !assignments.some((a) => Math.hypot(a.point.x-p.x,a.point.y-p.y)<0.6) && Number.isFinite(routeCost(w,c,p)));
        if (p) { chosen = { id:c.id, task, target:null, slot:p.slot, point:p, project:w.community.project.id,
          purpose:`Work on our ${projectName(w.community.project).toLowerCase()}` }; break; }
        if (!p && (task==="construct" ? projectFunded(w) : w.inventory.ore>0) &&
            !constructionSlots(w).some(s=>Number.isFinite(routeCost(w,c,s)))) obstruction ||= {unit:c.id,task,project:w.community.project?.id,
          point:constructionSlots(w)[0] || (w.community.project && accessPoint(w.community.project,c))};
        continue;
      }
      if (["rest", "social"].includes(task)) {
        const crowded = isCrowded(w,c);
        // Meeting a neighbour must not override the decision to leave a crowd.
        if (task === "social" && crowded) continue;
        // Rest resumes only after checking real work. Otherwise an idle resident
        // keeps resting while a just-finished worker repeatedly takes the slot.
        if (c.task===task && old?.point && (!crowded || Math.hypot(old.point.x-c.x,old.point.y-c.y)>2) && !["completed","blocked","cancelled"].includes(old.state) &&
            clearPosition(w,old.point) && w.time-(old.lastProgress??old.started)<45 &&
            !assignments.some(a=>Math.hypot(a.point.x-old.point.x,a.point.y-old.point.y)<.6)) {
          chosen={id:c.id,task,target:null,slot:old.slot,point:old.point,partner:old.partner,purpose:old.purpose,keep:true};break;
        }
        const phase = c.birthOrdinal * 2.3999632297,
          radius = crowded ? 7 : 1.5;
        // Rest where life took us; never funnel every resident back to two coordinates.
        const camp = c;
        let anchor = {
          x: camp.x + Math.cos(phase) * radius,
          y: camp.y + Math.sin(phase) * radius,
        };
        if (crowded && !c.carry && minimum(c)>55) {
          const alternatives = Array.from({length:8},(_,i)=>({
            x:c.x+Math.cos(phase+i*Math.PI/4)*radius,
            y:c.y+Math.sin(phase+i*Math.PI/4)*radius,
          })).filter(p=>isExplored(w,p) && clearPosition(w,p));
          const score=p=>densityReward(densityAt(w,p).residents) -
            assignments.reduce((sum,a)=>sum+Math.max(0,4-Math.hypot(a.point.x-p.x,a.point.y-p.y)),0);
          alternatives.sort((a,b)=>score(b)-score(a));
          // Try reachable alternatives instead of giving up after one blocked
          // quiet spot. Include future destinations so workers spread out.
          const reachable = alternatives.find(p=>Number.isFinite(routeCost(w,c,p)));
          if (reachable) anchor = reachable;
        }
        const partner =
          task === "social"
            ? members.find(
                (o) =>
                  o.id !== c.id &&
                  ["idle", "rest"].includes(o.task) &&
                  Math.hypot(o.x - c.x, o.y - c.y) < 4 &&
                  o.amused < 85 &&
                  !assignments.some((a) => a.partner === o.id),
              )
            : null;
        if (task === "social" && !partner) continue;
        const wanted = partner
          ? {
              x: partner.x + Math.cos(phase) * 1.1,
              y: partner.y + Math.sin(phase) * 1.1,
            }
          : c.carry || (!crowded && !members.some((o) => o.id !== c.id && Math.hypot(o.x-c.x,o.y-c.y)<1.2))
            ? { x: c.x, y: c.y }
            : anchor;
        const occupied = assignments
          .filter((a) => !a.target)
          .map((a) => a.point);
        const point =
          freePosition(w, wanted, occupied, 3) ||
          freePosition(w, c, occupied, 3);
        if (!point) continue;
        if (
          !clearPosition(w, point) ||
          !Number.isFinite(routeCost(w, c, point))
        )
          continue;
        chosen = {
          id: c.id,
          task,
          target: null,
          slot: c.birthOrdinal % 12,
          point,
          partner: partner?.id,
          purpose:
            task === "social"
              ? "Share play and strengthen a bond"
              : "Rest in a clear, quiet place",
        };
        break;
      }
      let candidates = [];
      for (const o of workTargets(w, c, task)) {
        const supply = task==="haul" && !c.carry && storedSupply(w,c,o);
        if (supply && w.inventory[supply]-(stock.get(`inventory:${supply}`)||0)<=0) continue;
        if (
          (c.blocked || []).some(
            (b) =>
              b.target === o.id &&
              b.until > w.time &&
              b.revision === w.navRevision,
          )
        )
          continue;
        if (
          ["eat", "mine", "haul"].includes(task) &&
          !["bridge", "factory", "sculpture"].includes(o.type) &&
          o.stock - (stock.get(o.id) || 0) < 1
        )
          continue;
        if (
          task === "work" &&
          (o.inputOre || 0) - (stock.get(`${o.id}:ore`) || 0) < 3
        )
          continue;
        const slotKey = `${o.id}:${o.type === "bridge" ? (c.x < o.x ? "a" : "b") : "all"}`;
        if (!slotCache.has(slotKey))
          slotCache.set(slotKey, serviceSlots(w, o, c));
        const entrances=slotCache.get(slotKey);
        if (!entrances.length) obstruction ||= {unit:c.id,task,target:o.id,point:accessPoint(o,c)};
        for (const p of entrances) {
          if (slots.has(`${o.id}:${p.slot}`)) continue;
          if (
            assignments.some(
              (a) => Math.hypot(a.point.x - p.x, a.point.y - p.y) < 0.6,
            )
          )
            continue;
          const switching = (c.target && c.target !== o.id ? 2 + 2 * c.traits.diligence : 0) +
            (minimum(c)>45 && ["eat","wash","play","home"].includes(task)
              ? Math.min(12,-densityReward(densityAt(w,o).residents)) : 0);
          candidates.push({
            cost: Math.hypot(c.x - p.x, c.y - p.y) + switching,
            switching,
            point: p,
            target: o.id,
            slot: p.slot,
          });
        }
      }
      candidates.sort((a, b) => a.cost - b.cost);
      let best = null;
      for (const a of candidates) {
        if (best && a.cost > best.cost) break;
        const cost = routeCost(w, c, a.point) + a.switching;
        if (!Number.isFinite(cost)) obstruction ||= {unit:c.id,task,target:a.target,point:a.point};
        if (Number.isFinite(cost) && (!best || cost < best.cost))
          best = { ...a, cost };
      }
      if (best) {
        chosen = {
          id: c.id,
          task,
          ...best,
          purpose: purpose(task, best.target),
        };
        break;
      }
      if (task === "explore") {
        const point = frontier(w,c,assignments);
        if (point) { chosen = { id:c.id, task, target:null, slot:c.birthOrdinal, point,
          purpose:"Scout new ground, then return for care" }; break; }
      }
    }
    const a = chosen || {
      id: c.id,
      task: "idle",
      target: null,
      slot: 0,
      point: { x: c.x, y: c.y },
      purpose: "No accessible work; waiting for help",
    };
    assignments.push(a);
    if (obstruction && access.length<4 && !USEFUL_TASKS.has(a.task) &&
        !access.some(r=>r.target===obstruction.target && r.project===obstruction.project)) access.push(obstruction);
    reserve(w, slots, stock, a);
  }
  return {
    id: policy,
    time: w.time,
    revision: w.revision,
    commandRevision: w.commandRevision,
    assignments,
    access,
    schedulerMs: performance.now() - started,
  };
}
function purpose(task, target) {
  return (
    {
      eat: "Recover food",
      wash: "Recover cleanliness",
      play: "Recover play",
      home: "Recover food and cleanliness",
      clean: "Clear pollution before returning to work",
      haul: "Deliver real material to the bridge or store",
      mine: "Extract available ore",
      work: "Convert reserved ore into blocks",
      orbit: "Join the orbital collective",
      explore: "Inspect an accessible discovery",
      gather: "Cut trees and gather real timber for our project",
      quarry: "Break rocks and collect their ore",
      refine: "Work stored ore into blocks by hand",
    }[task] || `Visit ${target}`
  );
}
export function applyPlan(w, plan) {
  if (
    !plan ||
    w.time - plan.time > 30 ||
    plan.commandRevision !== w.commandRevision ||
    plan.assignments.length !== w.creatures.length
  )
    return false;
  const ids = new Set(),
    slots = new Set(),
    stock = new Map();
  for (const a of plan.assignments) {
    const c = w.creatures.find((c) => c.id === a.id);
    // Waiting in place is valid even if an old/imported layout trapped this
    // individual. It must not cancel every other creature's useful work.
    const waiting = c && a.task === "idle" && !a.target &&
      a.point?.x === c.x && a.point?.y === c.y;
    if (
      ids.has(a.id) ||
      !c ||
      !TASKS.includes(a.task) ||
      !a.point ||
      (!waiting && !clearPosition(w, a.point))
    )
      return false;
    if (
      a.target &&
      (!w.objects.some((o) => o.id === a.target) ||
        slots.has(`${a.target}:${a.slot}`))
    )
      return false;
    if (!allowsTask(w, a.task, c)) return false;
    if (["construct","refine"].includes(a.task) && (a.project !== w.community.project?.id || slots.has(`construction:${a.slot}`))) return false;
    if (a.task === "refine" && w.inventory.ore-(stock.get("inventory:ore")||0)<=0) return false;
    if (a.target && !workTargets(w, c, a.task).some((o) => o.id === a.target))
      return false;
    const target = w.objects.find((o) => o.id === a.target);
    const supply = a.task==="haul" && !c.carry && target && storedSupply(w,c,target);
    if (supply && w.inventory[supply]-(stock.get(`inventory:${supply}`)||0)<=0) return false;
    if (
      target &&
      ["eat", "mine", "haul"].includes(a.task) &&
      !["bridge", "factory", "sculpture"].includes(target.type) &&
      target.stock - (stock.get(a.target) || 0) < 1
    )
      return false;
    if (
      a.task === "work" &&
      (target?.inputOre || 0) - (stock.get(`${a.target}:ore`) || 0) < 3
    )
      return false;
    ids.add(a.id);
    reserve(w, slots, stock, a);
  }
  for (const a of plan.assignments) {
    const c = w.creatures.find((c) => c.id === a.id);
    if (a.keep && c.job) continue;
    if (
      c.job &&
      c.job.state !== "completed" &&
      (c.task !== a.task || c.target !== a.target)
    )
      w.metrics.switches++;
    c.task = a.task;
    if (USEFUL_TASKS.has(a.task)) recordWork(w,c);
    c.target = a.target;
    c.work = 0;
    c.job = {
      state: "reserved",
      slot: a.slot,
      point: a.point,
      partner: a.partner || null,
      project: a.project || null,
      purpose: a.purpose,
      started: w.time,
      lastProgress: w.time,
      progressAt: w.time,
      bestDistance: Math.hypot(c.x - a.point.x, c.y - a.point.y),
      expected: (a.cost ?? Math.hypot(c.x - a.point.x, c.y - a.point.y)) / 1.6 + 20,
    };
  }
  w.runtime = {
    ...(w.runtime || {}),
    schedulerMs: plan.schedulerMs,
    assignments: plan.assignments.length,
  };
  for (const request of plan.access || []) requestAccess(w,request);
  return true;
}
export function syncGroups(w) {
  const roles = ["care", "hauling", "production", "discovery"];
  w.groups = roles
    .map((role, i) => ({
      id: `group-${i}`,
      role,
      revision: w.commandRevision,
      project:
        role === "hauling" ? "bridge" : role === "production" ? "energy" : role,
      members: w.creatures
        .filter((c) => workRole(w,c) === i)
        .map((c) => c.id),
      outcomes: w.memory.jobs
        .filter((j) =>
          w.creatures.some((c) => c.id === j.unit && workRole(w,c) === i),
        )
        .slice(-8)
        .map((j) => `${j.task} completed at ${j.tick}s`),
    }))
    .filter((g) => g.members.length);
}
