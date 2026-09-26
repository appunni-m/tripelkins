import { decisionPace } from "../intelligence-settings.js";
import { workProjects, workerProject, addWorkProject, removeWorkProject, projectLimit, MAX_PROJECT_CREW } from "./work-projects.js";
import { completionLetter } from "./colony-letters.js";
import { clearanceChoices, startClearance, requestAccess, accessPoint, accessBrief } from "./access.js";
import { workOrder, working } from "./work-balance.js";
import { DENSITY, siteDensity, SETTLEMENT_TYPES } from "./density.js";
import { developmentPlan } from "./development-plan.js";
import { assessOutpost, outpostCamps, outpostContext } from "./outposts.js";
import { careContext, careDemand, careServices, CARE_TYPES } from "./care-context.js";
import { isExplored } from "./discovery.js";
import { BUILDINGS, LIMITS, unlocked, buildingMaterials, buildingCost, goal as storyObjective } from "./catalog.js";
import { canPlace, clearPosition, serviceSlots, bridgeGeometry } from "./geometry.js";
import { nearbyObjects, westBank } from "./map.js";
import { routeCost, withRouteCosts } from "./navigation.js";
import { materializeObject, remember } from "./state.js";
import { activity, postMessage } from "./community.js";
import { CARE_BUILDINGS, INDEPENDENT_BUILDINGS, RESOURCE_PROJECTS, DEVELOPMENT_TYPES,
  projectName, isConstruction, projectFunded, projectRequirements, timberReserve, colonyMilestone, industryMilestone,
  nextIndustryBuilding, uncommittedBlocks } from "./development.js";
