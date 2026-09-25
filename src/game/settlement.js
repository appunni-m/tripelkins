import { decisionPace } from "../intelligence-settings.js";
import { completionLetter } from "./colony-letters.js";
import { clearanceChoices, startClearance, requestAccess, accessPoint, accessBrief } from "./access.js";
import { workOrder, working } from "./work-balance.js";
import { DENSITY, siteDensity, SETTLEMENT_TYPES } from "./density.js";
import { developmentPlan } from "./development-plan.js";
import { careContext, careDemand, careServices, CARE_TYPES } from "./care-context.js";
import { isExplored } from "./discovery.js";
import { BUILDINGS, LIMITS, unlocked, buildingMaterials, buildingCost } from "./catalog.js";
import { canPlace, clearPosition, serviceSlots, bridgeGeometry } from "./geometry.js";
import { nearbyObjects, westBank } from "./map.js";
import { routeCost } from "./navigation.js";
import { materializeObject, remember } from "./state.js";
import { activity, postMessage } from "./community.js";
import { CARE_BUILDINGS, INDEPENDENT_BUILDINGS, RESOURCE_PROJECTS, DEVELOPMENT_TYPES,
  projectName, isConstruction, projectFunded, timberReserve } from "./development.js";
export { CARE_BUILDINGS } from "./development.js";
const activeGoal = (w) => w.memory.goals.find((g) => g.status === "active");
function scoped(w, c) {
  return (!w.directives.members.length || w.directives.members.includes(c.id)) && !w.directives.pauseWork;
}
function allowedRegion(w, p) {
  return isExplored(w,p) && (w.progress.bridge || westBank(w,p)) &&
    (!w.directives.region || (p.x>42)===(w.directives.region.x>42));
}
function resourceNeeded(w, p) {
  if (p.type === "crossing") return !w.progress.bridge;
  const kind = RESOURCE_PROJECTS[p.type]?.material;
  return kind ? w.inventory[kind] < p.target : !projectFunded(w,p);
}
export function projectTask(w, c) {
  if (!projectAllowed(w,c)) return null;
  const p = w.community.project;
  if (p.type === "crossing") return w.inventory.wood > 0 ? "haul" : "gather";
  if (p.type === "timber") return resourceNeeded(w,p) ? "gather" : null;
  if (p.type === "quarry") return resourceNeeded(w,p) ? "quarry" : null;
  if (p.type === "refine") return resourceNeeded(w,p) ? (w.inventory.ore > 0 ? "refine" : "quarry") : null;
  return w.inventory.wood < (BUILDINGS[p.type].wood || 0) ? "gather" : projectFunded(w,p) ? "construct" : null;
}
export function storedSupply(w,c,o) {
  if (!independent(w) || !scoped(w,c) || !allowedRegion(w,o.type==="bridge" ? bridgeGeometry(o).a : o)) return null;
  if (o.type === "factory" && (o.inputOre||0)<60 && w.inventory.ore>0 && activeGoal(w)?.kind!=="ore") return "ore";
  if (o.type === "bridge" && !bridgeGeometry(o).complete && w.inventory.wood>0 &&
      w.community.project?.type==="crossing" && projectAllowed(w,c)) return "wood";
  return null;
}
export function independent(w) {
  return w.community.consent === "accepted" && w.settings.autonomy !== false &&
    w.runtime?.intelligenceAvailable === true && w.stage < 3;
}
export function projectAllowed(w, c) {
  const goal = activeGoal(w), p = w.community.project;
  const required = {wood:"timber",bridge:"crossing",ore:"quarry"}[goal?.kind];
  return independent(w) && p?.crew.includes(c.id) && scoped(w,c) &&
    (!required || p.type === required || CARE_BUILDINGS.includes(p.type)) &&
    !(goal?.kind === "blocks" && isConstruction(p) && !CARE_BUILDINGS.includes(p.type));
}
export function constructionSlots(w, project = w.community.project) {
  if (!project) return [];
  return [[-2.3, -2.3], [2.3, -2.3], [2.3, 2.3], [-2.3, 2.3]]
    .map(([x,y], slot) => ({ x: project.x+x, y: project.y+y, slot }))
    .filter((p) => clearPosition(w,p));
}
function findSites(w, type, expanding = false) {
  if (type === "mine") {
    for (const c of w.creatures.filter((c)=>scoped(w,c))) {
      for (const node of nearbyObjects(w,c.x,c.y,28).filter((o)=>o.type==="node" && o.stock>0)) {
        if (allowedRegion(w,node) && siteValid(w,type,node) &&
            constructionSlots(w,node).some((p)=>Number.isFinite(routeCost(w,c,p))))
          return [{x:node.x,y:node.y,density:siteDensity(w,node),benefit:0,travel:Math.hypot(c.x-node.x,c.y-node.y)}];
      }
    }
    return [];
  }
  const services = w.objects.filter((o) => o.type === type || (type !== "roundabout" && o.type === "dwelling"));
  const members = w.creatures.filter((c) => !c.carry && c.sickness < 50 &&
    (!w.directives.members.length || w.directives.members.includes(c.id)));
  if (!members.length) return [];
  // Put new facilities near the least-served residents, spaced out from old ones.
  const demand = new Map(careDemand(w,type).map(c=>[c.id,c.weight]));
  const benefit = p => members.reduce((sum,c)=>sum+(demand.get(c.id)||0)*Math.max(0,1-Math.hypot(p.x-c.x,p.y-c.y)/20),0);
  const workplaces = w.objects.filter(o=>type==="factory" ? o.type==="mine" && o.stock>0 : o.type==="factory");
  const anchors = CARE_BUILDINGS.includes(type)
    ? members.slice().sort((a,b)=>benefit(b)-benefit(a)).slice(0,6)
    : workplaces.length
      ? workplaces.slice(0,3).map(o=>({...o,builder:members.slice().sort((a,b)=>Math.hypot(a.x-o.x,a.y-o.y)-Math.hypot(b.x-o.x,b.y-o.y))[0]}))
      : members.slice().sort((a,b)=>siteDensity(w,b).residents-siteDensity(w,a).residents).slice(0,3);
  if (type === "orchard" && expanding) {
    for (const key of w.community.visited.slice(-12)) {
      const [x,y] = key.split(":").map(Number), p={x:x*8+4,y:y*8+4};
      const builder = members.slice().sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y))[0];
      if (Math.hypot(builder.x-p.x,builder.y-p.y)<48) anchors.push({...p,builder});
    }
  }
  const buildings=w.objects.filter(o=>SETTLEMENT_TYPES.has(o.type));
  const food=w.objects.filter(o=>["orchard","dwelling"].includes(o.type));
  const candidates=[];
  for (const c of anchors) {
    for (let i = 0; i < 24; i++) {
      const angle = i * 2.399963 + w.community.completed, r = 7 + Math.floor(i / 8) * 5;
      const p = { x: Math.round(c.x+Math.cos(angle)*r), y: Math.round(c.y+Math.sin(angle)*r) };
      if (!isExplored(w,p) || (!w.progress.bridge && !westBank(w,p)) || (w.directives.region && (p.x>42)!==(w.directives.region.x>42))) continue;
      if (services.some((o) => Math.hypot(o.x-p.x,o.y-p.y)<8) ||
          buildings.some((o) => Math.hypot(o.x-p.x,o.y-p.y)<6)) continue;
      if (!canPlace(w,type,p) || w.creatures.some((c) => Math.abs(c.x-p.x)<1.5 && Math.abs(c.y-p.y)<1.5)) continue;
      const builder=c.builder||c, density=siteDensity(w,p), served=benefit(p);
      const travel=Math.hypot(builder.x-p.x,builder.y-p.y);
      const campDistance=food.length?Math.min(...food.map(o=>Math.hypot(o.x-p.x,o.y-p.y))):0;
      const outpost=type==="orchard" && expanding && campDistance>=18 && campDistance<=38;
      const pollution=type==="factory" ? members.reduce((s,c)=>s+Math.max(0,1-Math.hypot(c.x-p.x,c.y-p.y)/12),0) : 0;
      candidates.push({...p,builder,benefit:served,density,travel,outpost,
        score:served*12+density.reward*3-travel*.15+(outpost?20:0)-pollution*3});
    }
  }
  candidates.sort((a,b)=>b.score-a.score);
  const sites=[];
  for (const p of candidates.slice(0,40)) {
    if (sites.some(s=>Math.hypot(s.x-p.x,s.y-p.y)<10)) continue;
    const slots=constructionSlots(w,p);
    if (slots.some(s=>Number.isFinite(routeCost(w,p.builder,s))) &&
        serviceSlots(w,{...p,type,level:1}).some(s=>Number.isFinite(routeCost(w,p.builder,s)))) {
      const {builder,...site}=p;
      sites.push(site);
      if (sites.length===3) break;
    }
  }
  return sites;
}
export function settlementChoices(w) {
  if (!independent(w) || w.community.project || !w.creatures.length ||
      w.objects.length >= LIMITS.objects - 4 || w.directives.pauseWork ||
      w.time-w.community.lastProjectAt < decisionPace(w.settings).development) return [];
  const choices = [], goal = activeGoal(w), care = careContext(w), plan=developmentPlan(w);
  const workers = w.creatures.filter((c)=>scoped(w,c) && c.sickness<50);
  const camp = workers.find((c)=>allowedRegion(w,c));
  if (!camp) return [];
  const resource = (id,target,description,priority=goal?100:id==="crossing"?60:id==="refine"?50:20) => choices.push({id,x:camp.x,y:camp.y,target,
    priority,description});
  if (goal?.kind === "wood") resource("timber",goal.target,`Cut trees and gather logs until we store ${goal.target} wood, as requested.`);
  else if (goal?.kind === "ore") resource("quarry",goal.target,`Break rocks and collect ore until we store ${goal.target} ore, as requested. Keep the ore.`);
  else if (goal?.kind === "bridge" && !w.progress.bridge) resource("crossing",24,"Cut timber and carry stored wood to finish the river bridge.");
  const resourceGoal=["wood","ore","bridge","blocks"].includes(goal?.kind);
  for (const type of INDEPENDENT_BUILDINGS) {
    const spec = BUILDINGS[type];
    if (!unlocked(w,spec) || (spec.cost && w.inventory.blocks < spec.cost) ||
        (type === "factory" && w.directives.avoidPollution) || (resourceGoal && !CARE_BUILDINGS.includes(type))) continue;
    const existing = w.objects.filter((o) => o.type === type && (type!=="mine" || o.stock>0)).length;
    if (!CARE_BUILDINGS.includes(type)) {
      const needed = {mine:Math.ceil(w.creatures.length/32),factory:Math.ceil(w.creatures.length/48),
        dwelling:Math.ceil(w.creatures.length/24),theatre:Math.ceil(w.creatures.length/64)}[type];
      if (existing>=needed) continue;
      if (type === "theatre" && w.creatures.length<40) continue;
    } else {
      const status = care[Object.keys(CARE_TYPES).find(k=>CARE_TYPES[k]===type)];
      const strained = status.low > w.creatures.length/4;
      const expansion=type==="orchard" && plan.expanding;
      if (resourceGoal && !status.urgent && !strained) continue;
      if ((!status.short && !status.growthShort && !strained && !expansion) || existing>=Math.ceil(w.creatures.length/4)) continue;
    }
    const kind = Object.keys(CARE_TYPES).find(k=>CARE_TYPES[k]===type), status = care[kind];
    const strained = status && status.low>w.creatures.length/4;
    const priority = status ? (!existing && status.unserved ? 100 : strained ? 80 : status.short ? 70 : status.growthShort ? 60 : type==="orchard" && plan.expanding ? 56 : 30) +
      Math.min(15,status.urgent + status.short/w.creatures.length*10) : ["mine","factory"].includes(type) ? 55 : 40;
    const sites = findSites(w,type,plan.expanding), point=sites[0];
    if (point) choices.push({id:type,...point,sites,cost:buildingMaterials(spec),
      priority,description:`Build ${spec.name}: ${existing} now${status ? `; ${status.low} low, ${status.short} residents lack nearby capacity, ${status.unserved} out of reach` : ""}; costs ${buildingCost(spec)}. Gather missing timber before construction. ${spec.help}`});
  }
  if (!resourceGoal && !w.progress.bridge && w.objects.some(o=>o.type==="bridge")) resource("crossing",24,"Gather timber and carry wood to finish the bridge, opening the other bank.");
  const hasFactory = w.objects.some(o=>o.type==="factory");
  if ((!resourceGoal && w.stage>=2 && !hasFactory && w.inventory.blocks<300) || goal?.kind==="blocks")
    resource("refine",goal?.kind==="blocks" ? goal.target : 300,"Break rocks, collect ore and work it into blocks by hand. Reach the factory unlock without help from the sky.");
  const reserve = timberReserve(w);
  // Crossing/first-block crews already gather their own inputs. A spare pile
  // must not postpone the milestones that unlock the rest of the economy.
  if (reserve.refill && !choices.some(c=>["crossing","refine"].includes(c.id) || (CARE_BUILDINGS.includes(c.id) && c.priority>=80)))
    resource("timber",reserve.target,`Replenish building timber: ${reserve.stock} wood stored, below the ${reserve.minimum} minimum. Collect loose logs or cut trees until ${reserve.target} wood is ready for upcoming buildings.`,75);
  return choices.sort((a,b)=>b.priority-a.priority).slice(0,8);
}
export function startSettlement(w, choice, source) {
  if (choice.id === "clearance") return startClearance(w,choice,source);
  if (!independent(w) || w.community.project || !DEVELOPMENT_TYPES.includes(choice.id) ||
      w.directives.pauseWork || w.objects.length >= LIMITS.objects-4 ||
      (!w.progress.bridge && !westBank(w,choice)) ||
      (w.directives.region && (choice.x>42)!==(w.directives.region.x>42)) ||
      (INDEPENDENT_BUILDINGS.includes(choice.id) && (!unlocked(w,BUILDINGS[choice.id]) ||
        w.inventory.blocks < (BUILDINGS[choice.id].cost||0) || !siteValid(w,choice.id,choice))) ||
      (choice.id === "factory" && w.directives.avoidPollution)) return false;
  const goal = activeGoal(w), required = {wood:"timber",bridge:"crossing",ore:"quarry"}[goal?.kind];
  if ((required && required!==choice.id && !CARE_BUILDINGS.includes(choice.id)) ||
      (goal?.kind==="blocks" && choice.id!=="refine" && !CARE_BUILDINGS.includes(choice.id))) return false;
  const slots = constructionSlots(w,choice);
  const crew = w.creatures.filter((c) => !c.carry && c.sickness < 50 && !working(c) &&
      !w.community.access.some(r=>r.status==="clearing" && r.crew.includes(c.id)) &&
      (!w.directives.members.length || w.directives.members.includes(c.id)) &&
      slots.some((p) => Number.isFinite(routeCost(w,c,p))))
    .sort((a,b) => (Math.min(a.fed,a.clean,a.amused)<60)-(Math.min(b.fed,b.clean,b.amused)<60) ||
      workOrder(a,b) || Math.hypot(a.x-choice.x,a.y-choice.y)-Math.hypot(b.x-choice.x,b.y-choice.y))
    .slice(0,4).map((c) => c.id);
  if (!crew.length) return false;
  w.community.project = { id: w.community.nextProject++, type: choice.id, x: choice.x, y: choice.y,
    crew, target:Math.max(1,Math.min(1e6,Math.floor(choice.target || 24))), progress: 0, required: 32, started: w.time, source, blocked: "",
    parentGoal:goal?.id||"colony", subgoal:choice.subgoal||choice.id,
    siteReason:choice.density ? `At ${choice.x}, ${choice.y}; ${choice.density.residents.toFixed(1)} residents / 100 ground units; density reward ${choice.density.reward.toFixed(1)}; ${Math.round(choice.travel)} units from builder.` : "" };
  w.community.lastProjectAt = w.time;
  prepareTimber(w);
  w.commandRevision++;
  w.navRevision++;
  w.revision++;
  activity(w,"construction",`We chose ${projectName(w.community.project).toLowerCase()} at ${Math.round(choice.x)}, ${Math.round(choice.y)}.`,source,`${crew.length} workers. ${w.community.project.siteReason} Goal: ${goal?.kind||"healthy growth"}. ${choice.description || "Gather real materials and respect our needs."}`);
  remember(w,"self-build",`The colony chose ${projectName(w.community.project).toLowerCase()} with ${source}.`);
  return true;
}
function siteValid(w,type,p) {
  const node = type==="mine" ? nearbyObjects(w,p.x,p.y,2).find(o=>o.type==="node" && o.stock>0 && Math.hypot(o.x-p.x,o.y-p.y)<.1) : null;
  return (type!=="mine" || node) && canPlace(w,type,p,node?.id) &&
    (type==="mine" || !w.objects.some(o=>SETTLEMENT_TYPES.has(o.type) && Math.hypot(o.x-p.x,o.y-p.y)<6));
}
export function prepareTimber(w) {
  const p = w.community.project;
  if (!p || !independent(w)) return;
  const goal = activeGoal(w), required = {wood:"timber",ore:"quarry",bridge:"crossing",blocks:"refine"}[goal?.kind];
  if (required && p.type !== required && !CARE_BUILDINGS.includes(p.type)) {
    w.community.project=null; w.community.lastProjectAt=w.time-decisionPace(w.settings).development;
    w.commandRevision++; w.navRevision++;
    activity(w,"project","We will work toward your new goal.","Your words","Gathered resources remain in storage.");
    return;
  }
  if (!p.crew.some((id)=>w.creatures.some((c)=>c.id===id)) || w.time-p.started>240) {
    w.community.project = null;
    w.community.lastProjectAt=w.time; w.commandRevision++; w.navRevision++;
    activity(w,"blocked","Our crew needs a new plan.","Instincts","Materials already gathered remain in storage. We will reconsider after caring for everyone.");
    return;
  }
  const crew = w.creatures.filter(c=>projectAllowed(w,c));
  if (!crew.length || !resourceNeeded(w,p)) return;
  if (!["gather","quarry"].includes(projectTask(w,crew[0]))) return;
  const types = ["quarry","refine"].includes(p.type) ? ["rock","ore"] : ["tree","log"];
  const accessible = (o) => allowedRegion(w,o) && serviceSlots(w,o).some(s=>crew.some(c=>Number.isFinite(routeCost(w,c,s))));
  const saved = w.objects.filter(o=>types.includes(o.type) && Math.hypot(o.x-p.x,o.y-p.y)<28 && accessible(o));
  if (saved.length>=3 || (p.type==="refine" && w.inventory.ore>0)) return;
  const natural = nearbyObjects(w,p.x,p.y,28).filter(o=>types.includes(o.type) && o.id.startsWith("g:"))
    .sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y));
  let count=saved.length;
  for(const o of natural.slice(0,24)) {
    if(count>=3 || w.objects.length>=LIMITS.objects-4) break;
    if(accessible(o) && materializeObject(w,o)) count++;
  }
  if (!count) {
    const o=[...w.objects.filter(o=>types.includes(o.type)),...natural].filter(o=>allowedRegion(w,o))
      .sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y))[0];
    if(o) requestAccess(w,{target:o.id,point:serviceSlots(w,o,crew[0])[0]||accessPoint(o,crew[0]),
      unit:crew[0].id,task:projectTask(w,crew[0]),project:p.id});
  }
}
export function settlementDecisionInput(w, choices) {
  const care=careContext(w), reserve=timberReserve(w);
  // Keep the effect of each building in its short option label. Optional site
  // descriptions can be omitted by the token budget; internal type names alone
  // do not tell a small classifier which need a building will actually serve.
  const options = Object.fromEntries([...choices.map(c=>[c.key||c.id,
    c.id==="clearance" ? `Clear ${c.obstacle || "obstacle"} to ${c.resume || "resume blocked work"}` : c.density ? `Build ${careServices(c.id).join("/") || BUILDINGS[c.id]?.name || c.id}; ${buildingCost(BUILDINGS[c.id])}; help ${Math.round(c.benefit)}; reward ${Math.round(c.density.reward)}`
      : `${c.id}: target ${c.target} ${RESOURCE_PROJECTS[c.id]?.material||"wood"}`]),["wait","Postpone building; no new care capacity"]]);
  const shortage=Object.entries(care).map(([k,s])=>`${k}: ${s.low} low, ${s.short} short, ${s.urgent} urgent`).join("; ");
  const requiredContext = `${w.creatures.length} residents. ${shortage}. Wood ${reserve.stock} (refill below ${reserve.minimum}, target ${reserve.target}), ore ${Math.floor(w.inventory.ore)}, blocks ${Math.floor(w.inventory.blocks)}. Goal ${activeGoal(w)?.kind||"grow"}. ${accessBrief(w)} Urgent care first; ${reserve.refill ? "replenish timber before optional expansion" : "gather missing building timber"}. Prefer more help and reward closer to zero.`;
  const contextParts = choices.map(c=>c.description);
  return {options,requiredContext,contextParts,context:[requiredContext,...contextParts].join(" "),
    question:"Which project and location best advance the goal?",maxTokens:320};
}
export function settlementContext(w,choices) {
  return {care:careContext(w), plan:developmentPlan(w), timber:timberReserve(w),
    densityRule:{target:DENSITY.target,above:DENSITY.above,below:DENSITY.below,units:"residents per 100 ground units; asymmetric squared penalty"},
    choices:choices.map(({key,id,x,y,target,cost,priority,description,density,benefit,travel,subgoal,request,blocker})=>({key,id,at:[x,y],target,cost,priority,description,density,benefit,travel,subgoal,request,blocker}))};
}
// An unserved essential need or widespread low needs temporarily rules out
// unrelated expansion. The model can choose among useful care buildings (homes
// included) or wait. Never rely on a small classifier to enforce this invariant.
export function settlementDecisionChoices(w) {
  const choices=[...clearanceChoices(w),...settlementChoices(w)];
  const urgent=choices.filter(c=>CARE_BUILDINGS.includes(c.id) && c.priority>=80);
  const useful=urgent.length ? choices.filter(c=>c.id==="clearance" || urgent.some(u=>careServices(u.id).some(kind=>careServices(c.id).includes(kind)))) : choices;
  const selected=useful.slice(0,4).map(({sites,...c})=>c);
  for (const c of useful.slice(0,3)) for (const site of c.sites?.slice(1)||[]) {
    if (selected.length>=6) break;
    const {sites,...base}=c;
    selected.push({...base,...site});
  }
  const counts=new Map();
  return selected.map(c=>{
    const number=(counts.get(c.id)||0)+1;counts.set(c.id,number);
    return {...c,key:c.key || (number===1?c.id:`${c.id}_${number}`),subgoal:c.subgoal || (CARE_BUILDINGS.includes(c.id)?`care-${careServices(c.id)[0]}`:c.id)};
  });
}
// Asynchronous results must still describe a useful, valid choice. Recalculate
// the site and shortages instead of applying stale coordinates or old demand.
export function currentSettlementChoice(w,choice) {
  if (!choice) return null;
  if (choice.id==="clearance") return clearanceChoices(w).find(c=>c.request===choice.request && c.blocker===choice.blocker) || null;
  const choices=settlementDecisionChoices(w), current=choices.find(c=>c.id===choice.id);
  if (!current) return null;
  const urgent=choices.filter(c=>CARE_BUILDINGS.includes(c.id) && c.priority>=80);
  if (urgent.length && !urgent.some(c=>careServices(c.id).some(kind=>careServices(current.id).includes(kind)))) return null;
  // Preserve the location the model actually chose. A stale site is rejected,
  // never silently moved to a different neighborhood during inference.
  if (isConstruction({type:choice.id})) {
    if (!allowedRegion(w,choice) || !siteValid(w,choice.id,choice)) return null;
    const density=siteDensity(w,choice);
    if (density.reward < (current.density?.reward ?? 0)-12) return null;
    return {...choice,density};
  }
  return {...current,key:choice.key};
}
export function finishSettlement(w, placeBuilding) {
  const p = w.community.project;
  if (!p || !independent(w)) return;
  if (!isConstruction(p)) {
    if (resourceNeeded(w,p)) return;
    w.community.completed++;
    w.community.lastProjectAt=w.time; w.community.project=null;
    w.commandRevision++; w.navRevision++;
    activity(w,"gathered",`${projectName(p)} finished.`,p.source,"Real materials gathered by the crew; ready for the next project.");
    return p.id;
  }
  if (p.progress < p.required) return;
  const error = placeBuilding(w,p.type,p.x,p.y);
  if (error) {
    if (p.blocked !== error) activity(w,"blocked",`${BUILDINGS[p.type].name} is waiting.`,"Instincts",error);
    p.blocked = error;
    const node = p.type === "mine" ? nearbyObjects(w,p.x,p.y,2).find(o=>o.type==="node") : null;
    if (!canPlace(w,p.type,p,node?.id,{ignoreCreatures:true})) {
      // A player edit supersedes this site. No wood has been charged.
      w.community.project = null; w.community.lastProjectAt = w.time;
      w.commandRevision++;
      w.navRevision++;
    }
    return;
  }
  w.community.completed++;
  w.community.lastProjectAt = w.time;
  w.community.project = null;
  activity(w,"built",`${BUILDINGS[p.type].name} finished.`,p.source,`${buildingCost(BUILDINGS[p.type])} used. The whole colony can use it now.`);
  postMessage(w,completionLetter(w,p,BUILDINGS[p.type].name));
  return p.id;
}
