import { careContext, careSummary } from "./care-context.js";
import { workProjects, projectLimit } from "./work-projects.js";
import { developmentPlan } from "./development-plan.js";
import { accessContext, accessBrief } from "./access.js";
import { COLONY_PREMISE } from "./prologue.js";
import { isExplored, discoverySummary } from "./discovery.js";
import { capacity } from "./jobs.js";
import { projectName, projectStatus, timberReserve, colonyMilestone, industryMilestone } from "./development.js";
import { bridgeProject } from "./bridge-project.js";
import { feasiblePlans, POLICIES, planReward } from "./decisions.js";
import { USEFUL_TASKS } from "./work-balance.js";
export { POLICIES };
import { goal } from "./catalog.js";
import { activeGoal, inspectGoal, goalTitle } from "./goals.js";
import { biome, CHUNK_SIZE, nearbyObjects, naturalObject } from "./map.js";
import { orbitalPlan } from "./orbit-rules.js";
export function buildContext(w, { includePlans = true } = {}) {
  const started = performance.now();
  const care = careContext(w);
  const objective = activeGoal(w);
  const objectiveState = objective ? inspectGoal(w, objective) : null;
  const defaultGoal = goal(w);
  const currentMilestone = colonyMilestone(w)||industryMilestone(w);
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
  const orbital = orbitalPlan(w);
  const workload = {tasks:{},states:{},available:0,useful:0};
  workload.projectWorkers=workProjects(w).reduce((n,p)=>n+p.crew.length,0);
  workload.crews=workProjects(w).length;
  for (const c of w.creatures) {
    workload.tasks[c.task]=(workload.tasks[c.task]||0)+1;
    const state=c.job?.state||"none";workload.states[state]=(workload.states[state]||0)+1;
    if (["idle","rest","social"].includes(c.task) && Math.min(c.fed,c.clean,c.amused)>=68 && c.sickness<50) workload.available++;
    if (USEFUL_TASKS.has(c.task)) workload.useful++;
  }
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
    workload,
    currentMilestone,
    currentStoryObjective: (objective || currentMilestone) ? null : {title:defaultGoal[0],step:defaultGoal[1]},
    developmentPlan: developmentPlan(w),
    timber: timberReserve(w),
    blockedWork: accessContext(w),
    growthBudget: w.runtime?.growth ? { target:w.runtime.growth.target,
      held:w.runtime.growth.held, reason:w.runtime.growth.reason,
      metric:w.runtime.growth.source, renderDuty:w.runtime.growth.gpuDuty } : null,
    care,
    commandRevision: w.commandRevision,
    permissions: { ...w.directives },
    independence: { consent:w.community.consent, project:w.community.project,
      crews:workProjects(w).map(p=>({id:p.id,type:p.type,at:[Math.round(p.x),Math.round(p.y)],members:p.crew.length,target:p.target,blocked:p.blocked})),
      crewCapacity:projectLimit(w),completed:w.community.completed, scouted:w.community.explored },
    projects: w.groups.map((g) => ({
      id: g.id,
      role: g.role,
      project: g.project,
      members: g.members.length,
    })),
    orbital: { ...w.orbital },
    orbitalPlan: orbital,
    district: { ...w.district },
    story: {
      premise: COLONY_PREMISE,
      completed: w.story.completed.slice(-4),
      promises: w.story.promises.slice(-3),
    },
    outcomes: w.decisions.slice(-3),
    tick: Math.floor(w.time),
    population: w.population,
    represented: w.creatures.length,
    cohort: w.cohort,
    stage: w.stage,
    goal: defaultGoal[1],
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
      allocation: p.assignments.reduce((counts,a)=>{counts[a.task]=(counts[a.task]||0)+1;return counts;},{}),
      expected: p.effects,
      reward: planReward(w,p),
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
  const taskCounts = (plan) => plan.assignments.reduce((counts, assignment) => {
    counts[assignment.task] = (counts[assignment.task] || 0) + 1;
    return counts;
  }, {});
  const taskMix = (plan) => {
    const counts = taskCounts(plan);
    return Object.fromEntries([
      "haul", "gather", "construct", "quarry", "refine", "mine", "work", "explore",
      "clean", "eat", "wash", "play", "home", "orbit", "rest", "social", "idle",
    ].filter((task) => counts[task]).map((task) => [
      task === "explore" ? "scouts" : task,
      counts[task],
    ]));
  };
  const goalLabel = objective
    ? `player ${objective.kind} goal ${objectiveState.value}/${objective.target}; next ${objectiveState.step}. ${objectiveState.blocker}`
    : context.currentMilestone
      ? `${context.currentMilestone.title}: ${context.currentMilestone.step}`
      : context.currentStoryObjective?.step || defaultGoal[0].toLowerCase();
  const candidateMix = plans.map((plan) =>
    `${plan.id} [${Object.entries(taskMix(plan)).map(([task, count]) => `${count} ${task}`).join(", ")}]`,
  ).join("; ");
  const localParts = [
    `Work ${w.directives.pauseWork ? "paused" : "allowed"}; factories ${w.directives.avoidPollution ? "held" : "allowed"}. Lowest food/clean/play ${minimum.join("/")}. Goal ${goalLabel}. Bridge ${w.progress.bridge ? "done" : `${context.bridgeConstruction?.delivered || 0}/${context.bridgeConstruction?.required || 24} delivered, ${context.bridgeConstruction?.staged || 0} staged`}; wood ${w.inventory.wood}. Candidate task mix: ${candidateMix}. ${workload.available}/${w.creatures.length} healthy residents available. Protect urgent care; otherwise put available residents to useful work or scouting. ${accessBrief(w)}`,
    orbital.phase === "locked" ? "The orbital home is locked until second contact." :
      orbital.phase === "building" ? "Our sky launcher is being built; finish that crew's work before assigning volunteers." :
      orbital.phase === "build" ? orbital.missionActive
        ? "Active orbital mission: build one sky launcher, then send up to twelve healthy volunteers while keeping eight residents on the ground."
        : "A sky launcher is unlocked; hold its mission until independence is active and any resource goal is complete." :
      orbital.phase === "launch" || orbital.phase === "waiting"
        ? `Orbital home ${orbital.launches}/${orbital.target} journeys; ${orbital.missionActive ? "the independent mission is active" : orbital.phase === "waiting" ? "waiting until at least nine residents can stay on the ground" : "waiting for independence or completion of the active resource goal"}. Send healthy non-favorites only; keep eight on the ground.`
        : `The orbital home has its ${orbital.target} journeys. Do not send more residents.`,
    ...plans.map(p=>`${p.id} planning score ${planReward(w,p).total.toFixed(2)}; density cost ${p.effects.space.toFixed(2)}, travel cost ${p.effects.travel.toFixed(2)}. Higher is better; estimates, not learned rewards.`),
    `Care capacity: ${careSummary(care)}.`,
    `Expansion: ${context.developmentPlan.expanding ? "scout new neighborhoods" : "balance space and care"}. Density target ${context.developmentPlan.density.target} per 100 ground units; crowding penalty 4, isolation penalty 0.6. Child goals: ${context.developmentPlan.children.filter(s=>s.status!=="satisfied").map(s=>s.kind).join(",")}.`,
    `Independent development ${w.community.consent}; ${workload.crews} local crews, ${workload.projectWorkers} assigned workers. ${workProjects(w).slice(0,3).map(p=>`${projectName(p)}: ${projectStatus(w,p)}`).join("; ")}. Scouted ${w.community.explored} areas.`,
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
    orbital,
    w.community.consent, workProjects(w),
    workload, w.memory.activity,
    w.community.access.map(r=>[r.id,r.status,r.blocker,r.crew]),
    care, w.discovery.revision, context.timber, Math.floor(w.inventory.blocks),
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
    context.currentMilestone
      ? [context.currentMilestone.id, context.currentMilestone.kind, context.currentMilestone.target, context.currentMilestone.step]
      : null,
    context.currentStoryObjective
      ? [context.currentStoryObjective.title, context.currentStoryObjective.step]
      : null,
  ]);
  return {
    context,
    maxTokens: 320,
    question:orbital.missionActive && orbital.phase === "launch"
      ? "Which crew allocation sends eligible volunteers to the orbital home, protects urgent care, and keeps eight residents on the ground?"
      : "Which crew allocation best advances the stated goal while protecting urgent care and using available healthy residents for useful work?",
    options: Object.fromEntries(plans.map((plan) => [
      plan.id,
      Object.entries(taskMix(plan)).map(([task, count]) => `${count} ${task}`).join(", ") || "no assignments",
    ])),
    local: localParts.join(" "),
    localParts,
    plans,
    key,
    prepMs: performance.now() - started,
  };
}
