import { careContext } from "./care-context.js";
import { workProjects } from "./work-projects.js";
import { outpostContext } from "./outposts.js";
import { densitySummary } from "./density.js";
import { discoverySummary } from "./discovery.js";
import { BUILDINGS, goal as storyGoal } from "./catalog.js";
import { timberReserve, colonyMilestone, industryMilestone, RESOURCE_PROJECTS,
  nextIndustryBuilding, uncommittedBlocks, projectFunded } from "./development.js";
import { orbitalPlan } from "./orbit-rules.js";

const sentenceCase = value => value.toLowerCase().replace(/^./,letter=>letter.toUpperCase());

// Bounded child goals derived from authoritative state. Keep the current
// story/player destination visible and put its material prerequisites first.
export function developmentPlan(w) {
  const goal = w.memory.goals.find(g=>g.status === "active"),
    care = careContext(w), milestone = colonyMilestone(w)||industryMilestone(w),
    density = densitySummary(w), n = w.creatures.length, projects = workProjects(w);
  const growing = !milestone && (!goal || ["grow","care"].includes(goal.kind));
  const children = Object.entries(care).map(([kind,s])=>({
    id:`care-${kind}`, kind:{food:"orchard",wash:"bath",play:"roundabout"}[kind],
    title:{food:"Grow enough food",wash:"Provide enough washing places",play:"Make room for shared play"}[kind],
    remaining:Math.max(s.short,s.urgent,growing?s.growthShort:0),
    status:s.urgent || s.low>n/4 ? "urgent" : s.short || (growing && s.growthShort) ? "needed" : "satisfied",
  }));
  const expanding = n>20 && growing && (density.crowded>0 ||
    discoverySummary(w).area < n / density.target * 100 * 2);
  const orbital = orbitalPlan(w), story = storyGoal(w);
  for(const camp of outpostContext(w).slice(0,2))children.push({id:`outpost:${camp.kind}:${camp.at.join(":")}`,
    kind:{food:"orchard",wash:"bath",play:"roundabout"}[camp.kind],status:"needed",remaining:camp.residents,
    title:`Support ${camp.residents} residents at ${camp.at.join(", ")}: ${camp.unserved?"no reachable service":`${camp.roundTripSeconds}s care round trip`}`});
  children.push({id:"space",kind:"explore",title:"Scout space for the next neighborhood",
    remaining:density.crowded,status:expanding?"needed":"satisfied"});
  if (orbital.missionActive) children.push({
    id: orbital.launcherBuilt ? "orbital-volunteers" : "orbital-launcher",
    kind: orbital.launcherBuilt ? "orbit" : "cannon",
    title: orbital.launcherBuilt
      ? `Send ${orbital.remaining} volunteers to the shared home in orbit`
      : orbital.launcherInProgress
        ? "Finish the sky launcher for the shared orbital home"
        : "Build a sky launcher for the shared orbital home",
    remaining: orbital.launcherBuilt ? orbital.remaining : 1,
    status: orbital.launcherInProgress ? "working" : "needed",
  });
  if (milestone) children.push({id:milestone.id,kind:milestone.project,title:milestone.step,
    remaining:milestone.remaining,status:"needed"});

  if (goal) {
    const value = goal.kind === "care"
      ? (n ? Math.round(Math.min(...w.creatures.map(c=>Math.min(c.fed,c.clean,c.amused)))) : 0)
      : goal.kind === "grow" ? w.population
        : goal.kind === "bridge" ? (w.progress.bridge ? 24 : w.objects.find(o=>o.type==="bridge")?.stock||0)
          : Math.floor(w.inventory[goal.kind]);
    const title = {
      care:`Keep every need above ${goal.target}%`,
      grow:`Reach ${goal.target.toLocaleString()} Tripelkins`,
      bridge:"Finish the river crossing",
      wood:`Store ${goal.target.toLocaleString()} wood`,
      ore:`Store ${goal.target.toLocaleString()} ore`,
      blocks:`Store ${goal.target.toLocaleString()} stone blocks`,
    }[goal.kind];
    children.push({id:`goal-${goal.kind}`,kind:goal.kind,title,remaining:Math.max(0,goal.target-value),
      status:goal.kind==="care"?"working":value>=goal.target?"satisfied":"needed"});
  } else if (!milestone && !orbital.missionActive) {
    const finished = w.stage===4 || (w.progress.hatched && !w.population);
    const remaining = w.stage===3 ? Math.max(0,w.progress.finalRequired-w.progress.uplinks) : finished ? 0 : 1;
    children.push({id:"story-current",kind:"story",title:story[1],remaining,
      status:finished?"satisfied":"needed"});
  }

  // Industry has a real construction chain: a mine needs blocks, and a
  // workshop needs a stocked mine. Show the missing input before the build.
  if (milestone?.id==="story-industry" && !projects.some(p=>BUILDINGS[p.type])) {
    const type=nextIndustryBuilding(w), spec=BUILDINGS[type];
    if (spec) {
      const blocks=Math.max(0,spec.cost-uncommittedBlocks(w));
      const woodNeeded=projects.reduce((sum,p)=>sum+(BUILDINGS[p.type]?.wood||0),0)+spec.wood;
      const wood=Math.max(0,woodNeeded-w.inventory.wood);
      if (blocks) children.push({id:"prerequisite:blocks",kind:"refine",
        title:`Make ${blocks} blocks before building the ${spec.name.toLowerCase()}`,
        remaining:blocks,status:"needed"});
      if (wood) children.push({id:"prerequisite:wood",kind:"timber",
        title:`Gather ${wood} wood before building the ${spec.name.toLowerCase()}`,
        remaining:wood,status:"needed"});
      if (!blocks && !wood) children.push({id:"next-industry-building",kind:type,
        title:`Build the ${spec.name.toLowerCase()}`,remaining:1,status:"needed"});
    }
  }

  // A building crew can gather its own inputs, but show that first stage as a
  // concrete prerequisite instead of implying the building is already underway.
  const buildingProjects=projects.filter(p=>BUILDINGS[p.type]);
  const requiredWood=buildingProjects.reduce((sum,p)=>sum+(BUILDINGS[p.type].wood||0),0);
  const requiredBlocks=buildingProjects.reduce((sum,p)=>sum+(BUILDINGS[p.type].cost||0),0);
  const firstBuilding=buildingProjects[0];
  if (firstBuilding) {
    const missingWood=Math.max(0,requiredWood-w.inventory.wood);
    const missingBlocks=Math.max(0,requiredBlocks-w.inventory.blocks);
    if (missingWood) children.push({id:"materials:wood",kind:"timber",
      title:`Gather ${missingWood} wood before finishing the ${BUILDINGS[firstBuilding.type].name.toLowerCase()}`,
      remaining:missingWood,status:"needed"});
    if (missingBlocks) children.push({id:"materials:blocks",kind:"refine",
      title:`Make ${missingBlocks} blocks before finishing the ${BUILDINGS[firstBuilding.type].name.toLowerCase()}`,
      remaining:missingBlocks,status:"needed"});
  }

  const timber = timberReserve(w);
  if (!buildingProjects.length && !projects.length && timber.refill && w.community.consent==="accepted")
    children.push({id:"timber-buffer",kind:"timber",title:`Keep ${timber.target} wood ready for building`,
      remaining:timber.short,status:"needed"});
  for (const r of w.community.access.slice(0,2)) children.push({id:`access:${r.id}`,kind:"clearance",
    title:`Open a path to the ${r.label}`,remaining:1,status:r.status==="clearing"?"working":"blocked"});
  for (const project of projects) children.push({ id:`project${project===projects[0]?"":`:${project.id}`}`, kind:project.type,
    title:`Finish ${project.type} at ${Math.round(project.x)}, ${Math.round(project.y)}`,
    status:project.blocked?"blocked":BUILDINGS[project.type] && !projectFunded(w,project) ? "waiting":"working",
    remaining:Math.max(0,RESOURCE_PROJECTS[project.type]
      ? project.target-(project.type==="crossing" ? (w.progress.bridge?24:w.objects.find(o=>o.type==="bridge")?.stock||0) : w.inventory[RESOURCE_PROJECTS[project.type].material])
      : project.required-project.progress) });

  const goalTitles=goal?{grow:`Grow to ${goal.target.toLocaleString()} Tripelkins`,care:"Keep everyone comfortable",
    wood:`Store ${goal.target.toLocaleString()} wood`,ore:`Store ${goal.target.toLocaleString()} ore`,
    blocks:`Save ${goal.target.toLocaleString()} blocks`,bridge:"Finish the river crossing"}:{};
  const title=goal?goalTitles[goal.kind]:milestone?.title || (orbital.missionActive
    ? children.find(c=>c.id.startsWith("orbital-"))?.title || sentenceCase(story[0])
    : sentenceCase(story[0]));
  const focusId=goal?`goal-${goal.kind}`:milestone?.id || (orbital.missionActive
    ? children.find(c=>c.id.startsWith("orbital-"))?.id : "story-current");
  const focus=children.find(c=>c.id===focusId);
  const rank=c=>c.id.startsWith("access:")?0:c.id.startsWith("materials:")||c.id.startsWith("prerequisite:")?1
    :c.id==="next-industry-building"?2:c.id.startsWith("project")?2:c.status==="urgent"?3
      :c.id.startsWith("care-")?4:c.id.startsWith("outpost:")?5:c.id==="space"?6:7;
  const pending=children.filter(c=>c!==focus && c.status!=="satisfied")
    .map((c,index)=>({c,index})).sort((a,b)=>rank(a.c)-rank(b.c)||a.index-b.index).map(({c})=>c);
  const ordered=[...pending.slice(0,focus?6:7)];
  if (focus) ordered.push(focus);
  if (ordered.length<7) ordered.push(...children.filter(c=>c.status==="satisfied" && c!==focus).slice(0,7-ordered.length));
  return { parent:goal?.id||milestone?.id||(orbital.missionActive?"orbital-home":"colony"), title,
    expanding, density, children:ordered };
}

export function updateDevelopmentPlan(w) {
  const plan = developmentPlan(w);
  if (JSON.stringify(w.community.plan)!==JSON.stringify(plan)) {
    w.community.plan = plan;
    w.revision++;
  }
  return plan;
}
