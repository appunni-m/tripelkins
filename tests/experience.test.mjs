import test from "node:test";
import assert from "node:assert/strict";
import { LIMITS } from "../src/game/catalog.js";
import {
  createWorld,
  addCreature,
  addObject,
  migrateWorld,
  remember,
} from "../src/game/state.js";
import {
  interact,
  stepWorld,
  makePlan,
  applyPlan,
  choose,
} from "../src/game/simulation.js";
import {
  project,
  unproject,
  clearPosition,
  sweptMove,
  bridgeGeometry,
  serviceSlots,
  canPlace,
  BODY_RADIUS,
} from "../src/game/geometry.js";
import { dictionaryName, renameCreature } from "../src/game/identity.js";
import { feasiblePlans, selectPlan, judgePlan } from "../src/game/decisions.js";
import { parseConstraints, commitConstraints } from "../src/game/commands.js";
import { die, deliver } from "../src/game/resources.js";
import { stepCohorts, syncPopulation, launch } from "../src/game/population.js";
import {
  BEATS,
  INCIDENTS,
  PHILOSOPHY,
  ARCHIVES,
  SOCIAL,
} from "../src/game/story-content.js";
import {
  appendTimeline,
  latestWorld,
  readMoment,
  historySize,
} from "../src/game/timeline.js";
import { askJev, decisionsURL, JEV_MODEL } from "../src/providers/jev.js";
import { buildContext } from "../src/game/context.js";
import { packHostedContext } from "../src/game/context-budget.js";
const colony = () => {
  const w = createWorld({ empty: true });
  w.progress.hatched = true;
  return w;
};
const step = (w, seconds) => {
  for (let i = 0; i < seconds * 10; i++) stepWorld(w, 0.1);
};
function care(w, x = 24) {
  addObject(w, "orchard", x - 4, 22, { stock: 12 });
  addObject(w, "bath", x, 20);
  addObject(w, "bath", x + 4, 22);
  addObject(w, "roundabout", x, 28);
}

