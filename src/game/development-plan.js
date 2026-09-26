import { careContext } from "./care-context.js";
import { workProjects } from "./work-projects.js";
import { outpostContext } from "./outposts.js";
import { densitySummary } from "./density.js";
import { discoverySummary } from "./discovery.js";
import { BUILDINGS } from "./catalog.js";
import { timberReserve, colonyMilestone, industryMilestone, RESOURCE_PROJECTS } from "./development.js";
import { orbitalPlan } from "./orbit-rules.js";

// Bounded child goals derived from authoritative state. The model chooses a
// feasible project/site to satisfy them; completion comes from the simulation.
export function developmentPlan(w) {
  const goal = w.memory.goals.find(g=>g.status === "active"), care = careContext(w), milestone=colonyMilestone(w)||industryMilestone(w);
  const density = densitySummary(w), n = w.creatures.length;
  const growing = !milestone && (!goal || ["grow","care"].includes(goal.kind));
  const children = Object.entries(care).map(([kind,s])=>({
    id:`care-${kind}`, kind:{food:"orchard",wash:"bath",play:"roundabout"}[kind],
    title:{food:"Grow enough food",wash:"Provide enough washing places",play:"Make room for shared play"}[kind],
    remaining:Math.max(s.short,s.urgent,growing?s.growthShort:0),
    status:s.urgent || s.low>n/4 ? "urgent" : s.short || (growing && s.growthShort) ? "needed" : "satisfied",
  }));
  const expanding = n>20 && growing && (density.crowded>0 ||
    discoverySummary(w).area < n / density.target * 100 * 2);
  const orbital = orbitalPlan(w);
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
  if (goal && ["wood","ore","blocks","bridge"].includes(goal.kind)) {
    const value = goal.kind==="bridge" ? (w.progress.bridge?24:w.objects.find(o=>o.type==="bridge")?.stock||0) : w.inventory[goal.kind];
    children.push({id:`goal-${goal.kind}`,kind:{wood:"timber",ore:"quarry",blocks:"refine",bridge:"crossing"}[goal.kind],
      title:goal.kind==="bridge"?"Finish the crossing":`Store ${goal.target} ${goal.kind}`,
      remaining:Math.max(0,goal.target-value),status:value>=goal.target?"satisfied":"needed"});
  }
  const projects=workProjects(w), project=projects[0];
  const timber = timberReserve(w);
  if (!project && timber.refill && w.community.consent==="accepted") children.push({id:"timber-buffer",kind:"timber",
    title:`Keep ${timber.target} wood ready for building`,remaining:timber.short,status:"needed"});
  if (projects.some(p=>BUILDINGS[p.type])) {
    const wood=Math.max(0,projects.reduce((n,p)=>n+(BUILDINGS[p.type]?.wood||0),0)-w.inventory.wood);
    children.push({id:"materials",kind:"timber",title:"Gather materials for our building",
      remaining:wood,status:wood?"needed":"satisfied"});
  }
  for (const r of w.community.access.slice(0,2)) children.push({id:`access:${r.id}`,kind:"clearance",
    title:`Open a path to the ${r.label}`,remaining:1,status:r.status==="clearing"?"working":"blocked"});
  for (const project of projects) children.push({ id:`project${project===projects[0]?"":`:${project.id}`}`, kind:project.type,
    title:`Finish ${project.type} at ${Math.round(project.x)}, ${Math.round(project.y)}`,
    status:project.blocked?"blocked":"working", remaining:Math.max(0,RESOURCE_PROJECTS[project.type]
      ? project.target-(project.type==="crossing" ? (w.progress.bridge?24:w.objects.find(o=>o.type==="bridge")?.stock||0) : w.inventory[RESOURCE_PROJECTS[project.type].material])
      : project.required-project.progress) });
  const title=goal ? ({grow:`Grow to ${goal.target.toLocaleString()} Tripelkins`,care:"Keep everyone comfortable",
    wood:`Store ${goal.target} wood`,ore:`Store ${goal.target} ore`,blocks:`Save ${goal.target} blocks`,bridge:"Finish the river crossing"}[goal.kind]) : milestone?.title || "Grow a healthy, spacious colony";
  return { parent:goal?.id||milestone?.id||(orbital.missionActive?"orbital-home":"colony"), title:orbital.missionActive?children.find(c=>c.id.startsWith("orbital-"))?.title||title:title,
    expanding, density, children:children.filter(c=>c.status!=="satisfied").concat(children.filter(c=>c.status==="satisfied")).slice(0,7) };
}
export function updateDevelopmentPlan(w) {
  const plan = developmentPlan(w);
  if (JSON.stringify(w.community.plan)!==JSON.stringify(plan)) {
    w.community.plan = plan;
    w.revision++;
  }
  return plan;
}
