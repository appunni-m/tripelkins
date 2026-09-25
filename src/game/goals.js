// Bounded, persistent player objectives. Inference chooses a goal and schedule;
// completion is determined exclusively by the simulation's observed state.
import { JOB_RADIUS } from "./navigation.js";
import { westBank } from "./map.js";
import { developmentPlan } from "./development-plan.js";
import { workProjects } from "./work-projects.js";
export const GOAL_OPTIONS = {
  none: "Conversation or unsupported request",
  care: "Keep the colony healthy",
  grow: "Grow the population",
  bridge: "Finish the river bridge",
  wood: "Collect and store wood",
  ore: "Mine and stockpile ore",
  blocks: "Produce and store cut stone",
};
export const GOAL_KINDS = Object.keys(GOAL_OPTIONS).filter(
  (kind) => kind !== "none",
);
const closed = (g) => ["completed", "cancelled"].includes(g.status);
function latestClosed(goals) {
  return goals
    .filter((g) => g && closed(g))
    .sort(
      (a, b) =>
        (Number(a.completedAt) || Number(a.createdAt) || 0) -
        (Number(b.completedAt) || Number(b.createdAt) || 0),
    )
    .slice(-12);
}
function trimHistory(w) {
  const keep = new Set(latestClosed(w.memory.goals));
  w.memory.goals = w.memory.goals.filter((g) => !closed(g) || keep.has(g));
}
const bounded = (n, min, max, fallback = min) =>
  Number.isFinite(Number(n))
    ? Math.min(max, Math.max(min, Number(n)))
    : fallback;