test("projection round trips at map edges and subpixel coordinates", () => {
  for (const [x, y] of [
    [0, 0],
    [24, 24],
    [39.2, 25.4],
    [-99999999, 98765432],
  ]) {
    const q = project(x, y),
      p = unproject(q.x, q.y);
    assert.ok(Math.abs(x - p.x) < 1e-7 && Math.abs(y - p.y) < 1e-7);
  }
});
test("16,384 unique names and birth identity survives deaths, rename and migration", () => {
  assert.equal(
    new Set(Array.from({ length: 16384 }, (_, i) => dictionaryName(i))).size,
    16384,
  );
  const w = colony(),
    a = addCreature(w, 24, 24),
    b = addCreature(w, 26, 24);
  const ordinal = b.birthOrdinal;
  assert.equal(
    renameCreature(w, a, b.name).error,
    "Someone here already has that name.",
  );
  assert.ok(!renameCreature(w, a, "<Pip & Sky>").error);
  die(w, [b], "hammer", addObject, remember);
  const c = addCreature(w, 26, 24);
  assert.ok(c.birthOrdinal > ordinal);
  const m = migrateWorld(w);
  assert.equal(m.creatures[0].name, "<Pip & Sky>");
  assert.equal(m.creatures[0].id, a.id);
  assert.equal(m.population, w.population);
  assert.equal(m.creatures[0].fed, a.fed);
});
test("legacy migration preserves names and starving health, pauses; no offline decay", () => {
  const w = colony(),
    c = addCreature(w, 24, 24);
  w.schema = 3;
  c.name = "Old Pip";
  c.fed = 0;
  c.deadTime = 25;
  const m = migrateWorld(w);
  assert.equal(m.creatures[0].name, "Old Pip");
  assert.equal(m.creatures[0].deadTime, 25);
  assert.equal(m.creatures[0].fed, 0);
  assert.equal(m.ui.paused, true);
  step(m, 30);
  assert.equal(m.creatures.length, 1);
});
test("swept collision prevents high-speed rock tunnelling and water walking", () => {
  const w = colony(),
    c = addCreature(w, 23, 24);
  addObject(w, "rock", 25, 24);
  sweptMove(w, c, 8, 0);
  assert.ok(c.x < 24.2);
  const d = addCreature(w, 39, 30);
  sweptMove(w, d, 12, 0);
  assert.ok(d.x < 40);
  assert.equal(canPlace(w, "bath", { x: 42, y: 25 }), false);
});
test("both bridge materials conserve stock, completed bridges make legal surfaces", () => {
  for (const kind of ["wood", "bones"]) {
    const w = colony(),
      c = addCreature(w, 38, 25),
      b = addObject(w, "bridge", 42.5, 25);
    for (let i = 0; i < 8; i++) {
      c.carry = 3;
      c.cargoKind = kind;
      deliver(w, c, b, remember);
    }
    assert.equal(b.stock, 24);
    assert.equal(bridgeGeometry(b).delivered[kind], 24);
    assert.equal(w.progress.bridge, true);
    assert.ok(clearPosition(w, { x: 42, y: 25 }));
    assert.equal(canPlace(w, "bath", { x: 42, y: 25 }), false);
    assert.equal(c.carry, 0);
  }
});
test("service reservations distribute demand and progress survives replanning", () => {
  const w = colony();
  care(w);
  for (let i = 0; i < 8; i++) {
    const c = addCreature(w, 22 + (i % 4), 24 + Math.floor(i / 4));
    c.clean = 20;
    c.fed = 85;
    c.amused = 85;
  }
  const p = makePlan(w, "care"),
    washing = p.assignments.filter((a) => a.task === "wash");
  assert.equal(washing.length, 2);
  assert.equal(new Set(washing.map((a) => a.target)).size, 2);
  assert.equal(applyPlan(w, p), true);
  const c = w.creatures.find((c) => c.task === "wash");
  c.work = 0.5;
  const original = c.job;
  applyPlan(w, makePlan(w, "industry"));
  assert.equal(c.job, original);
  assert.equal(c.work, 0.5);
});
test("hauling finishes without marching onto incomplete bridge or losing bones", () => {
  const w = colony();
  care(w, 33);
  addObject(w, "bridge", 42.5, 25);
  addObject(w, "bone", 36, 25, { stock: 24 });
  for (let i = 0; i < 4; i++) {
    const c = addCreature(w, 33 + i, 24);
    c.fed = c.clean = c.amused = 90;
  }
  step(w, 90);
  assert.equal(
    w.progress.bridge,
    true,
    JSON.stringify({
      bridge: w.objects.find((o) => o.type === "bridge"),
      creatures: w.creatures.map((c) => ({
        name: c.name,
        x: c.x,
        y: c.y,
        task: c.task,
        job: c.job,
        carry: c.carry,
      })),
      metrics: w.metrics,
    }),
  );
  assert.equal(w.evidence.bonesDelivered, 24);
  assert.equal(w.evidence.deaths, 0);
});
test("full object capacity preserves deaths, remains and carried resources", () => {
  const w = colony(),
    c = addCreature(w, 24, 24);
  c.carry = 3;
  c.cargoKind = "bones";
  for (let i = 0; i < LIMITS.objects; i++) addObject(w, "flowers", i, 100);
  die(w, [c], "hammer", addObject, remember);
  assert.equal(w.inventory.bones, 3);
  assert.equal(w.inventory.corpses, 1);
  assert.equal(w.population, 0);
  assert.equal(w.objects.length, LIMITS.objects);
  assert.equal(w.evidence.hammer, 1);
});
test("negation, named scope, pollution and care constraints survive", () => {
  const w = colony(),
    c = addCreature(w, 24, 24);
  renameCreature(w, c, "Pip");
  const stop = parseConstraints(w, "Pip, do not build yet", null);
  assert.equal(stop.negated, true);
  commitConstraints(w, stop);
  assert.equal(w.directives.pauseWork, true);
  assert.deepEqual(w.directives.members, [c.id]);
  assert.ok(
    makePlan(w, "build").assignments.every(
      (a) => !["haul", "mine", "work", "orbit"].includes(a.task),
    ),
  );
  const resumed = parseConstraints(
    w,
    "everyone resume work and avoid pollution",
    null,
  );
  commitConstraints(w, resumed);
  assert.equal(w.directives.pauseWork, false);
  assert.equal(w.directives.avoidPollution, true);
  assert.equal(migrateWorld(w).directives.avoidPollution, true);
});
test("feasible choices never manufacture ore or override urgent care", () => {
  const w = colony();
  care(w);
  addObject(w, "factory", 30, 24);
  for (let i = 0; i < 4; i++) {
    const c = addCreature(w, 22 + i, 24);
    c.fed = 10;
    c.clean = c.amused = 80;
  }
  const plans = feasiblePlans(w);
  assert.ok(plans.length);
  for (const p of plans) {
    assert.deepEqual(judgePlan(w, p).issues, []);
    assert.ok(p.assignments.every((a) => a.task !== "work"));
  }
  const result = selectPlan(w, "invented", "Jev");
  assert.equal(result.source, "Local fallback");
  assert.equal(w.decisions.length, 1);
});
test("sky launcher conserves people and time alone never grows the orbital colony", () => {
  const w = colony();
  w.stage = 2;
  for (let i = 0; i < 12; i++)
    addCreature(w, 20 + (i % 6), 24 + Math.floor(i / 6));
  const c = w.creatures[0],
    total = w.population;
  assert.equal(launch(w, c, remember), true);
  assert.equal(w.population, total);
  assert.equal(w.orbital.population, 1);
  assert.ok(!w.creatures.some((x) => x.id === c.id));
  for (let i = 0; i < 6500; i++) stepCohorts(w, 0.1);
  assert.equal(w.orbital.population, 1);
  assert.equal(w.population, total);
  assert.ok(Number.isSafeInteger(w.population));
  assert.equal(
    w.population,
    w.creatures.length + w.cohort + w.orbital.population,
  );
});
test("nuke is a gated world transaction with exact survivor accounting", () => {
  const w = colony();
  for (let i = 0; i < 8; i++) addCreature(w, 22 + i, 24);
  addObject(w, "factory", 30, 30);
  choose(w, "nuke", "yes");
  assert.equal(w.stage, 1);
  w.progress.cannon = true;
  w.orbital.population = 12;
  w.orbital.launches = 12;
  syncPopulation(w);
  const total = w.population;
  choose(w, "nuke", "yes");
  assert.equal(w.stage, 3);
  assert.equal(w.objects.length, 1);
  assert.equal(w.objects[0].type, "hole");
  assert.equal(w.creatures.length, 3);
  assert.equal(w.evidence.deaths, total - 3);
  assert.equal(migrateWorld(w).progress.finalRequired, 3);
});
test("snapshot + compacted timeline restores complete identity, jobs and constraints", () => {
  let w = colony();
  addCreature(w, 24, 24);
  let history = appendTimeline(null, null, migrateWorld(w));
  for (let i = 0; i < 135; i++) {
    const before = migrateWorld(w);
    w.time++;
    w.creatures[0].fed -= 0.1;
    w.directives.avoidPollution = i % 2 === 0;
    renameCreature(w, w.creatures[0], `Pip ${i}`);
    history = appendTimeline(history, before, migrateWorld(w));
  }
  assert.equal(history.branches[0].frames.length, 120);
  assert.ok(history.branches[0].compacted > 0);
  assert.deepEqual(latestWorld(history.branches[0]), migrateWorld(w));
  const restored = readMoment(
    history.branches[0],
    history.branches[0].frames[3].id,
  );
  history = appendTimeline(history, migrateWorld(w), restored, {
    origin: "test",
  });
  assert.equal(history.branches.length, 2);
  assert.ok(historySize(history) < 8 * 1024 * 1024);
});
test("content budget has unique IDs and bounded model projection", () => {
  assert.deepEqual(
    [
      BEATS.length,
      INCIDENTS.length,
      PHILOSOPHY.length,
      ARCHIVES.length,
      SOCIAL.length,
    ],
    [24, 18, 12, 6, 8],
  );
  assert.equal(
    new Set([...BEATS, ...INCIDENTS, ...PHILOSOPHY].map((b) => b.id)).size,
    54,
  );
  const w = colony();
  addCreature(w, 24, 24);
  w.orbital.population = 1e12;
  syncPopulation(w);
  const ctx = buildContext(w);
  const packed = packHostedContext(ctx.context, 16000);
  assert.ok(
    new TextEncoder().encode(JSON.stringify(packed.context)).length <= 16000,
  );
  assert.equal(ctx.context.represented, 1);
});
test("Jev uses typed decisions, latest alias and validates response choice", async () => {
  assert.equal(decisionsURL(), "https://openrouter.ai/api/alpha/decisions");
  const settings = { url: "https://openrouter.ai/api/v1", model: JEV_MODEL };
  let body;
  const result = await askJev({
    settings,
    token: "test-only",
    state: { ore: 0 },
    options: { care: "Care", mine: "Mine" },
    fetcher: async (url, init) => {
      assert.equal(url, decisionsURL());
      body = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({
          model: "typesafe/jev-test",
          answers: { decision: { type: "choice", choice: "care" } },
          usage: { input_tokens: 32, cost: 0 },
        }),
      };
    },
  });
  assert.equal(body.model, JEV_MODEL);
  assert.equal(body.questions.decision.type, "choice");
  assert.equal(result.policy, "care");
  await assert.rejects(
    askJev({
      settings,
      token: "test",
      state: {},
      options: { a: "A", b: "B" },
      fetcher: async () => ({
        ok: true,
        json: async () => ({
          answers: { decision: { type: "choice", choice: "destroy" } },
        }),
      }),
    }),
  );
});

