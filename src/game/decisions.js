import { makePlan, minimum, allowsTask } from "./jobs.js";
import { activeGoal } from "./goals.js";
import { withRouteCosts } from "./navigation.js";
import { densityAt, densityReward, densitySummary } from "./density.js";
export const POLICIES = {
  care: "Recover needs",
  balanced: "Share care and useful work",
  expand: "Scout new ground and spread the settlement",
  build: "Deliver bridge materials",
  industry: "Supply ore and produce blocks",
  mine: "Reserve mined ore",
};
const careTasks = ["eat", "wash", "play", "home"];
const assignmentKey = (plan) => plan.assignments
  .map((a) => `${a.id}:${a.task}:${a.target}:${a.slot}:${a.point.x.toFixed(2)}:${a.point.y.toFixed(2)}`)
  .sort().join("|");
export function judgePlan(w, p) {
  const effects = {
      care: 0,
      material: 0,
      production: 0,
      discovery: 0,
      commitment: 0,
      maintenance: 0,
      space: 0,
    },
    issues = [];
  for (const a of p.assignments) {
    const c = w.creatures.find((c) => c.id === a.id);
    if (!c) {
      issues.push("Missing creature");
      continue;
    }
    if (!allowsTask(w, a.task, c)) issues.push("Instruction restriction");
    if (
      minimum(c) < 35 &&
      !careTasks.includes(a.task) &&
      !["idle", "rest"].includes(a.task)
    )
      issues.push("Urgent care displaced");
    const travel = Math.hypot(c.x - a.point.x, c.y - a.point.y) / 1.65,
      cycle = travel + 4;
    if (careTasks.includes(a.task))
      effects.care += (100 - minimum(c)) / Math.max(4, cycle);
    if (["haul","gather","quarry","construct"].includes(a.task)) effects.material += 3 / Math.max(4, cycle);
    if (["mine", "work", "refine", "orbit"].includes(a.task))
      effects.production += (a.task === "work" ? 3 : 1) / Math.max(4, cycle);
    if (a.task === "explore") effects.discovery += 1 / Math.max(4, cycle);
    if (a.task === "clean") effects.maintenance += 20 / Math.max(5, cycle);
    if (a.keep) effects.commitment++;
    effects.space += densityReward(densityAt(w,a.point).residents) / Math.max(1,p.assignments.length);
  }
  return { effects, issues };
}
export function feasiblePlans(w) {
  return withRouteCosts(w, () => buildFeasiblePlans(w));
}
function buildFeasiblePlans(w) {
  const distinct = new Map();
  for (const policy of Object.keys(POLICIES)) {
    const p = makePlan(w, policy),
      review = judgePlan(w, p);
    if (review.issues.length) continue;
    // A tiny spacing advantage must not advertise production when the actual
    // assignments contain no productive work. Keep specialized labels honest;
    // ordinary care, exploration and balanced plans still cover idle periods.
    const requiredTasks = {
      industry: ["work", "mine", "refine", "orbit"],
      mine: ["mine", "quarry"],
      build: ["haul", "gather", "construct"],
    }[policy];
    if (requiredTasks && !p.assignments.some(a => requiredTasks.includes(a.task))) continue;
    const key = assignmentKey(p);
    if (!distinct.has(key)) distinct.set(key, { ...p, ...review });
  }
  const all = [...distinct.values()];
  const nondominated = all.filter(
    (p) =>
      !all.some(
        (q) =>
          q !== p &&
          Object.keys(p.effects).every((k) => q.effects[k] >= p.effects[k]) &&
          Object.keys(p.effects).some(
            (k) => q.effects[k] > p.effects[k] + 0.01,
          ),
      ),
  );
  return (nondominated.length ? nondominated : all).slice(0, 5);
}
export function bestPlan(w, plans) {
  const goal = activeGoal(w)?.kind, crowded = densitySummary(w).crowded;
  return (
    [...plans].sort((a, b) => score(b) - score(a))[0] || makePlan(w, "care")
  );
  function score(p) {
    const e = p.effects || judgePlan(w, p).effects;
    return (
      e.care * 8 +
      e.commitment * 0.15 +
      e.material * (["wood", "bridge"].includes(goal) ? 6 : 2) +
      e.production * (["ore", "blocks"].includes(goal) ? 6 : 2) +
      e.discovery * (crowded || goal === "grow" ? 8 : 3) + (e.space || 0)
      + (e.maintenance || 0) * 2
    );
  }
}
export function selectPlan(w, policy, source, model = "", initial = null) {
  const plans = initial || feasiblePlans(w);
  let selected = plans.find((p) => p.id === policy);
  if (!selected && Object.hasOwn(POLICIES, policy)) {
    // A live commitment can make two policy labels expand into the same work.
    // Deduplication must not turn an equivalent valid model choice into a fallback.
    const expanded = makePlan(w,policy), review = judgePlan(w,expanded);
    if (!review.issues.length && plans.some((p) => assignmentKey(p) === assignmentKey(expanded)))
      selected = {...expanded,...review};
  }
  const fallback = bestPlan(w, plans),
    plan = selected || fallback;
  const effects = plan.effects || judgePlan(w, plan).effects,
    counts = {};
  for (const a of plan.assignments) counts[a.task] = (counts[a.task] || 0) + 1;
  const record = {
    tick: w.time,
    goal: activeGoal(w)?.kind || "colony",
    source: selected ? source : "Local fallback",
    model,
    candidate: plan.id,
    facts: `${w.creatures.filter((c) => minimum(c) < 35).length} urgent; ${w.inventory.ore} ore; work ${w.directives.pauseWork ? "held" : "allowed"}.`,
    expected: Object.entries(counts)
      .map(([t, n]) => `${n} ${t}`)
      .join(", "),
    observed: "",
    rejection: selected ? "" : "Returned choice was unavailable or dominated.",
    baseline: w.metrics.completed,
    completed: 0,
  };
  w.decisions.push(record);
  w.decisions = w.decisions.slice(-32);
  w.metrics.decisions++;
  return {
    plan,
    policy: plan.id,
    source: record.source,
    model,
    note: record.expected,
    effects,
  };
}