export function activeGoal(w) {
  return w.memory.goals.find((g) => g.status === "active") || null;
}
export function goalTitle(g) {
  return {
    care: `Keep needs above ${g.target}%`,
    grow: `Grow to ${g.target.toLocaleString()} Tripelkins`,
    bridge: "Finish the river bridge",
    wood: `Store ${g.target.toLocaleString()} wood`,
    ore: `Stockpile ${g.target.toLocaleString()} ore`,
    blocks: `Save ${g.target.toLocaleString()} stone blocks`,
  }[g.kind];
}
export function goalTarget(w, kind, requested = 0) {
  if (kind === "bridge") return 24;
  const defaults = {
    care: 75,
    grow: Math.max(6, Math.ceil(w.population * 1.5)),
    wood: Math.max(48, Math.floor(w.inventory.wood) + 24),
    ore: Math.floor(w.inventory.ore) + 20,
    blocks: Math.floor(w.inventory.blocks) + 100,
  };
  return Math.round(
    bounded(
      Number(requested) > 0 ? requested : defaults[kind],
      kind === "care" ? 50 : 1,
      kind === "care" ? 95 : 1e6,
    ),
  );
}
export function numberFromCommand(text, kind) {
  // Laya selects the semantic goal; a bounded numeric slot is copied from the
  // player's words instead of pretending its classifier generates quantities.
  const numbers = {
    zero: 0,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
    twenty: 20,
    thirty: 30,
    forty: 40,
    fifty: 50,
    sixty: 60,
    seventy: 70,
    eighty: 80,
    ninety: 90,
  };
  const word = `(?:${Object.keys(numbers).join("|")}|hundred|thousand|million)`;
  text = text.replace(
    new RegExp(`\\b${word}(?:[\\s-]+(?:and\\s+)?${word})*\\b`, "gi"),
    (phrase) => {
      let total = 0,
        part = 0;
      for (const token of phrase.toLowerCase().split(/[\s-]+/)) {
        if (Object.hasOwn(numbers, token)) part += numbers[token];
        else if (token === "hundred") part = Math.max(1, part) * 100;
        else if (token === "thousand" || token === "million") {
          total += Math.max(1, part) * (token === "thousand" ? 1000 : 1000000);
          part = 0;
        }
      }
      return String(Math.min(1000000, total + part));
    },
  );
  const units = {
    care: "percent|%|needs|health",
    grow: "tripelkins?|creatures?|members?|population",
    wood: "wood|logs?",
    ore: "ore",
    blocks: "blocks?|cut stone",
  }[kind];
  if (!units) return 0;
  const match =
    text.match(
      new RegExp(
        `\\b(\\d[\\d,]{0,8})\\s*(?:healthy\\s+|happy\\s+)?(?:${units})`,
        "i",
      ),
    ) ||
    text.match(
      new RegExp(
        `(?:${units})\\s+(?:to\\s+|above\\s+|at\\s+)?(\\d[\\d,]{0,8})\\b`,
        "i",
      ),
    );
  const quantity =
    match ||
    (kind === "grow"
      ? text.match(/\bgrow(?:\s+the\s+colony)?\s+(?:to\s+)?(\d[\d,]{0,8})\b/i)
      : null);
  return quantity ? Number(quantity[1].replaceAll(",", "")) : 0;
}
export function inspectGoal(w, g) {
  const members = w.creatures;
  const needs = members.length
    ? Math.min(...members.map((c) => Math.min(c.fed, c.clean, c.amused)))
    : 0;
  const bridge = w.objects.find((o) => o.type === "bridge");
  const nearby = (o) =>
    members.some(
      (c) =>
        Math.hypot(c.x - o.x, c.y - o.y) <= JOB_RADIUS &&
        (w.progress.bridge || westBank(w, c) === westBank(w, o)),
    );
  const stock = (types) =>
    w.objects.some((o) => types.includes(o.type) && o.stock > 0 && nearby(o));
  const has = (types) =>
    w.objects.some((o) => types.includes(o.type) && nearby(o));
  const value =
    g.kind === "care"
      ? Math.round(needs)
      : g.kind === "grow"
        ? w.population
        : g.kind === "bridge"
          ? w.progress.bridge
            ? 24
            : bridge?.stock || 0
          : Math.floor(w.inventory[g.kind]);
  let blocker = "",
    step = "",
    policy = "balanced";
  const missingCare =
    !stock(["banana", "orchard"]) && !has(["dwelling"])
      ? "Drop bananas or provide a stocked banana tree."
      : !has(["bath", "dwelling"])
        ? "Wash creatures with the cloth or build a bathtub."
        : !has(["cricketball", "roundabout", "theatre"])
          ? "Place a cricket ball or a shared play facility."
          : "";
  const paths = {
    care: [
      "Provide food, washing and play",
      `Raise everyone’s needs above ${g.target}%`,
      "Maintain those needs as the colony changes",
    ],
    grow: [
      "Provide enough shared care",
      "Keep needs above 65% so creatures replicate",
      `Reach ${g.target.toLocaleString()} total creatures`,
    ],
    bridge: [
      "Chop trees or send stored wood from the bridge panel",
      "Assign carriers while meeting urgent needs",
      "Deliver 24 logs to finish the bridge",
    ],
    wood: [
      "Finish the bridge first",
      "Chop trees to supply loose logs",
      `Carry spare logs into a ${g.target} wood reserve`,
    ],
    ore: [
      "Finish the bridge to reach the ore deposits",
      "Place a mine on an ore node",
      `Prioritize miners until the reserve reaches ${g.target}`,
    ],
    blocks: [
      "Unlock industry and provide a mine",
      "Provide a factory and a supply of ore",
      `Make blocks until the reserve reaches ${g.target}`,
    ],
  };
  if (g.kind === "care" || g.kind === "grow") {
    policy = "care";
    step =
      g.kind === "care"
        ? value >= g.target
          ? "Maintain care as needs change."
          : "Raise food, cleanliness and play together."
        : "Keep everyone comfortable enough to replicate.";
    blocker = missingCare;
  } else if (g.kind === "bridge" || g.kind === "wood") {
    policy = "build";
    step = !w.progress.bridge
      ? "Carry loose logs to the bridge."
      : "Deliver spare logs into the wood reserve.";
    if (!stock(["log", "bone"]) && !members.some((c) => c.carry > 0))
      blocker =
        w.inventory.wood > 0 && !w.progress.bridge
          ? "Send stored wood from the bridge panel, or place it from the wood counter."
          : "Chop trees with the axe to supply loose logs for the carriers.";
  } else {
    policy = g.kind === "ore" ? "mine" : "industry";
    step =
      g.kind === "ore"
        ? "Stockpile ore; reserve it from factory use."
        : "Mine ore and turn it into blocks at factories.";
    if (!w.progress.bridge) {
      policy = "build";
      step = "Complete the bridge to reach industry.";
      blocker = stock(["log", "bone"])
        ? ""
        : "Chop trees to supply the bridge with logs.";
    } else if (w.stage < 2)
      blocker = "Finish the river crossing to unlock industry.";
    else if (!stock(["mine"]) && !(g.kind === "blocks" && w.inventory.ore > 0))
      blocker =
        "Place a mine on an ore node. Workers need a stocked, reachable mine.";
    else if (g.kind === "blocks" && !has(["factory"]))
      blocker = "Place a factory to turn mined ore into blocks.";
  }
  const independent = w.community.consent === "accepted" && w.settings.autonomy !== false && w.runtime?.intelligenceAvailable;
  if (independent && members.length && ["care","grow"].includes(g.kind)) {
    if (missingCare) step="Choose needed care facilities, gather timber and build near the residents who need them.";
    blocker=workProjects(w).find(p=>p.blocked)?.blocked || "";
    paths.grow=["Provide care for the next generation", "Scout new ground and build spaced care outposts",
      "Keep everyone comfortable and welcome new lives steadily"];
  }
  if (independent && members.length && ["wood","ore","bridge","blocks"].includes(g.kind)) {
    step = {wood:"Cut trees and collect timber for the requested reserve.",ore:"Quarry rocks and collect ore; reserve it from processing.",
      bridge:"Gather timber and carry stored wood to the crossing.",blocks:"Gather stone and work ore into blocks; keep existing factories supplied."}[g.kind];
    blocker = workProjects(w).find(p=>p.blocked)?.blocked || "";
    paths.wood = ["Choose a reachable stand of trees", "Cut timber and gather loose logs", `Store ${g.target} wood`];
    paths.ore = ["Choose reachable stone", "Quarry rocks and collect ore", `Reserve ${g.target} ore`];
    paths.blocks = ["Gather stone and ore", "Work ore into blocks by hand or at a supplied factory", `Store ${g.target} stone blocks`];
    paths.bridge = ["Cut trees or use stored wood", "Carry wood to the river while meeting needs", "Finish the crossing"];
  }
  if (!members.length)
    blocker = w.progress.hatched
      ? "There are no workers left. This goal remains in the saved story."
      : "Tap the spacecraft to meet the first worker.";
  else if (needs < 30) {
    policy = "care";
    step = "Meet urgent needs before returning to the objective.";
    blocker = independent ? blocker : missingCare || blocker;
  }
  if (
    !w.directives?.members?.length &&
    w.directives?.pauseWork &&
    !["care", "grow"].includes(g.kind)
  )
    blocker = "This project is on hold at your request. Care continues.";
  if (w.directives?.avoidPollution && g.kind === "blocks" && !independent)
    blocker =
      "Factory work is held to avoid pollution. You can still hammer loose ore yourself.";
  if (w.stage === 4) blocker = "This story has reached its ending.";
  const complete = g.kind !== "care" && value >= g.target;
  return {
    value,
    progress: Math.min(1, Math.max(0, value / g.target)),
    complete,
    blocker: complete ? "" : blocker,
    step: complete ? "Objective reached." : step,
    policy,
    milestones: paths[g.kind],
    subgoals: g.status === "active" ? developmentPlan(w).children : [],
  };
}
export function normalizeGoals(input) {
  if (!Array.isArray(input)) return [];
  const recentClosed = new Set(latestClosed(input));
  const ids = new Set();
  let active = false,
    live = 0,
    history = 0;
  return input
    .slice(-40)
    .filter((g) => {
      if (
        !g ||
        !GOAL_KINDS.includes(g.kind) ||
        typeof g.id !== "string" ||
        ids.has(g.id) ||
        !["active", "queued", "paused", "completed", "cancelled"].includes(
          g.status,
        )
      )
        return false;
      ids.add(g.id);
      return closed(g) ? recentClosed.has(g) && ++history <= 12 : ++live <= 8;
    })
    .map((g) => {
      let status = g.status;
      if (status === "active") {
        status = active ? "queued" : "active";
        active = true;
      }
      return {
        id: g.id.slice(0, 40),
        kind: g.kind,
        target:
          g.kind === "bridge"
            ? 24
            : Math.round(
                bounded(
                  g.target,
                  g.kind === "care" ? 50 : 1,
                  g.kind === "care" ? 95 : 1e6,
                ),
              ),
        command: String(g.command || "").slice(0, 500),
        source: String(g.source || "Saved objective").slice(0, 80),
        status,
        createdAt: bounded(g.createdAt, 0, 1e12),
        completedAt:
          g.completedAt == null ? null : bounded(g.completedAt, 0, 1e12),
        reviews: (Array.isArray(g.reviews) ? g.reviews : [])
          .slice(-8)
          .filter(
            (r) =>
              r &&
              ["care", "balanced", "expand", "build", "industry", "mine"].includes(
                r.policy,
              ),
          )
          .map((r) => ({
            tick: bounded(r.tick, 0, 1e12),
            policy: r.policy,
            reason: String(r.reason || "").slice(0, 240),
            source: String(r.source || "").slice(0, 80),
          })),
      };
    });
}
export function addGoal(w, spec, command, source) {
  if (!GOAL_KINDS.includes(spec.kind))
    throw new Error("The model returned an unsupported goal.");
  const target = goalTarget(w, spec.kind, spec.target);
  const existing = w.memory.goals.find(
    (g) => !closed(g) && g.kind === spec.kind && g.target === target,
  );
  if (existing) return existing;
  if (w.memory.goals.filter((g) => !closed(g)).length >= 8)
    throw new Error(
      "Eight goals are already saved. Complete or cancel one in Goals before adding another.",
    );
  const g = {
    id: `g${w.nextId++}`,
    kind: spec.kind,
    target,
    command: command.slice(0, 500),
    source: source.slice(0, 80),
    status: activeGoal(w) ? "queued" : "active",
    createdAt: w.time,
    completedAt: null,
    reviews: [],
  };
  w.memory.goals.push(g);
  trimHistory(w);
  w.revision++;
  w.commandRevision++;
  return g;
}
export function advanceGoals(w) {
  const finished = [];
  for (const g of w.memory.goals)
    if (["active", "queued"].includes(g.status) && inspectGoal(w, g).complete) {
      g.status = "completed";
      g.completedAt = w.time;
      finished.push(g);
      w.revision++;
    }
  if (!activeGoal(w)) {
    const next = w.memory.goals.find((g) => g.status === "queued");
    if (next) {
      next.status = "active";
      w.revision++;
    }
  }
  trimHistory(w);
  return finished;
}
export function changeGoal(w, id, action) {
  const g = w.memory.goals.find((g) => g.id === id);
  if (!g || closed(g)) return null;
  if (action === "pause") g.status = "paused";
  else if (action === "cancel") {
    g.status = "cancelled";
    g.completedAt = w.time;
  } else if (action === "focus") {
    const current = activeGoal(w);
    if (current && current.id !== id) current.status = "queued";
    g.status = "active";
  } else return null;
  if (!activeGoal(w)) {
    const next = w.memory.goals.find((g) => g.status === "queued");
    if (next) next.status = "active";
  }
  w.revision++;
  w.commandRevision++;
  trimHistory(w);
  return g;
}
export function goalPolicy(w) {
  const current = activeGoal(w);
  // A model's recovery suggestion expires when the urgent recovery is done.
  // Explicit player care goals below still retain their requested target.
  if (
    !current &&
    w.memory.lastPlan?.policy === "care" &&
    w.creatures.every((c) => Math.min(c.fed, c.clean, c.amused) >= 65)
  )
    return "balanced";
  if (!current)
    return w.memory.lastPlan?.goalId
      ? "balanced"
      : w.memory.lastPlan?.policy || "balanced";
  const state = inspectGoal(w, current);
  if (state.policy === "care") {
    if (current.kind === "grow" && w.creatures.every(c=>Math.min(c.fed,c.clean,c.amused)>=70))
      return "expand";
    return "care";
  }
  return w.memory.lastPlan?.goalId === current.id
    ? w.memory.lastPlan.policy
    : state.policy;
}