test("two-way bridge traffic and restoring a crossing keep feet on a legal surface", async () => {
  const { waypoint } = await import("../src/game/navigation.js");
  const { separateBodies } = await import("../src/game/geometry.js");
  let w = colony();
  const bridge = addObject(w, "bridge", 42.5, 25);
  bridge.bridge = bridgeGeometry(bridge);
  bridge.bridge.complete = true;
  bridge.stock = 24;
  w.progress.bridge = true;
  w.navRevision++;
  const destinations = new Map();
  for (let i = 0; i < 8; i++) {
    const c = addCreature(w, i < 4 ? 37 : 48, 24 + (i % 4) * 0.7);
    destinations.set(c.id, { x: i < 4 ? 48 : 37, y: 24 + (i % 4) * 0.7 });
  }
  let worst = 1;
  for (let step = 0; step < 500; step++) {
    for (const c of w.creatures) {
      const target = destinations.get(c.id),
        p = waypoint(w, c, target);
      if (p) {
        const d = Math.hypot(p.x - c.x, p.y - c.y);
        if (d > 0.05)
          sweptMove(
            w,
            c,
            ((p.x - c.x) / d) * Math.min(0.165, d),
            ((p.y - c.y) / d) * Math.min(0.165, d),
          );
      }
      assert.ok(clearPosition(w, c), `illegal surface at ${c.x},${c.y}`);
    }
    separateBodies(w);
    if (step === 60) w = migrateWorld(w);
    for (const c of w.creatures)
      for (const o of w.creatures)
        if (c.id !== o.id)
          worst = Math.min(worst, Math.hypot(c.x - o.x, c.y - o.y));
  }
  assert.ok(
    w.creatures.every(
      (c) =>
        Math.hypot(
          c.x - destinations.get(c.id).x,
          c.y - destinations.get(c.id).y,
        ) < 1,
    ),
    JSON.stringify(
      w.creatures.map((c) => ({
        id: c.id,
        x: c.x,
        y: c.y,
        to: destinations.get(c.id),
      })),
    ),
  );
  assert.ok(worst > 0.35, `separation fell to ${worst}`);
});

