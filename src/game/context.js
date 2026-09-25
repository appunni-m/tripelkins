import { careContext, careSummary } from "./care-context.js";
import { developmentPlan } from "./development-plan.js";
import { accessContext } from "./access.js";
import { isExplored, discoverySummary } from "./discovery.js";
import { capacity } from "./jobs.js";
import { projectName, projectStatus } from "./development.js";
import { bridgeProject } from "./bridge-project.js";
import { feasiblePlans, POLICIES } from "./decisions.js";
export { POLICIES };
import { goal } from "./catalog.js";
import { activeGoal, inspectGoal, goalTitle } from "./goals.js";
import { biome, CHUNK_SIZE, nearbyObjects, naturalObject } from "./map.js";
export function buildContext(w, { includePlans = true } = {}) {
  const started = performance.now();
  const care = careContext(w);
  const objective = activeGoal(w);
  const objectiveState = objective ? inspectGoal(w, objective) : null;
  const buckets = new Map();
  for (const c of w.creatures) {
    const key = `${Math.floor(c.x / CHUNK_SIZE)}:${Math.floor(c.y / CHUNK_SIZE)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(c);
  }
  const regions = [...buckets];
  // Keep every member represented without letting exploration grow prompts.
  if (regions.length > 8)
    regions.splice(7, regions.length - 7, [
      "other camps",
      regions.slice(7).flatMap(([, members]) => members),
    ]);
  const groups = regions.map(([id, members]) => ({
    id,
    members: members.map((c) => c.id),
    center: [
      Math.round(members.reduce((s, c) => s + c.x, 0) / members.length),
      Math.round(members.reduce((s, c) => s + c.y, 0) / members.length),
    ],
    needs: Object.fromEntries(
      ["fed", "clean", "amused"].map((n) => [
        n,
        {
          mean: Math.round(
            members.reduce((s, c) => s + c[n], 0) / members.length,
          ),
          min: Math.round(Math.min(...members.map((c) => c[n]))),
        },
      ]),
    ),
    urgent: members
      .filter((c) => Math.min(c.fed, c.clean, c.amused) < 30)
      .map((c) => c.id),
  }));
  const plans = includePlans ? feasiblePlans(w) : [];
  const counts = {};
  for (const o of w.objects.filter(o=>isExplored(w,o))) counts[o.type] = (counts[o.type] || 0) + 1;
  const observed = nearbyObjects(w, w.ui.x, w.ui.y, 24)
    .filter((o) => o.id.startsWith("g:") && isExplored(w,o))
    .slice(0, 48);
  const selectedNatural = naturalObject(w, w.ui.selected);
  if (selectedNatural && isExplored(w,selectedNatural) && !observed.some((o) => o.id === selectedNatural.id))
    observed.unshift(selectedNatural);
  const observedCounts = {};
  for (const o of observed)
    observedCounts[o.type] = (observedCounts[o.type] || 0) + 1;
  const context = {
    version: 4,
    developmentPlan: developmentPlan(w),
    blockedWork: accessContext(w),
    growthBudget: w.runtime?.growth ? { target:w.runtime.growth.target,
      held:w.runtime.growth.held, reason:w.runtime.growth.reason,
      metric:w.runtime.growth.source, renderDuty:w.runtime.growth.gpuDuty } : null,
    care,
    commandRevision: w.commandRevision,
    permissions: { ...w.directives },
    independence: { consent:w.community.consent, project:w.community.project, completed:w.community.completed, scouted:w.community.explored },
    projects: w.groups.map((g) => ({
      id: g.id,
      role: g.role,
      project: g.project,
      members: g.members.length,
    })),
    orbital: { ...w.orbital },
    district: { ...w.district },
    story: {
      completed: w.story.completed.slice(-4),
      promises: w.story.promises.slice(-3),
    },
    outcomes: w.decisions.slice(-3),
    tick: Math.floor(w.time),
    population: w.population,
    represented: w.creatures.length,
    cohort: w.cohort,
    stage: w.stage,
    goal: goal(w)[1],
    longTermGoal: objective
      ? { ...objective, title: goalTitle(objective), ...objectiveState }
      : null,
    goalQueue: w.memory.goals
      .filter((g) => g.status === "queued")
      .map((g) => ({
        id: g.id,
        kind: g.kind,
        target: g.target,
        command: g.command,
      })),
    bridge: w.progress.bridge,
    bridgeConstruction: bridgeProject(w),
    terrain: {
      generation: w.map.version,
      area: isExplored(w,w.ui) ? biome(w, w.ui.x, w.ui.y) : "unexplored",
      discovery: discoverySummary(w),
      region: [
        Math.floor(w.ui.x / CHUNK_SIZE),
        Math.floor(w.ui.y / CHUNK_SIZE),
      ],
      scope:
        "Fog clears around creatures, never the camera. Only explored objects are listed. Procedural world. Listed objects include saved colony objects and a bounded resource sample near the player's view. Object counts cover saved objects only. Jobs use nearby reachable facilities.",
      observedResources: observedCounts,
    },
    inventory: { ...w.inventory },
    pollution: Math.round(w.progress.pollution),
    groups,
    objects: [...w.objects, ...observed]
      .filter((o) => isExplored(w,o) && !["tree", "flowers", "stump"].includes(o.type))
      .map((o) => ({
        id: o.id,
        type: o.type,
        at: [Math.round(o.x * 10) / 10, Math.round(o.y * 10) / 10],
        stock: Math.floor(o.stock),
        deliveredOre: o.inputOre || 0,
        capacity: capacity(o),
        level: o.level,
        quality: o.quality || 1,
      })),
    objectCounts: counts,
    player: {
      tool: w.ui.tool,
      selected: w.ui.selected,
      viewport: [Math.round(w.ui.x), Math.round(w.ui.y), w.ui.zoom],
    },
    memory: {
      totals: { ...w.memory.totals },
      summary: w.memory.summary,
      commands: w.memory.commands
        .filter((command) => command.status !== "pending")
        .slice(-3)
        .map(({ text, status, reply, goalId }) => ({
          text,
          status,
          reply,
          goalId,
        })),
      choices: w.memory.choices.slice(-6),
      recent: w.memory.recent
        .slice(-6)
        .map((e) => ({ kind: e.kind, message: e.message })),
      previous: w.memory.lastPlan,
      conversations: w.memory.conversations.slice(-6),
      completedJobs: w.memory.jobs.slice(-16),
      jobTotals: { ...w.memory.activity },
    },
    candidates: plans.map((p) => ({
      id: p.id,
      description: POLICIES[p.id],
      expected: p.effects,
      groups: groups.map((g) => ({
        id: g.id,
        jobs: p.assignments.filter((a) => g.members.includes(a.id)),
      })),
    })),
  };
  const minimum = ["fed", "clean", "amused"].map((key) =>
    groups.length
      ? Math.min(...groups.map((group) => group.needs[key].min))
      : 0,
  );
  const localParts = [
    `Work ${w.directives.pauseWork ? "paused" : "allowed"}; factories ${w.directives.avoidPollution ? "held" : "allowed"}. Lowest food/clean/play ${minimum.join("/")}. Goal ${objective?.kind || "care and growth"}. Project ${w.community.project?.type || "none"}. ${context.blockedWork.length} blocked routes; clearance crews unblock work. Rotate rested workers; finish commitments. Care first. Space: ${context.developmentPlan.density.crowded} crowded neighborhoods; target 6 per 100 ground units. Crowding penalty 4, isolation 0.6.`,
    `Care capacity: ${careSummary(care)}.`,
    `Expansion: ${context.developmentPlan.expanding ? "scout new neighborhoods" : "balance space and care"}. Density target ${context.developmentPlan.density.target} per 100 ground units; crowding penalty 4, isolation penalty 0.6. Child goals: ${context.developmentPlan.children.filter(s=>s.status!=="satisfied").map(s=>s.kind).join(",")}.`,
    `Independent development ${w.community.consent}; ${w.community.project ? `${projectName(w.community.project)}: ${projectStatus(w)}` : "no current project"}. Scouted ${w.community.explored} areas.`,
    `Feasible options: ${plans
      .map(
        (p) =>
          `${p.id}: ${Object.entries(p.effects || {})
            .filter(([, n]) => n > 0)
            .map(([k, n]) => `${k} ${n.toFixed(1)}`)
            .join(",")}`,
      )
      .join("; ")}.`,
    `Lowest food/clean/play ${minimum.join("/")} (0 urgent,100 full). Population ${w.population}.`,
    objective
      ? `Goal ${objective.kind} ${objectiveState.value}/${objective.target}. Next ${objectiveState.policy}. ${objectiveState.blocker}`
      : "No active player goal.",
    `Food ${counts.banana || 0} bananas,${counts.orchard || 0} orchards; wash ${counts.bath || 0}; play ${(counts.cricketball || 0) + (counts.roundabout || 0) + (counts.theatre || 0)}; homes ${counts.dwelling || 0}.`,
    `Bridge ${w.progress.bridge ? "done" : `${context.bridgeConstruction?.delivered || 0}/${context.bridgeConstruction?.required || 24} delivered; ${context.bridgeConstruction?.staged || 0} materials waiting`}. Wood ${w.inventory.wood}; ore ${w.inventory.ore}; pollution ${Math.round(w.progress.pollution)}.`,
    ...groups
      .slice()
      .sort(
        (a, b) =>
          Math.min(...Object.values(a.needs).map((n) => n.min)) -
          Math.min(...Object.values(b.needs).map((n) => n.min)),
      )
      .map(
        (group) =>
          `${group.id}: ${group.members.length} creatures; needs ${group.needs.fed.min}/${group.needs.clean.min}/${group.needs.amused.min}.`,
      ),
    `Lifetime births ${w.memory.totals.birth || 0}, losses ${w.memory.totals.loss || 0}.`,
    `Near the player's view: ${context.terrain.area}; ${observedCounts.tree || 0} wild trees, ${observedCounts.node || 0} mineral nodes in the sampled area.`,
  ];
  // Key includes task availability and need buckets. Cached policy is re-expanded against current IDs.
  const key = JSON.stringify([
    w.stage,
    w.commandRevision,
    w.community.consent, w.community.project,
    w.community.access.map(r=>[r.id,r.status,r.blocker,r.crew]),
    care, w.discovery.revision,
    plans.map(p=>[p.id,p.assignments.reduce((a,j)=>{a[j.task]=(a[j.task]||0)+1;return a;},{})]),
    w.objects.map(o=>[o.id,Math.floor(o.stock||0),Math.floor(o.inputOre||0)]),
    w.progress.bridge,
    groups.map((g) => [
      g.id,
      g.members.length,
      ...Object.values(g.needs).map((n) => Math.floor(n.min / 10)),
    ]),
    counts,
    Math.floor(w.inventory.ore / 3),
    Math.floor(w.progress.pollution / 20),
    w.ui.tool,
    w.memory.choices,
    w.memory.lastPlan?.policy,
    w.memory.conversations.at(-1)?.text,
    objective
      ? [
          objective.id,
          objective.kind,
          objective.target,
          Math.floor(objectiveState.progress * 10),
          objectiveState.blocker,
          objectiveState.policy,
        ]
      : null,
  ]);
  return {
    context,
    maxTokens: 256,
    local: localParts.join(" "),
    localParts,
    plans,
    key,
    prepMs: performance.now() - started,
  };
}