import { orbitalPlan } from "./orbit-rules.js";
export { CARE_BUILDINGS } from "./development.js";
const activeGoal = (w) => w.memory.goals.find((g) => g.status === "active");
export function outpostReason(p) {
  if(!p?.worthwhile)return "";
  if(p.purpose==="ore-delivery")return p.unserved ? `Process ore beside ${p.workers} miners without a reachable workshop.`
    : `Shorter ore trips for ${p.workers} miners: save about ${Math.round(p.savedSeconds)} worker-seconds over five minutes; repay building effort in ${p.paybackSeconds}s.`;
  return p.unserved ? `Local support for ${p.workers} residents without a reachable service.`
    : `Local support for ${p.workers} residents: save about ${Math.round(p.savedSeconds)} worker-seconds over five minutes; repay building effort in ${p.paybackSeconds}s.`;
}
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
  const p = workerProject(w,c);
  if (p.type === "crossing") return w.inventory.wood > 0 ? "haul" : "gather";
  if (p.type === "timber") return resourceNeeded(w,p) ? "gather" : null;
  if (p.type === "quarry") return resourceNeeded(w,p) ? "quarry" : null;
  if (p.type === "refine") return resourceNeeded(w,p) ? (w.inventory.ore > 0 ? "refine" : "quarry") : null;
  const requirements=projectRequirements(w,p);
  if(w.inventory.wood<requirements.wood)return "gather";
  if(w.inventory.blocks<requirements.blocks)return w.inventory.ore>0?"refine":"quarry";
  return projectFunded(w,p)?"construct":null;
}
export function refiningShortage(w,p) {
  const loose=localOre(w,p).reduce((n,o)=>n+o.stock,0);
  const carried=w.creatures.reduce((n,c)=>n+(p.crew.includes(c.id) && c.cargoKind==="ore" &&
    w.objects.find(o=>o.id===c.target)?.type!=="factory" ? c.carry:0),0);
  return Math.max(0,Math.ceil((p.target-w.inventory.blocks)/10)-w.inventory.ore-loose-carried);
}
const oreReachability=new WeakMap();
export function localOre(w,p) {
  const stamp=`${Math.floor(w.time/2)}:${w.navRevision}:${w.map.revision}:${w.discovery.revision}:${w.objects.length}`;
  let cache=oreReachability.get(w);
  if(cache?.stamp!==stamp) {cache={stamp,projects:new Map()};oreReachability.set(w,cache);}
  if(!cache.projects.has(p.id)) {
    const crew=w.creatures.filter(c=>p.crew.includes(c.id));
    const ids=w.objects.filter(o=>o.type==="ore" && isExplored(w,o) && Math.hypot(o.x-p.x,o.y-p.y)<=32 &&
      crew.slice().sort((a,b)=>Math.hypot(a.x-o.x,a.y-o.y)-Math.hypot(b.x-o.x,b.y-o.y)).slice(0,4)
        .some(c=>serviceSlots(w,o,c).some(s=>Number.isFinite(routeCost(w,c,s))))).map(o=>o.id);
    cache.projects.set(p.id,new Set(ids));
  }
  const ids=cache.projects.get(p.id);
  return w.objects.filter(o=>ids.has(o.id) && o.type==="ore" && o.stock>0);
}
// Keep one real input batch for hand-processing crews. Workshops may consume
// the surplus; otherwise their delivery reservations can starve new buildings.
export function refiningOreReserve(w) {
  const projects=workProjects(w).filter(p=>p.type==="refine");
  const needed=Math.max(0,...projects.map(p=>Math.ceil((p.target-w.inventory.blocks)/10)));
  return independent(w) ? Math.min(needed,projects.reduce((n,p)=>n+p.crew.length,0)) : 0;
}
export const deliveryStock=(w,kind)=>Math.max(0,w.inventory[kind]-(kind==="ore"?refiningOreReserve(w):0));
export const factoryInputTarget=o=>Math.min(60,2*3*BUILDINGS.factory.capacity*(o.level||1));
export function projectTasks(w,c) {
  const task=projectTask(w,c), p=workerProject(w,c);
  if(!task) return [];
  if(p.type!=="refine") return [task];
  // Keep the supply chain flowing: the few people holding ore reservations
  // refine it while others quarry or collect loose ore. One ore in storage
  // must not turn every quarry worker into a waiting refiner.
  // Industrial schedules do not otherwise include hauling. Loose input is
  // already counted toward the goal, so the crew must collect it even when
  // no further quarrying is needed.
  return [...(w.inventory.ore>0?["refine"]:[]),
    ...(localOre(w,p).length?["haul"]:[]),
    ...(refiningShortage(w,p)>0?["quarry"]:[])];
}
export function storedSupply(w,c,o) {
  if (!independent(w) || !scoped(w,c) || !allowedRegion(w,o.type==="bridge" ? bridgeGeometry(o).a : o)) return null;
  if (o.type === "factory" && (o.inputOre||0)<factoryInputTarget(o) && deliveryStock(w,"ore")>0 && activeGoal(w)?.kind!=="ore") return "ore";
  if (o.type === "bridge" && !bridgeGeometry(o).complete && w.inventory.wood>0 &&
      workerProject(w,c)?.type==="crossing" && projectAllowed(w,c)) return "wood";
  return null;
}
export function independent(w) {
  return w.community.consent === "accepted" && w.settings.autonomy !== false &&
    w.runtime?.intelligenceAvailable === true && w.stage < 3;
}
export function projectAllowed(w, c) {
  const goal = activeGoal(w), p = workerProject(w,c);
  const required = {wood:"timber",bridge:"crossing",ore:"quarry"}[goal?.kind];
  return independent(w) && p?.crew.includes(c.id) && scoped(w,c) &&
    (!required || p.type === required || CARE_BUILDINGS.includes(p.type)) &&
    !(goal?.kind === "blocks" && isConstruction(p) && !CARE_BUILDINGS.includes(p.type));
}
export function constructionSlots(w, project = w.community.project) {
  if (!project) return [];
  const corners=[[-2.3,-2.3],[2.3,-2.3],[2.3,2.3],[-2.3,2.3]];
  // Hand processing has no shared machine: each crew member gets a distinct
  // local work position. Actual building entrances still have four slots.
  const points=isConstruction(project) ? corners : Array.from({length:Math.max(4,project.crew?.length||4)},(_,i)=>{
    const scale=1+Math.floor(i/4)*.6;return corners[i%4].map(v=>v*scale);
  });
  return points
    .map(([x,y], slot) => ({ x: project.x+x, y: project.y+y, slot }))
    .filter((p) => clearPosition(w,p));
}
function findSites(w, type, expanding = false) {
  if (type === "mine") {
    for (const c of w.creatures.filter(c=>scoped(w,c) && !c.carry && c.sickness<50 && !working(c) && !workerProject(w,c))) {
      for (const node of nearbyObjects(w,c.x,c.y,28).filter((o)=>o.type==="node" && o.stock>0)) {
        if (allowedRegion(w,node) && siteValid(w,type,node) &&
            constructionSlots(w,node).some((p)=>Number.isFinite(routeCost(w,c,p))))
          return [{x:node.x,y:node.y,density:siteDensity(w,node),benefit:0,travel:Math.hypot(c.x-node.x,c.y-node.y)}];
      }
    }
    return [];
  }
  const services = w.objects.filter((o) => o.type === type || (type !== "roundabout" && o.type === "dwelling"));
  const members = w.creatures.filter((c) => c.sickness < 50 &&
    (!w.directives.members.length || w.directives.members.includes(c.id)));
  const builders=members.filter(c=>!c.carry && !working(c) && !workerProject(w,c));
  if (!builders.length) return [];
  const builderFor=p=>builders.slice().sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y))[0];
  // Put new facilities near the least-served residents, spaced out from old ones.
  const demand = new Map(careDemand(w,type).map(c=>[c.id,c.weight]));
  const benefit = p => members.reduce((sum,c)=>sum+(demand.get(c.id)||0)*Math.max(0,1-Math.hypot(p.x-c.x,p.y-c.y)/20),0);
  const workplaces = w.objects.filter(o=>type==="factory" ? o.type==="mine" && o.stock>0 : o.type==="factory");
  const anchors = CARE_BUILDINGS.includes(type)
    ? members.slice().sort((a,b)=>benefit(b)-benefit(a)).slice(0,6).map(c=>({...c,builder:builderFor(c)}))
    : workplaces.length
      ? workplaces.slice().sort((a,b)=>{
          const nearest=p=>Math.min(80,...services.map(s=>Math.hypot(p.x-s.x,p.y-s.y)));
          return nearest(b)-nearest(a);
        }).slice(0,4).map(o=>({...o,builder:builderFor(o)}))
      : members.slice().sort((a,b)=>siteDensity(w,b).residents-siteDensity(w,a).residents).slice(0,3).map(c=>({...c,builder:builderFor(c)}));
  if(careServices(type).length) for(const camp of outpostCamps(w)) {
    if(!careServices(type).some(kind=>camp.distances[kind]>18))continue;
    if(anchors.some(p=>Math.hypot(p.x-camp.x,p.y-camp.y)<10))continue;
    anchors.push({...camp,builder:builderFor(camp)});
  }
  if (type === "orchard" && expanding) {
    for (const key of w.community.visited.slice(-12)) {
      const [x,y] = key.split(":").map(Number), p={x:x*8+4,y:y*8+4};
      const builder = builderFor(p);
      if (Math.hypot(builder.x-p.x,builder.y-p.y)<48) anchors.push({...p,builder});
    }
  }
  const buildings=[...w.objects.filter(o=>SETTLEMENT_TYPES.has(o.type)),...workProjects(w).filter(isConstruction)];
  const candidates=[];
  for (const c of anchors.slice(0,12)) {
    for (let i = 0; i < 24; i++) {
      const angle = i * 2.399963 + w.community.completed, r = 7 + Math.floor(i / 8) * 5;
      const p = { x: Math.round(c.x+Math.cos(angle)*r), y: Math.round(c.y+Math.sin(angle)*r) };
      if (!isExplored(w,p) || (!w.progress.bridge && !westBank(w,p)) || (w.directives.region && (p.x>42)!==(w.directives.region.x>42))) continue;
      if (services.some((o) => Math.hypot(o.x-p.x,o.y-p.y)<8) ||
          buildings.some((o) => Math.hypot(o.x-p.x,o.y-p.y)<6)) continue;
      if (!canPlace(w,type,p) || w.creatures.some((c) => Math.abs(c.x-p.x)<1.5 && Math.abs(c.y-p.y)<1.5)) continue;
      const builder=c.builder||c, density=siteDensity(w,p), served=benefit(p);
      const travel=Math.hypot(builder.x-p.x,builder.y-p.y);
      if(travel>32)continue;
      const outpost=assessOutpost(w,type,p,travel);
      const pollution=type==="factory" ? members.reduce((s,c)=>s+Math.max(0,1-Math.hypot(c.x-p.x,c.y-p.y)/12),0) : 0;
      candidates.push({...p,builder,benefit:served,density,travel,outpost,
        score:served*12+density.reward*3-travel*.15+(outpost?.worthwhile?Math.min(80,Math.max(0,outpost.netSeconds)/8+outpost.unserved*3):0)-pollution*3});
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
      site.outpost=assessOutpost(w,type,p,Math.min(...slots.map(s=>routeCost(w,builder,s))),{routed:true});
      sites.push(site);
      if (sites.length===3) break;
    }
  }
  return sites;
}
export function settlementChoices(w) {
  return withRouteCosts(w,()=>availableSettlementChoices(w));
}
function availableSettlementChoices(w) {
  if (!independent(w) || workProjects(w).length>=projectLimit(w) || !w.creatures.length ||
      w.objects.length >= LIMITS.objects - 4 || w.directives.pauseWork ||
      w.time-w.community.lastProjectAt < Math.max(1,decisionPace(w.settings).development/3)) return [];
  const choices = [], goal = activeGoal(w), milestone=colonyMilestone(w), industry=industryMilestone(w), care = careContext(w), plan=developmentPlan(w), orbital=orbitalPlan(w);
  const workers = w.creatures.filter((c)=>scoped(w,c) && c.sickness<50 && !workerProject(w,c));
  const camp = workers.find((c)=>allowedRegion(w,c));
  if (!camp) return [];
  const resource = (id,target,description,priority=goal?100:id==="crossing"?60:id==="refine"?50:20) => {
    const active=workProjects(w).filter(p=>p.type===id);
    if (id==="crossing" && active.length) return;
    // One model decision can mobilize several local groups for the SAME shared
    // resource goal. Sites are explicit in the offer and revalidated on return.
    const demand=Math.ceil(Math.max(0,target-w.inventory[RESOURCE_PROJECTS[id].material])/(id==="refine"?10:id==="timber"?6:3));
    const assigned=active.reduce((n,p)=>n+p.crew.length,0);
    const camps=[], limit=id==="crossing" ? 1 : Math.min(8,Math.ceil(w.creatures.length/40),
      Math.ceil(Math.max(0,demand-assigned)/12));
    const types=id==="timber"||id==="crossing"?["tree","log"]:["rock","ore"];
    const demandSites=workProjects(w).filter(p=>isConstruction(p) && !projectFunded(w,p));
    // Prefer local sources beside outstanding work, not the first creature ID.
    // Only explored, reachable resources qualify; discovery still happens on foot.
    const sources=new Map();
    const candidates=workers.filter(c=>!c.carry && !working(c) && allowedRegion(w,c)).slice().sort(workOrder);
    const scored=[];
    for(const c of candidates) {
      const cell=`${Math.floor(c.x/12)}:${Math.floor(c.y/12)}`;
      if(!sources.has(cell))sources.set(cell,nearbyObjects(w,Math.floor(c.x/12)*12+6,Math.floor(c.y/12)*12+6,38).filter(o=>types.includes(o.type) &&
        allowedRegion(w,o) && (o.type==="tree"||o.type==="rock"||o.stock>0)));
      const nearby=sources.get(cell).filter(o=>Math.hypot(o.x-c.x,o.y-c.y)<=32)
        .sort((a,b)=>Math.hypot(a.x-c.x,a.y-c.y)-Math.hypot(b.x-c.x,b.y-c.y));
      const source=nearby.slice(0,3).find(o=>serviceSlots(w,o,c).some(s=>Number.isFinite(routeCost(w,c,s))));
      const stocked=id==="refine"?w.inventory.ore>0:id==="crossing"&&w.inventory.wood>0;
      if(!source&&!stocked)continue;
      const demandDistance=Math.min(48,...demandSites.map(p=>Math.hypot(p.x-c.x,p.y-c.y)));
      scored.push({c,score:(source?Math.hypot(source.x-c.x,source.y-c.y):0)+demandDistance*.35});
    }
    scored.sort((a,b)=>a.score-b.score||workOrder(a.c,b.c));
    for (const {c} of scored) {
      if(camps.length>=limit) break;
      if(!c.carry && !working(c) && allowedRegion(w,c) &&
          [...active,...camps].every(p=>Math.hypot(p.x-c.x,p.y-c.y)>=18)) camps.push({x:c.x,y:c.y});
    }
    if(camps.length) choices.push({id,...camps[0],camps,target,priority,description:`${description} ${camps.length} local crews share this target.`});
  };
  if (goal?.kind === "wood") resource("timber",goal.target,`Cut trees and gather logs until we store ${goal.target} wood, as requested.`);
  else if (goal?.kind === "ore") resource("quarry",goal.target,`Break rocks and collect ore until we store ${goal.target} ore, as requested. Keep the ore.`);
  else if ((goal?.kind === "bridge" || milestone?.project === "crossing") && !w.progress.bridge)
    resource("crossing",24,"Cut timber and carry stored wood to finish the river bridge.");
  const resourceGoal=!!milestone || ["wood","ore","bridge","blocks"].includes(goal?.kind);
  for (const type of INDEPENDENT_BUILDINGS) {
    const spec = BUILDINGS[type];
    if (!unlocked(w,spec) || (spec.cost && uncommittedBlocks(w) < spec.cost) ||
        (type === "factory" && w.directives.avoidPollution) ||
        (resourceGoal && !CARE_BUILDINGS.includes(type) && !(type === "cannon" && orbital.missionActive))) continue;
    const existing = w.objects.filter((o) => o.type === type && (type!=="mine" || o.stock>0)).length+
      workProjects(w).filter(p=>p.type===type).length;
    if (!CARE_BUILDINGS.includes(type)) {
      const needed = type === "cannon" ? 1 : {mine:Math.ceil(w.creatures.length/32),factory:Math.ceil(w.creatures.length/48),
        dwelling:Math.ceil(w.creatures.length/24),theatre:Math.ceil(w.creatures.length/64)}[type];
      if (existing>=needed) continue;
      if(type==="mine") {
        const processors=w.objects.filter(o=>o.type==="factory").length+workProjects(w).filter(p=>p.type==="factory").length;
        // A works processes 3 ore / 2.8 seconds per slot; a mine produces
        // 3 ore / 3 seconds per slot. Bootstrap one source, then grow the
        // supply chain together instead of spending the first blocks on mines.
        const matched=Math.max(1,Math.ceil(processors*(BUILDINGS.factory.capacity*3/2.8)/(BUILDINGS.mine.capacity*3/3)));
        if(existing>=matched)continue;
      }
      if (type === "theatre" && w.creatures.length<40) continue;
    } else {
      const status = care[Object.keys(CARE_TYPES).find(k=>CARE_TYPES[k]===type)];
      const strained = status.low > w.creatures.length/4;
      const expansion=type==="orchard" && plan.expanding;
      if (resourceGoal && !status.urgent && !strained && !outpostContext(w).some(c=>careServices(type).includes(c.kind))) continue;
      if ((!status.short && !status.growthShort && !strained && !expansion && !outpostContext(w).some(c=>careServices(type).includes(c.kind))) || existing>=Math.ceil(w.creatures.length/4)) continue;
    }
    const kind = Object.keys(CARE_TYPES).find(k=>CARE_TYPES[k]===type), status = care[kind];
    const strained = status && status.low>w.creatures.length/4;
    const priority = type === "cannon" ? 95 : status ? (!existing && status.unserved ? 100 : strained ? 80 : status.short ? 70 : status.growthShort ? 60 : type==="orchard" && plan.expanding ? 56 : 30) +
      Math.min(15,status.urgent + status.short/w.creatures.length*10) : ["mine","factory"].includes(type) ? industry?(type==="factory"?90:85):55 : 40;
    const sites = findSites(w,type,plan.expanding), point=sites[0];
    if (point) choices.push({id:type,...point,sites,cost:buildingMaterials(spec),
      priority:Math.max(priority,point.outpost?.worthwhile?78:0),description:`Build ${spec.name}: ${existing} now${status ? `; ${status.low} low, ${status.short} residents lack nearby capacity, ${status.unserved} out of reach` : ""}; costs ${buildingCost(spec)}. ${outpostReason(point.outpost)} Gather missing timber before construction. ${spec.help}`});
  }
  if (!resourceGoal && !w.progress.bridge && w.objects.some(o=>o.type==="bridge")) resource("crossing",24,"Gather timber and carry wood to finish the bridge, opening the other bank.");
  const hasFactory = w.objects.some(o=>o.type==="factory");
  if(industry && hasFactory && !w.objects.some(o=>o.type==="mine" && o.stock>0) && w.inventory.ore<12)
    resource("quarry",Math.max(12,Math.ceil(w.creatures.length/8)),"Supply our stone workshops with real ore while we establish stocked mines.",80);
  if ((!resourceGoal && w.stage>=2 && !hasFactory && w.inventory.blocks<300) || goal?.kind==="blocks" || milestone?.project==="refine")
    resource("refine",goal?.kind==="blocks" ? goal.target : 300,"Break rocks, collect ore and work it into blocks by hand. Reach the factory unlock without help from the sky.",goal||milestone?100:industry?90:50);
  else if(industry) {
    const next=nextIndustryBuilding(w), cost=BUILDINGS[next]?.cost||0;
    if(next && uncommittedBlocks(w)<cost) {
      const amount=w.inventory.blocks+(cost-uncommittedBlocks(w));
      resource("refine",amount,`Quarry stone and make enough blocks to build the next ${BUILDINGS[next].name.toLowerCase()}.`,90);
    } else if(uncommittedBlocks(w)<150 &&
        w.objects.filter(o=>o.type==="factory").length+workProjects(w).filter(p=>p.type==="factory").length<Math.ceil(w.creatures.length/48))
      resource("refine",w.inventory.blocks-uncommittedBlocks(w)+300,"Make a building reserve of 300 uncommitted blocks so idle neighborhoods can establish more workplaces.",
        w.objects.some(o=>o.type==="mine" && o.stock>0) && !hasFactory ? 90 : 75);
  }
  const reserve = timberReserve(w);
  // Crossing/first-block crews already gather their own inputs. A spare pile
  // must not postpone the milestones that unlock the rest of the economy.
  if (reserve.refill && !choices.some(c=>["crossing","refine"].includes(c.id) || (CARE_BUILDINGS.includes(c.id) && c.priority>=80)))
    resource("timber",reserve.target,`Replenish building timber: ${reserve.stock} wood stored, below the ${reserve.minimum} minimum. Collect loose logs or cut trees until ${reserve.target} wood is ready for upcoming buildings.`,75);
  return choices.sort((a,b)=>b.priority-a.priority).slice(0,8);
}
export function startSettlement(w, choice, source) {
  const started=startProject(w,choice,source);
  if(started && RESOURCE_PROJECTS[choice.id] && choice.id!=="crossing")
    for(const camp of (choice.camps||[]).slice(1,8)) startProject(w,{...choice,...camp,camps:undefined},source);
  return started;
}
function startProject(w, choice, source) {
  if (choice.id === "clearance") return startClearance(w,choice,source);
  if (!independent(w) || workProjects(w).length>=projectLimit(w) || !DEVELOPMENT_TYPES.includes(choice.id) ||
      w.directives.pauseWork || w.objects.length >= LIMITS.objects-4 ||
      !allowedRegion(w,choice) ||
      (w.directives.region && (choice.x>42)!==(w.directives.region.x>42)) ||
      (INDEPENDENT_BUILDINGS.includes(choice.id) && (!unlocked(w,BUILDINGS[choice.id]) ||
        uncommittedBlocks(w) < (BUILDINGS[choice.id].cost||0) || !siteValid(w,choice.id,choice))) ||
      (choice.id === "factory" && w.directives.avoidPollution)) return false;
  const goal = activeGoal(w), required = {wood:"timber",bridge:"crossing",ore:"quarry"}[goal?.kind];
  if ((required && required!==choice.id && !CARE_BUILDINGS.includes(choice.id)) ||
      (goal?.kind==="blocks" && choice.id!=="refine" && !CARE_BUILDINGS.includes(choice.id))) return false;
  const slots = constructionSlots(w,choice);
  if (workProjects(w).some(p=>p.type===choice.id &&
      (choice.id==="crossing" || Math.hypot(p.x-choice.x,p.y-choice.y)<18))) return false;
  const localCount=w.creatures.filter(c=>Math.hypot(c.x-choice.x,c.y-choice.y)<=24).length;
  const crewSize=isConstruction({type:choice.id}) || choice.id==="crossing" ? 4 : Math.min(MAX_PROJECT_CREW,Math.max(4,Math.ceil(localCount/3)));
  const crew = w.creatures.filter((c) => !c.carry && c.sickness < 50 && !working(c) && !workerProject(w,c) &&
      Math.hypot(c.x-choice.x,c.y-choice.y)<=32 &&
      !w.community.access.some(r=>r.status==="clearing" && r.crew.includes(c.id)) &&
      (!w.directives.members.length || w.directives.members.includes(c.id)) &&
      slots.some((p) => Number.isFinite(routeCost(w,c,p))))
    .sort((a,b) => (Math.min(a.fed,a.clean,a.amused)<60)-(Math.min(b.fed,b.clean,b.amused)<60) ||
      workOrder(a,b) || Math.hypot(a.x-choice.x,a.y-choice.y)-Math.hypot(b.x-choice.x,b.y-choice.y))
    .slice(0,crewSize).map((c) => c.id);
  if (!crew.length) return false;
  const project = { id: w.community.nextProject++, type: choice.id, x: choice.x, y: choice.y,
    crew, target:Math.max(1,Math.min(1e6,Math.floor(choice.target || 24))), progress: 0, required: 32, started: w.time, source, blocked: "",
    parentGoal:goal?.id||colonyMilestone(w)?.id||industryMilestone(w)?.id||"colony", subgoal:choice.subgoal||choice.id,
    siteReason:choice.density ? `${outpostReason(choice.outpost)} At ${choice.x}, ${choice.y}; ${choice.density.residents.toFixed(1)} residents / 100 ground units; density reward ${choice.density.reward.toFixed(1)}; ${Math.round(choice.travel)} units from builder.` : "" };
  addWorkProject(w,project);
  w.community.lastProjectAt = w.time;
  prepareTimber(w);
  w.commandRevision++;
  w.navRevision++;
  w.revision++;
  activity(w,"construction",`We chose ${projectName(project).toLowerCase()} at ${Math.round(choice.x)}, ${Math.round(choice.y)}.`,source,`${crew.length} local workers; ${workProjects(w).length} crews active. ${project.siteReason} Goal: ${goal?.kind||colonyMilestone(w)?.title||industryMilestone(w)?.title||"healthy growth"}. ${choice.description || "Gather real materials and respect our needs."}`);
  remember(w,"self-build",`The colony chose ${projectName(project).toLowerCase()} with ${source}.`);
  return true;
}
function siteValid(w,type,p) {
  if (workProjects(w).some(o=>Math.hypot(o.x-p.x,o.y-p.y)<(o.type===type?18:6))) return false;
  const node = type==="mine" ? nearbyObjects(w,p.x,p.y,2).find(o=>o.type==="node" && o.stock>0 && Math.hypot(o.x-p.x,o.y-p.y)<.1) : null;
  return (type!=="mine" || node) && canPlace(w,type,p,node?.id) &&
    (type==="mine" || !w.objects.some(o=>SETTLEMENT_TYPES.has(o.type) && Math.hypot(o.x-p.x,o.y-p.y)<6));
}
export function prepareTimber(w) {
  for (const p of workProjects(w)) prepareProject(w,p);
}
function prepareProject(w,p) {
  if (!p || !independent(w)) return;
  const goal = activeGoal(w), required = {wood:"timber",ore:"quarry",bridge:"crossing",blocks:"refine"}[goal?.kind];
  if (required && p.type !== required && !CARE_BUILDINGS.includes(p.type)) {
    removeWorkProject(w,p.id); w.community.lastProjectAt=w.time-decisionPace(w.settings).development;
    w.commandRevision++; w.navRevision++;
    activity(w,"project","We will work toward your new goal.","Your words","Gathered resources remain in storage.");
    return;
  }
  if (!p.crew.some((id)=>w.creatures.some((c)=>c.id===id)) || w.time-p.started>240) {
    removeWorkProject(w,p.id);
    w.community.lastProjectAt=w.time; w.commandRevision++; w.navRevision++;
    activity(w,"blocked","Our crew needs a new plan.","Instincts","Materials already gathered remain in storage. We will reconsider after caring for everyone.");
    return;
  }
  const crew = w.creatures.filter(c=>p.crew.includes(c.id) && projectAllowed(w,c));
  if (!crew.length || !resourceNeeded(w,p)) return;
  const task=projectTask(w,crew[0]);
  if (!projectTasks(w,crew[0]).some(t=>["gather","quarry"].includes(t))) return;
  const types = ["quarry","refine"].includes(p.type) || task==="quarry" ? ["rock","ore"] : ["tree","log"];
  const accessible = (o) => allowedRegion(w,o) && serviceSlots(w,o).some(s=>crew.some(c=>Number.isFinite(routeCost(w,c,s))));
  const saved = w.objects.filter(o=>types.includes(o.type) && Math.hypot(o.x-p.x,o.y-p.y)<=32 && accessible(o));
  const short=p.type==="refine" ? refiningShortage(w,p)
    : p.type==="quarry" ? p.target-w.inventory.ore
    : task==="quarry" ? Math.max(0,Math.ceil((projectRequirements(w,p).blocks-w.inventory.blocks)/10)-w.inventory.ore)
    : (p.type==="timber"?p.target:p.type==="crossing"?24:projectRequirements(w,p).wood)-w.inventory.wood;
  const sources=Math.min(12,p.crew.length,Math.max(1,Math.ceil(short/(types[0]==="rock"?3:6))));
  if (saved.length>=sources) return;
  const natural = nearbyObjects(w,p.x,p.y,32).filter(o=>types.includes(o.type) && o.id.startsWith("g:") && Math.hypot(o.x-p.x,o.y-p.y)<=32)
    .sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y));
  let count=saved.length;
  for(const o of natural.slice(0,24)) {
    if(count>=sources || w.objects.length>=LIMITS.objects-4) break;
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
  const care=careContext(w), reserve=timberReserve(w), storyGoal=colonyMilestone(w), industry=industryMilestone(w);
  const careFirst=choices.some(c=>CARE_BUILDINGS.includes(c.id) && c.priority>=80);
  const resourceLabel=c=>({
    crossing:`Build the bridge with ${c.target} wood; open land and mining`,
    timber:`Cut trees; store ${c.target} wood for future buildings`,
    quarry:`Break rocks; store ${c.target} ore for the goal`,
    refine:`Quarry and refine ${c.target} blocks; unlock workplaces`,
  }[c.id] || c.description);
  // Keep the effect of each building in its short option label. Optional site
  // descriptions can be omitted by the token budget; internal type names alone
  // do not tell a small classifier which need a building will actually serve.
  const options = Object.fromEntries([...choices.map(c=>[c.key||c.id,
    c.id==="clearance" ? `Clear ${c.obstacle || "obstacle"} to ${c.resume || "resume blocked work"}` : c.id==="cannon" ? "Build one sky launcher for the shared orbital home; send at most twelve volunteers and keep eight on the ground" : c.density ? `Build ${careServices(c.id).join("/") || BUILDINGS[c.id]?.name || c.id}; ${buildingCost(BUILDINGS[c.id])}; help ${Math.round(c.benefit)}; reward ${Math.round(c.density.reward)}`
      : `${resourceLabel(c)}; ${c.camps?.length||1} local crews`]),["wait",careFirst ? "Postpone building; no new care capacity" : "Postpone building; no progress on construction or resources"]]);
  for(const c of choices)if(c.outpost?.worthwhile)options[c.key||c.id]+=c.outpost.unserved
    ? `; support ${c.outpost.workers} remote residents` : `; saves ${Math.round(c.outpost.savedSeconds)} travel seconds`;
  const shortage=Object.entries(care).map(([k,s])=>`${k}: ${s.low} low, ${s.short} short, ${s.urgent} urgent`).join("; ");
  const milestone=!w.progress.bridge && choices.some(c=>c.id==="crossing") ? "Bridge unlocks land and mining." : w.stage>=2 && !w.objects.some(o=>o.type==="factory") ? "Blocks unlock workplaces." : "Grow useful workplaces and neighborhoods.";
  // Keep urgent-care inputs focused. Unrelated unlocks crowd out the immediate
  // capacity problem in the small model's bounded context.
  const priority=careFirst
    ? `Urgent care first; ${reserve.refill ? "replenish timber before optional expansion" : "gather missing building timber"}.`
    : `${milestone} Urgent care first; otherwise advance goals and unlock work. Gather missing timber.`;
  const orbital=orbitalPlan(w);
  const orbitalContext=orbital.phase==="build" && orbital.missionActive
    ? "The active orbital mission needs one sky launcher; keep eight residents on the ground."
    : orbital.phase==="building"
      ? "The sky launcher already has a building crew; do not start another."
      : "";
  const goalStep=storyGoal?.step || industry?.step || storyObjective(w)[1] || storyObjective(w)[0];
  const defaultGoal=goalStep.replace(/[. ]+$/,"").replace(/^./,letter=>letter.toLowerCase());
  const requiredContext = `${w.creatures.length} residents; ${workProjects(w).length}/${projectLimit(w)} crews active. Assign free local groups. ${shortage}. Wood ${reserve.stock} (refill below ${reserve.minimum}, target ${reserve.target}), ore ${Math.floor(w.inventory.ore)}, blocks ${Math.floor(w.inventory.blocks)}. Goal ${activeGoal(w)?.kind || defaultGoal}. ${accessBrief(w)} ${priority} ${orbitalContext} Prefer more help and reward closer to zero.`;
  const contextParts = choices.map(c=>c.description);
  return {options,requiredContext,contextParts,context:[requiredContext,...contextParts].join(" "),
    question:orbital.phase==="build" && orbital.missionActive
      ? "Which listed project and location best advance the goals? Build the one sky launcher for the active orbital mission while protecting urgent care and keeping eight residents on the ground."
      : "Which project and location best advance the goal?",maxTokens:320};
}
export function settlementContext(w,choices) {
  return {care:careContext(w), plan:developmentPlan(w), timber:timberReserve(w),
    orbitalPlan:orbitalPlan(w),
    densityRule:{target:DENSITY.target,above:DENSITY.above,below:DENSITY.below,units:"residents per 100 ground units; asymmetric squared penalty"},
    outposts:outpostContext(w),choices:choices.map(({key,id,x,y,camps,target,cost,priority,description,density,benefit,travel,outpost,subgoal,request,blocker})=>({key,id,at:[x,y],camps:camps?.map(p=>[Math.round(p.x),Math.round(p.y)]),target,cost,priority,description,density,benefit,travel,outpost,subgoal,request,blocker}))};
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
    const outpost=assessOutpost(w,choice.id,choice,choice.travel||0,{routed:true});
    if(choice.outpost?.worthwhile && !outpost?.worthwhile)return null;
    return {...choice,density,outpost};
  }
  if (!allowedRegion(w,choice) || workProjects(w).some(p=>p.type===choice.id &&
      (choice.id==="crossing" || Math.hypot(p.x-choice.x,p.y-choice.y)<18))) return null;
  return {...choice,target:current.target,camps:choice.camps?.filter(p=>allowedRegion(w,p) &&
    !workProjects(w).some(active=>active.type===choice.id && Math.hypot(active.x-p.x,active.y-p.y)<18))};
}
export function finishSettlement(w, placeBuilding) {
  return workProjects(w).map(p=>finishProject(w,p,placeBuilding)).filter(Boolean);
}
function finishProject(w,p,placeBuilding) {
  if (!p || !independent(w)) return;
  if (!isConstruction(p)) {
    if (resourceNeeded(w,p)) return;
    w.community.completed++;
    w.community.lastProjectAt=w.time-decisionPace(w.settings).development; removeWorkProject(w,p.id);
    w.commandRevision++; w.navRevision++;
    activity(w,"gathered",`${projectName(p)} finished.`,p.source,"Real materials gathered by the crew; ready for the next project.");
    return p.id;
  }
  if (p.progress < p.required) return;
  if (!projectFunded(w,p)) return;
  const error = placeBuilding(w,p.type,p.x,p.y);
  if (error) {
    if (p.blocked !== error) activity(w,"blocked",`${BUILDINGS[p.type].name} is waiting.`,"Instincts",error);
    p.blocked = error;
    const node = p.type === "mine" ? nearbyObjects(w,p.x,p.y,2).find(o=>o.type==="node") : null;
    if (!canPlace(w,p.type,p,node?.id,{ignoreCreatures:true})) {
      // A player edit supersedes this site. No wood has been charged.
      removeWorkProject(w,p.id); w.community.lastProjectAt = w.time;
      w.commandRevision++;
      w.navRevision++;
    }
    return;
  }
  w.community.completed++;
  w.community.lastProjectAt = w.time-decisionPace(w.settings).development;
  removeWorkProject(w,p.id);
  activity(w,"built",`${BUILDINGS[p.type].name} finished.`,p.source,`${buildingCost(BUILDINGS[p.type])} used. The whole colony can use it now.`);
  postMessage(w,completionLetter(w,p,BUILDINGS[p.type].name));
  return p.id;
}