test("food and destinations on the bridge do not bounce walkers back to the bank", async () => {
  const { waypoint } = await import("../src/game/navigation.js");
  const w = colony(),
    bridge = addObject(w, "bridge", 42, 25);
  bridge.bridge = bridgeGeometry(bridge);
  bridge.bridge.complete = true;
  w.progress.bridge = true;
  w.navRevision++;
  const c = addCreature(w, 38.8, 24.7),
    target = { x: 40.25, y: 24.6 };
  for (let i = 0; i < 80; i++) {
    const p = waypoint(w, c, target);
    assert.ok(p);
    const d = Math.hypot(p.x - c.x, p.y - c.y);
    if (d > 0.01)
      sweptMove(
        w,
        c,
        ((p.x - c.x) / d) * Math.min(d, 0.165),
        ((p.y - c.y) / d) * Math.min(d, 0.165),
      );
  }
  assert.ok(Math.hypot(c.x - target.x, c.y - target.y) < 0.1);
});

test("idle workers notice new accessible jobs instead of keeping an empty commitment", () => {
  const w = colony(),
    c = addCreature(w, 24, 24);
  c.task = "idle";
  c.job = {
    state: "working",
    point: { x: 24, y: 24 },
    slot: 0,
    started: 0,
    lastProgress: 0,
    expected: 20,
  };
  c.fed = 40;
  addObject(w, "banana", 25, 24, { stock: 1 });
  const p = makePlan(w);
  assert.equal(p.assignments[0].task, "eat");
});

