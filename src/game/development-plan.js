import { careContext } from "./care-context.js";
import { densitySummary } from "./density.js";
import { discoverySummary } from "./discovery.js";
import { BUILDINGS } from "./catalog.js";
import { timberReserve, colonyMilestone, RESOURCE_PROJECTS } from "./development.js";

// Bounded child goals derived from authoritative state. The model chooses a
// feasible project/site to satisfy them; completion comes from the simulation.
export function developmentPlan(w) {
  const goal = w.memory.goals.find(g=>g.status === "active"), care = careContext(w), milestone=colonyMilestone(w);
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
  children.push({id:"space",kind:"explore",title:"Scout space for the next neighborhood",
    remaining:density.crowded,status:expanding?"needed":"satisfied"});
  if (milestone) children.push({id:milestone.id,kind:milestone.project,title:milestone.step,
    remaining:milestone.remaining,status:"needed"});
  if (goal && ["wood","ore","blocks","bridge"].includes(goal.kind)) {
    const value = goal.kind==="bridge" ? (w.progress.bridge?24:w.objects.find(o=>o.type==="bridge")?.stock||0) : w.inventory[goal.kind];
    children.push({id:`goal-${goal.kind}`,kind:{wood:"timber",ore:"quarry",blocks:"refine",bridge:"crossing"}[goal.kind],
      title:goal.kind==="bridge"?"Finish the crossing":`Store ${goal.target} ${goal.kind}`,
      remaining:Math.max(0,goal.target-value),status:value>=goal.target?"satisfied":"needed"});
  }
  const project = w.community.project;
  const timber = timberReserve(w);
  if (!project && timber.refill && w.community.consent==="accepted") children.push({id:"timber-buffer",kind:"timber",
    title:`Keep ${timber.target} wood ready for building`,remaining:timber.short,status:"needed"});
  if (project && BUILDINGS[project.type]) {
    const wood=Math.max(0,(BUILDINGS[project.type].wood||0)-w.inventory.wood);
    children.push({id:"materials",kind:"timber",title:"Gather materials for our building",
      remaining:wood,status:wood?"needed":"satisfied"});
  }
  for (const r of w.community.access.slice(0,2)) children.push({id:`access:${r.id}`,kind:"clearance",
    title:`Open a path to the ${r.label}`,remaining:1,status:r.status==="clearing"?"working":"blocked"});
  if (project) children.push({ id:"project", kind:project.type,
    title:`Finish ${project.type} at ${Math.round(project.x)}, ${Math.round(project.y)}`,
    status:project.blocked?"blocked":"working", remaining:Math.max(0,RESOURCE_PROJECTS[project.type]
      ? project.target-(project.type==="crossing" ? (w.progress.bridge?24:w.objects.find(o=>o.type==="bridge")?.stock||0) : w.inventory[RESOURCE_PROJECTS[project.type].material])
      : project.required-project.progress) });
  const title=goal ? ({grow:`Grow to ${goal.target.toLocaleString()} Tripelkins`,care:"Keep everyone comfortable",
    wood:`Store ${goal.target} wood`,ore:`Store ${goal.target} ore`,blocks:`Save ${goal.target} blocks`,bridge:"Finish the river crossing"}[goal.kind]) : milestone?.title || "Grow a healthy, spacious colony";
  return { parent:goal?.id||milestone?.id||"colony", title,
    expanding, density, children:children.slice(0,7) };
}
export function updateDevelopmentPlan(w) {
  const plan = developmentPlan(w);
  if (JSON.stringify(w.community.plan)!==JSON.stringify(plan)) {
    w.community.plan = plan;
    w.revision++;
  }
  return plan;
}
