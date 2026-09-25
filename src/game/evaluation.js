// Reproducible development fixtures. Never load or write the player's world.
import { createWorld, addCreature, addObject, migrateWorld } from "./state.js";
import { feasiblePlans, bestPlan, selectPlan, judgePlan } from "./decisions.js";
import { applyPlan, stepWorld } from "./simulation.js";
import { bridgeGeometry } from "./geometry.js";
import { allowsTask } from "./jobs.js";
export const DECISION_CASES = [
  { id: "hungry-carriers", kind: "hunger" },
  { id: "other-bank-material", kind: "blocked" },
  { id: "two-baths", kind: "wash" },
  { id: "empty-factory", kind: "empty" },
  { id: "hold-project", kind: "stop" },
  { id: "last-log", kind: "cargo" },
  { id: "reachable-discovery", kind: "explore" },
  { id: "new-command", kind: "region" },
  {
    id: "holdout-hunger-11",
    kind: "hunger",
    count: 11,
    offset: 1.4,
    holdout: true,
  },
  { id: "holdout-wash-9", kind: "wash", count: 9, offset: -1.2, holdout: true },
  {
    id: "holdout-empty-7",
    kind: "empty",
    count: 7,
    offset: 0.8,
    holdout: true,
  },
  {
    id: "holdout-stop-10",
    kind: "stop",
    count: 10,
    offset: -0.7,
    holdout: true,
  },
];
export function decisionWorld(spec) {
  const w = createWorld({ empty: true });
  w.progress.hatched = true;
  w.stage = 2;
  const x = 24 + (spec.offset || 0);
  addObject(w, "orchard", x - 4, 22, { stock: 12 });
  addObject(w, "orchard", x + 5, 30, { stock: 12 });
  addObject(w, "bath", x, 20);
  addObject(w, "bath", x + 4, 22);
  addObject(w, "roundabout", x, 29);
  addObject(w, "mine", 32, 27, { stock: 200 });
  addObject(w, "factory", 32, 20, { inputOre: 0 });
  const b = addObject(w, "bridge", 42, 25);
  addObject(w, "log", 35, 26, { stock: 24 });
  addObject(w, "monolith", 30, 32);
  for (let i = 0; i < (spec.count || 6); i++) {
    const c = addCreature(w, x + (i % 3), 24 + Math.floor(i / 3));
    c.fed = c.clean = c.amused = 88;
  }
  if (spec.kind === "hunger")
    for (const c of w.creatures.slice(0, 3)) {
      c.fed = 15;
      c.carry = 3;
      c.cargoKind = "wood";
    }
  if (spec.kind === "blocked") {
    w.objects = w.objects.filter((o) => o.type !== "log");
    addObject(w, "log", 49, 24, { stock: 24 });
  }
  if (spec.kind === "wash") for (const c of w.creatures) c.clean = 20;
  if (spec.kind === "stop") w.directives.pauseWork = true;
  if (spec.kind === "cargo") {
    const c = w.creatures[0];
    c.carry = 3;
    c.cargoKind = "wood";
    applyPlan(
      w,
      feasiblePlans(w).find((p) => p.id === "build") ||
        bestPlan(w, feasiblePlans(w)),
    );
  }
  if (spec.kind === "region") {
    w.directives.region = { x: 50, y: 25 };
    b.bridge = bridgeGeometry(b);
    b.bridge.complete = true;
    w.progress.bridge = true;
    addObject(w, "mine", 49, 28, { stock: 200 });
  }
  if (spec.kind === "empty")
    w.objects = w.objects.filter((o) => o.type !== "mine");
  w.navRevision++;
  return w;
}
export function decisionOutcome(source, policy) {
  const w = migrateWorld(source);
  w.ui.paused = false;
  const selected = selectPlan(w, policy, "Evaluation");
  if (judgePlan(w, selected.plan).issues.length || !applyPlan(w, selected.plan))
    throw new Error("Decision fixture violated constraints.");
  w.memory.lastPlan = { policy: selected.policy, goalId: null };
  let unmet = 0;
  for (let i = 0; i < 300; i++) {
    stepWorld(w, 0.1);
    unmet +=
      w.creatures.filter((c) => Math.min(c.fed, c.clean, c.amused) < 20)
        .length * 0.1;
    w.metrics.violations += w.creatures.filter(
      (c) => !allowsTask(w, c.task, c),
    ).length;
  }
  const activity = w.memory.activity;
  return {
    policy: selected.policy,
    completed: w.metrics.completed,
    useful:
      (activity.haul || 0) +
      (activity.mine || 0) +
      (activity.work || 0) +
      (activity.explore || 0),
    unmetSeconds: Math.round(unmet),
    deaths: w.evidence.deaths,
    stalls: w.metrics.stalls,
    switches: w.metrics.switches,
    violations: w.metrics.violations,
  };
}
export function localReference(w) {
  return bestPlan(w, feasiblePlans(w)).id;
}