test("ore moves through carrier, local factory stock, blocks and energy without duplication", () => {
  const w = colony();
  w.stage = 2;
  const mine = addObject(w, "mine", 27, 24, { stock: 300 }),
    factory = addObject(w, "factory", 31, 24);
  for (let i = 0; i < 8; i++) {
    const c = addCreature(w, 23 + (i % 4), 27 + Math.floor(i / 4));
    c.fed = c.clean = c.amused = 95;
  }
  step(w, 60);
  assert.ok(w.inventory.blocks > 0);
  assert.ok(w.memory.activity.haul > 0);
  assert.ok(w.memory.activity.work > 0);
  const physical =
    w.creatures.reduce((n, c) => n + (c.cargoKind === "ore" ? c.carry : 0), 0) +
    w.objects.filter((o) => o.type === "ore").reduce((n, o) => n + o.stock, 0);
  assert.equal(
    300 - mine.stock,
    w.inventory.ore + physical + (factory.inputOre || 0) + w.inventory.blocks / 8,
  );
  assert.equal(w.progress.energy, w.inventory.blocks * 1024);
  assert.equal(w.evidence.deaths, 0);
});
test("construction cannot seal bridge approaches", () => {
  const w = colony();
  addObject(w, "bridge", 42, 25);
  assert.equal(canPlace(w, "dwelling", { x: 46.7, y: 24.6 }), false);
  assert.equal(canPlace(w, "factory", { x: 37, y: 25 }), false);
  assert.equal(canPlace(w, "factory", { x: 32, y: 20 }), true);
});
test("ending and refusal preserve their branch and cannot duplicate uplinks", async () => {
  const { connectSurvivor } = await import("../src/game/simulation.js");
  const w = colony();
  for (let i = 0; i < 9; i++) addCreature(w, 22 + i, 24);
  w.progress.cannon = true;
  w.orbital.population = 12;
  w.orbital.launches = 12;
  syncPopulation(w);
  const before = w.population;
  choose(w, "nuke", "no");
  assert.equal(w.population, before);
  assert.equal(w.stage, 1);
  choose(w, "nuke", "yes");
  const ids = w.creatures.map((c) => c.id);
  for (const id of ids) assert.equal(connectSurvivor(w, id), true);
  assert.equal(connectSurvivor(w, ids[0]), false);
  assert.equal(w.stage, 4);
  assert.equal(w.progress.uplinks, 3);
  assert.equal(w.population, 0);
});
test("extended snapshot normalization is idempotent and preserves in-flight work", () => {
  const w = colony(),
    c = addCreature(w, 24, 24);
  addObject(w, "bridge", 42, 25);
  c.carry = 3;
  c.cargoKind = "bones";
  applyPlan(w, makePlan(w, "build"));
  c.work = 0.7;
  c.sickness = 21;
  w.story.responses = [
    { id: "thought-care", response: "We can choose together", tick: 0 },
  ];
  const restored = migrateWorld(w);
  assert.deepEqual(migrateWorld(restored), restored);
  assert.equal(restored.creatures[0].carry, 3);
  assert.equal(restored.creatures[0].work, 0.7);
  assert.equal(restored.creatures[0].sickness, 21);
  assert.deepEqual(restored.story.responses, w.story.responses);
});
test("all feasible policies satisfy fixed and holdout decision scenarios", async () => {
  const { DECISION_CASES, decisionWorld, decisionOutcome } = await import(
    "../src/game/evaluation.js"
  );
  for (const spec of DECISION_CASES) {
    const w = decisionWorld(spec);
    for (const p of feasiblePlans(w)) {
      assert.equal(
        applyPlan(structuredClone(w), p),
        true,
        `${spec.id}/${p.id}`,
      );
      const outcome = decisionOutcome(w, p.id);
      assert.equal(outcome.deaths, 0, `${spec.id}/${p.id}`);
      assert.equal(outcome.violations, 0);
    }
  }
});

