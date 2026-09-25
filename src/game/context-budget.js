export const utf8Size = (value) =>
  new TextEncoder().encode(
    typeof value === "string" ? value : JSON.stringify(value),
  ).length;
// Hosted models choose a policy. Exact per-member assignments stay in the game.
export function packHostedContext(full, budget) {
  const minimum = Object.fromEntries(
    ["fed", "clean", "amused"].map((key) => [
      key,
      full.groups.length
        ? Math.min(...full.groups.map((group) => group.needs[key].min))
        : null,
    ]),
  );
  const g = full.longTermGoal;
  const concisePlan = p => p ? {parent:p.parent,expanding:p.expanding,
    children:p.children.map(({kind,status,remaining})=>({kind,status,remaining})),
    density:{target:p.density.target,crowded:p.density.crowded,abovePenalty:p.density.abovePenalty,belowPenalty:p.density.belowPenalty}} : undefined;
  const packed = {
    version: 4,
    care: full.care,
    developmentPlan: concisePlan(full.developmentPlan),
    growthBudget: full.growthBudget,
    ...(full.blockedWork?.length ? {blockedWork:{count:full.blockedWork.length,
      requests:full.blockedWork.slice(0,3).map(({id,target,at,status})=>({id,target,at,status}))}} : {}),
    ...(full.development ? {development:{densityRule:full.development.densityRule,
      choices:full.development.choices.map(({key,id,at,target,cost,priority,density,benefit,travel,subgoal,request,blocker,description})=>({
        key,id,at,target,cost,priority,density:density?{residents:Math.round(density.residents*10)/10,reward:Math.round(density.reward*10)/10}:undefined,
        benefit:benefit===undefined?undefined:Math.round(benefit),travel:travel===undefined?undefined:Math.round(travel),subgoal,
        ...(id==="clearance"?{request,blocker,description:description.slice(0,160)}:{}),
      }))}} : {}),
    tick: full.tick,
    population: full.population,
    represented: full.represented,
    stage: full.stage,
    inventory: full.inventory,
    bridge: full.bridge,
    bridgeConstruction: full.bridgeConstruction,
    pollution: full.pollution,
    lowestNeeds: minimum,
    longTermGoal: g
      ? {
          kind: g.kind,
          target: g.target,
          value: g.value,
          policy: g.policy,
          blocker: g.blocker,
        }
      : null,
    policies: full.candidates.map((c) => c.id),
    permissions: full.permissions,
    independence: full.independence,
    commandRevision: full.commandRevision,
    coverage:
      "Current state is authoritative. Individual schedules execute locally. History and object details are bounded samples, not a complete transcript.",
  };
  if (utf8Size(packed) > budget)
    throw new Error(
      "This connection has too little context space for the colony's essential state.",
    );
  const omitted = [];
  const add = (key, value) => {
    if (utf8Size({ ...packed, [key]: value }) <= budget) packed[key] = value;
    else omitted.push(key);
  };
  const addHistory = (key, entries) => {
    let selected = entries.slice();
    while (selected.length && utf8Size({ ...packed, [key]: selected }) > budget)
      selected.shift();
    if (selected.length) packed[key] = selected;
    if (selected.length < entries.length) omitted.push(key);
  };
  add(
    "candidateEffects",
    full.candidates.map((c) => ({ id: c.id, effects: c.expected })),
  );
  add("promises", full.story?.promises || []);
  add("projects", full.projects || []);
  add("outcomes", full.outcomes || []);
  add("orbital", full.orbital);
  add("district", full.district);
  add("facilities", full.objectCounts);
  add("player", full.player);
  add("terrain", full.terrain);
  add(
    "groups",
    full.groups.map((group) => ({
      id: group.id,
      count: group.members.length,
      center: group.center,
      needs: group.needs,
      urgent: group.urgent.length,
    })),
  );
  addHistory("recentCommands", full.memory.commands);
  add("lastingChoices", full.memory.choices);
  add("lifetimeTotals", full.memory.totals);
  addHistory("milestones", full.memory.summary.milestones.slice(-4));
  add(
    "goalQueue",
    full.goalQueue.map(({ kind, target }) => ({ kind, target })),
  );
  addHistory("recentEvents", full.memory.recent);
  add(
    "candidateWork",
    full.candidates.map((candidate) => ({
      id: candidate.id,
      description: candidate.description,
      groups: candidate.groups.map((group) => ({
        id: group.id,
        tasks: group.jobs.reduce((counts, job) => {
          counts[job.task] = (counts[job.task] || 0) + 1;
          return counts;
        }, {}),
      })),
    })),
  );
  // Lowest-stock resources and the selected object are useful examples, not the whole map.
  const objects = full.objects
    .slice()
    .sort((a, b) =>
      a.id === full.player.selected
        ? -1
        : b.id === full.player.selected
          ? 1
          : a.stock - b.stock,
    )
    .slice(0, 12);
  add("objectSample", objects);
  addHistory("recentConversation", full.memory.conversations.slice(-2));
  return { context: packed, bytes: utf8Size(packed), budget, omitted };
}