test("supplied sculpture consumes only delivered wood and survives restore", async () => {
  const { supplyProject, projectState } = await import(
    "../src/game/projects.js"
  );
  const { noteEvidence } = await import("../src/game/story.js");
  const w = colony(),
    c = addCreature(w, 24, 24),
    o = addObject(w, "sculpture", 28, 24);
  for (let i = 0; i < 4; i++) {
    c.carry = 3;
    c.cargoKind = "wood";
    assert.equal(supplyProject(w, c, o, remember, noteEvidence), true);
  }
  assert.equal(projectState(o).complete, true);
  assert.equal(c.carry, 0);
  assert.equal(migrateWorld(w).objects.find((x) => x.id === o.id).stock, 12);
  assert.equal(w.evidence.discovered, 1);
});
test("new births beyond 96 remain named individuals without replacing saved lives", () => {
  const w = colony();
  addObject(w, "dwelling", 15, 15);
  for (let i = 0; i < 96; i++)
    addCreature(w, 20 + (i % 12), 20 + Math.floor(i / 12));
  const ids = w.creatures.map((c) => c.id);
  const parent = w.creatures[0];
  const total = w.population;
  addCreature(w, parent.x, parent.y, parent);
  assert.equal(w.cohort, 0);
  assert.equal(w.population, total + 1);
  assert.deepEqual(
    w.creatures.slice(0,ids.length).map((c) => c.id),
    ids,
  );
  stepCohorts(w, 0.1);
  assert.equal(w.district.healthCounts.healthy, w.cohort);
  assert.equal(
    w.district.allocations.care + w.district.allocations.rest,
    w.cohort,
  );
  assert.equal(migrateWorld(w).district.population, w.cohort);
});
test("cancelled or newly invalid commitments cannot reject the whole colony schedule", () => {
  const w = colony();
  care(w);
  const c = addCreature(w, 24, 24);
  c.fed = 20;
  const banana = addObject(w, "banana", 25, 24, { stock: 1 });
  applyPlan(w, makePlan(w));
  banana.stock = 0;
  c.target = banana.id;
  c.task = "eat";
  c.job = {
    state: "travelling",
    point: { x: 25.75, y: 24.75 },
    slot: 0,
    started: 0,
    lastProgress: 0,
    expected: 30,
  };
  const plan = makePlan(w);
  assert.equal(applyPlan(w, plan), true);
  assert.notEqual(c.target, banana.id);
});
test("recovery suggestions expire when needs recover; explicit care goals persist", async () => {
  const { goalPolicy, addGoal } = await import("../src/game/goals.js");
  const w = colony(),
    c = addCreature(w, 24, 24);
  c.fed = c.clean = c.amused = 80;
  w.memory.lastPlan = { policy: "care" };
  assert.equal(goalPolicy(w), "balanced");
  addGoal(w, { kind: "care", target: 90 }, "Keep everyone healthy", "test");
  assert.equal(goalPolicy(w), "care");
});

test("Jev results from an abandoned world are discarded; failures use a valid local plan", async () => {
  const { decide, brainStatus, stopBrain } = await import("../src/brain.js");
  const { decisionWorld } = await import("../src/game/evaluation.js");
  const original = globalThis.fetch;
  try {
    let release, requestSignal, started;
    const requested=new Promise(resolve=>started=resolve);
    const waiting = new Promise((resolve) => (release = resolve));
    globalThis.fetch = async (_url, init) => {
      requestSignal = init.signal;
      started();
      await waiting;
      return {
        ok: true,
        json: async () => ({
          answers: { decision: { type: "choice", choice: "balanced" } },
        }),
      };
    };
    let w = decisionWorld({ kind: "hunger" });
    w.settings.provider = "jev";
    brainStatus.ready = true;
    const pending = decide(w, "test-only");
    await requested;
    stopBrain("Restored another branch");
    release();
    assert.equal(await pending, null);
    assert.equal(requestSignal.aborted, true);
    assert.equal(w.decisions.length, 0);
    globalThis.fetch = async () => {
      throw new Error("Network unavailable");
    };
    w = decisionWorld({ kind: "hunger" });
    w.settings.provider = "jev";
    brainStatus.ready = true;
    const fallback = await decide(w, "test-only");
    assert.equal(fallback.source, "Local fallback");
    assert.equal(applyPlan(w, fallback.plan), true);
  } finally {
    globalThis.fetch = original;
    stopBrain();
  }
});
test("selected individual disambiguates a shared spoken first name", async () => {
  const { resolveListener } = await import("../src/game/identity.js");
  const w = colony(),
    a = addCreature(w, 24, 24),
    b = addCreature(w, 26, 24);
  renameCreature(w, a, "Pip Meadow");
  renameCreature(w, b, "Pip River");
  assert.ok(resolveListener(w, "Pip, help us", null).error);
  assert.equal(resolveListener(w, "Pip, help us", b.id).id, b.id);
});

test("narrow bridge serializes opposing traffic without body overlap", async () => {
  const { waypoint } = await import("../src/game/navigation.js");
  const { steerMove, separateBodies } = await import("../src/game/geometry.js");
  const { canEnterBridge } = await import("../src/game/traffic.js");
  const w = colony(),
    bridge = addObject(w, "bridge", 42.5, 25);
  bridge.bridge = { ...bridgeGeometry(bridge), width: 1.4, complete: true };
  w.progress.bridge = true;
  w.navRevision++;
  const goals = new Map();
  for (let i = 0; i < 4; i++) {
    const c = addCreature(w, i < 2 ? 37 : 48, 24.5 + (i % 2));
    goals.set(c.id, { x: i < 2 ? 48 : 37, y: 24.5 + (i % 2) });
  }
  let minimum = 10;
  for (let i = 0; i < 1200; i++) {
    w.time += 0.1;
    for (const c of w.creatures) {
      const target = goals.get(c.id);
      if (
        Math.hypot(c.x - target.x, c.y - target.y) < 0.1 ||
        !canEnterBridge(w, c, target)
      )
        continue;
      const p = waypoint(w, c, target);
      if (!p) continue;
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      steerMove(
        w,
        c,
        ((p.x - c.x) / Math.max(d, 0.001)) * Math.min(0.165, d),
        ((p.y - c.y) / Math.max(d, 0.001)) * Math.min(0.165, d),
      );
      assert.ok(clearPosition(w, c));
    }
    separateBodies(w);
    for (const c of w.creatures)
      for (const o of w.creatures)
        if (c !== o)
          minimum = Math.min(minimum, Math.hypot(c.x - o.x, c.y - o.y));
  }
  assert.ok(
    w.creatures.every(
      (c) => Math.hypot(c.x - goals.get(c.id).x, c.y - goals.get(c.id).y) < 0.2,
    ),
  );
  assert.ok(minimum >= 0.53, `minimum separation ${minimum}`);
});

test("neglect, pollution, Bug and Swarm share conserved death accounting", () => {
  for (const cause of ["neglect", "pollution"]) {
    const w = colony(),
      c = addCreature(w, 24, 24);
    c.fed = c.clean = c.amused = 0;
    c.deadTime = 27.95;
    if (cause === "pollution") {
      c.sickness = 100;
      w.pollution = [
        { source: "factory", x: 24, y: 24, radius: 5, amount: 100 },
      ];
    }
    stepWorld(w, 0.1);
    assert.equal(w.creatures.length, 0);
    assert.equal(w.departed[0].cause, cause);
    assert.equal(w.objects.find((o) => o.type === "corpse").stock, 1);
    assert.equal(w.evidence.deaths, 1);
  }
  const w = colony(),
    a = addCreature(w, 24, 24),
    b = addCreature(w, 25, 24),
    c = addCreature(w, 26, 24);
  w.progress.monolith = true;
  choose(w, "bug", "yes", a.id);
  assert.equal(w.evidence.sacrificed, 1);
  assert.equal(w.progress.bugs, 1);
  choose(w, "swarm", "yes", b.id);
  assert.equal(w.evidence.sacrificed, 3);
  assert.equal(w.progress.bugs, 1);
  assert.equal(w.creatures.length, 0);
  assert.equal(
    w.objects.filter((o) => o.type === "bone").reduce((n, o) => n + o.stock, 0),
    24,
  );
});
