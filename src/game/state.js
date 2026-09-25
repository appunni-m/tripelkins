import { themeCompatibleWorld } from "./theme-compat.js";
import { decisionPace, intelligenceWorkers } from "../intelligence-settings.js";
import { identity } from "./identity.js";
import { footprint, freePosition } from "./geometry.js";
import { extendWorld, migrateExtensions } from "./save-schema.js";
import { LIMITS, BUILDINGS } from "./catalog.js";
import { TASKS } from "./jobs.js";
import { normalizeGoals } from "./goals.js";
import { normalizeMemory, compactEvents } from "./memory.js";
import { createMap, normalizeMap, coordinate, clearNatural } from "./map.js";
import { createDiscovery, normalizeDiscovery, reveal } from "./discovery.js";
export const clamp = (v, lo, hi) =>
  Math.max(lo, Math.min(hi, Number.isFinite(Number(v)) ? Number(v) : lo));
export function random(w) {
  w.seed = (Math.imul(1664525, w.seed) + 1013904223) >>> 0;
  return w.seed / 4294967296;
}
export function addObject(w, type, x, y, extra = {}) {
  if (w.objects.length >= LIMITS.objects) return null;
  const o = {
    id: `o${w.nextId++}`,
    type,
    x,
    y,
    stock: 0,
    level: 1,
    progress: 0,
    ...extra,
  };
  w.objects.push(o);
  if (footprint(o) || type === "bridge")
    w.navRevision = (w.navRevision || 0) + 1;
  return o;
}
export function materializeObject(w, object) {
  if (!object?.id.startsWith("g:")) return object;
  if (w.objects.length >= LIMITS.objects || !clearNatural(w, object))
    return null;
  return addObject(w, object.type, object.x, object.y, {
    stock: object.stock,
    level: object.level,
    variant: object.variant,
    progress: object.progress,
  });
}
export function addCreature(w, x, y, source) {
  if (w.population >= 1e15) return null;
  if (source && (w.creatures.length >= LIMITS.creatures ||
      w.runtime?.growth?.held || w.creatures.length >= (w.runtime?.growth?.limit ?? LIMITS.creatures))) return null;
  if (
    w.creatures.length >= LIMITS.creatures
  ) {
    w.cohort++;
    w.population++;
    return;
  }
  const id = w.nextId++;
  const c = {
    id: `c${id}`,
    ...identity(w, source),
    x,
    y,
    fed: source ? 72 : 54,
    clean: source ? 74 : 58,
    amused: source ? 76 : 46,
    age: 0,
    growth: 0,
    task: "idle",
    target: null,
    work: 0,
    wanderX: x,
    wanderY: y,
    deadTime: 0,
    carry: 0,
  };
  const position = freePosition(w, { x, y });
  if (position) Object.assign(c, position);
  else {
    if (!source) {
      w.cohort++;
      w.population++;
    }
    return null;
  }
  c.cargoKind = null;
  c.job = null;
  c.sickness = 0;
  c.blocked = [];
  w.creatures.push(c);
  reveal(w,c);
  w.population++;
  return c;
}
export function remember(w, kind, message, entity = null) {
  const event = {
    id: w.nextEvent++,
    tick: Math.floor(w.time),
    at: new Date().toISOString(),
    kind: String(kind).slice(0, 40),
    message: String(message).slice(0, 220),
    entity,
  };
  w.memory.recent.push(event);
  w.memory.totals[kind] = Math.min(1e15, (w.memory.totals[kind] || 0) + 1);
  if (w.memory.recent.length > LIMITS.events)
    compactEvents(
      w.memory,
      w.memory.recent.splice(0, w.memory.recent.length - LIMITS.events),
    );
  const keys = Object.keys(w.memory.totals);
  for (const key of keys.slice(0, Math.max(0, keys.length - LIMITS.summaries)))
    delete w.memory.totals[key];
  w.revision++;
}
export function createWorld({ empty = false } = {}) {
  const w = {
    schema: 4,
    discovery: createDiscovery(),
    seed: 18492,
    map: createMap(
      empty ? 18492 : crypto.getRandomValues(new Uint32Array(1))[0],
    ),
    nextId: 1,
    nextEvent: 1,
    revision: 0,
    time: 0,
    population: 0,
    cohort: 0,
    stage: 1,
    creatures: [],
    objects: [],
    inventory: { wood: 16, blocks: 0, ore: 0, bones: 0 },
    progress: {
      hatched: false,
      bridge: false,
      monolith: false,
      energy: 0,
      peakBlocks: 0,
      chopped: 0,
      bugs: 0,
      pollution: 0,
      uplinks: 0,
    },
    memory: {
      ...normalizeMemory(),
      recent: [],
      totals: {},
      choices: [],
      jobs: [],
      activity: {},
      lastPlan: null,
      conversations: [],
      goals: [],
    },
    ui: {
      x: 24,
      y: 24,
      zoom: 1,
      tool: "inspect",
      selected: null,
      tab: "care",
      muted: false,
      paused: false,
      welcome: false,
    },
    settings: {
      provider: "laya",
      backend: "auto",
      model: "openai/gpt-5-mini",
      url: "https://openrouter.ai/api/v1",
      autonomy: true,
      decisionSpeed: "medium",
      intelligenceWorkers: 1,
      localEnabled: false,
      localBackend: null,
      voiceBackend: null,
      voiceEnabled: false,
      voiceConfigured: false,
    },
    savedAt: null,
  };
  extendWorld(w);
  reveal(w,{x:24,y:24},20);
  if (empty) return w;
  for (let y = 3; y < 46; y += 2.3)
    for (let x = 3; x < 63; x += 2.6) {
      if (x > 38 && x < 46) continue;
      const edge = x < 9 || y < 9 || y > 39 || x > 57;
      const patch = (x > 30 && y < 21) || (x < 16 && y > 30);
      if ((edge && random(w) > 0.12) || (patch && random(w) > 0.4))
        addObject(w, "tree", x + random(w), y + random(w), {
          variant: Math.floor(random(w) * 3),
        });
    }
  for (let i = 0; i < 20; i++) {
    const x = 11 + random(w) * 26,
      y = 11 + random(w) * 26;
    if (Math.hypot(x - 24, y - 24) > 4) addObject(w, "rock", x, y);
  }
  addObject(w, "bridge", 42, 25, { stock: 0 });
  addObject(w, "monolith", 35, 25);
  addObject(w, "mountain", 57, 9);
  for (let i = 0; i < 5; i++)
    addObject(w, "node", 48 + (i % 3) * 4, 28 + Math.floor(i / 3) * 6, {
      stock: 100000,
      level: i === 4 ? 2 : 1,
    });
  addObject(w, "lander", 24, 24);
  addObject(w, "flowers", 20, 22);
  addObject(w, "flowers", 28, 28);
  remember(w, "arrival", "A tiny spacecraft. A whole new beginning.");
  return w;
}
export function migrateWorld(raw) {
  raw = themeCompatibleWorld(raw);
  if (!raw) return createWorld();
  if (raw.schema === 1) {
    const w = createWorld();
    w.objects = w.objects.filter((o) => o.type !== "lander");
    w.progress.hatched = true;
    const pop = Math.floor(clamp(raw.population, 0, 1e15));
    for (let i = 0; i < Math.min(pop, LIMITS.creatures); i++) {
      const c = addCreature(w, 19 + random(w) * 11, 19 + random(w) * 11);
      for (const n of ["fed", "clean", "amused"])
        if (c) c[n] = clamp(raw.needs?.[n] ?? 70, 0, 100);
    }
    w.cohort = pop - w.creatures.length;
    w.population = pop;
    for (const k of Object.keys(w.inventory))
      w.inventory[k] = clamp(raw.inventory?.[k] || 0, 0, 1e15);
    let n = 0;
    for (const [type, count] of Object.entries(raw.buildings || {}))
      if (BUILDINGS[type])
        for (let i = 0; i < Math.min(Number(count) || 0, 8); i++) {
          addObject(w, type, 19 + (n % 5) * 3, 17 + Math.floor(n / 5) * 3, {
            stock: type === "orchard" ? 6 : 0,
          });
          n++;
        }
    if (raw.partTwo) {
      w.stage = 2;
      w.progress.bridge = true;
      w.progress.monolith = true;
    }
    w.progress.peakBlocks = w.inventory.blocks;
    w.settings.provider =
      raw.brainProvider === "openrouter" ? "openrouter" : "laya";
    w.settings.url = String(raw.openRouterUrl || w.settings.url).slice(0, 300);
    w.settings.model = String(raw.openRouterModel || w.settings.model).slice(
      0,
      120,
    );
    for (const e of (raw.history || []).slice(-40))
      remember(
        w,
        "legacy",
        typeof e.value === "string"
          ? e.value
          : String(e.kind || "A past action"),
      );
    remember(
      w,
      "migration",
      "Your earlier colony has moved into its new world. The original save is archived.",
    );
    w.ui.paused = true;
    w.discovery = normalizeDiscovery(null,w);
    return migrateWorld(w);
  }
  if (
    ![2, 3, 4].includes(raw.schema) ||
    !Array.isArray(raw.creatures) ||
    !Array.isArray(raw.objects)
  )
    throw new Error("Unsupported or damaged world file.");
  // A missing need is damaged data, not a starving creature. Fail before
  // replacing the current world instead of silently turning it into zero.
  if (
    raw.creatures.some(
      (c) =>
        !c ||
        ["fed", "clean", "amused"].some(
          (key) =>
            c[key] == null ||
            typeof c[key] === "boolean" ||
            !Number.isFinite(Number(c[key])),
        ),
    )
  )
    throw new Error(
      "This saved world has incomplete creature needs. Choose another saved copy.",
    );
  const w = createWorld({ empty: true });
  w.map = normalizeMap(raw.map, raw.schema >= 3);
  w.seed = clamp(raw.seed, 0, 4294967295);
  w.nextId = Math.floor(clamp(raw.nextId, 1, 1e15));
  w.nextEvent = Math.floor(clamp(raw.nextEvent, 1, 1e15));
  w.revision = clamp(raw.revision, 0, 1e15);
  w.time = clamp(raw.time, 0, 1e12);
  w.stage = Math.floor(clamp(raw.stage, 1, 4));
  const validTypes = new Set([
    "tree",
    "rock",
    "node",
    "bridge",
    "monolith",
    "mountain",
    "lander",
    "banana",
    "cricketball",
    "log",
    "bone",
    "ore",
    "stump",
    "corpse",
    "hole",
    "flowers",
    ...Object.keys(BUILDINGS),
  ]);
  const ids = new Set();
  w.objects = raw.objects
    .slice(0, LIMITS.objects)
    .filter(
      (o) =>
        o &&
        validTypes.has(o.type) &&
        typeof o.id === "string" &&
        /^o[0-9]{1,15}$/.test(o.id) &&
        !ids.has(o.id) &&
        ids.add(o.id),
    )
    .map((o) => ({
      id: o.id.slice(0, 40),
      type: o.type,
      x: coordinate(o.x),
      y: coordinate(o.y),
      stock: clamp(o.stock, 0, 1e15),
      level: Math.floor(clamp(o.level ?? 1, 1, 2)),
      quality: Math.floor(clamp(o.quality ?? 1, 1, 2)),
      progress: clamp(o.progress, 0, 1e12),
      variant: clamp(o.variant, 0, 2),
    }));
  w.creatures = raw.creatures
    .slice(0, LIMITS.creatures)
    .filter(
      (c) =>
        c &&
        typeof c.id === "string" &&
        /^c[0-9]{1,15}$/.test(c.id) &&
        !ids.has(c.id) &&
        ids.add(c.id),
    )
    .map((c) => ({
      id: c.id.slice(0, 40),
      name: String(c.name || "Pip").slice(0, 100),
      x: coordinate(c.x),
      y: coordinate(c.y),
      fed: clamp(c.fed, 0, 100),
      clean: clamp(c.clean, 0, 100),
      amused: clamp(c.amused, 0, 100),
      age: clamp(c.age, 0, 1e12),
      growth: clamp(c.growth, 0, 50),
      task: [
        "idle",
        "eat",
        "wash",
        "play",
        "haul",
        "mine",
        "work",
        "home",
        "orbit",
      ].includes(c.task)
        ? c.task
        : "idle",
      target: w.objects.some((o) => o.id === c.target) ? c.target : null,
      work: clamp(c.work, 0, 100),
      wanderX: coordinate(c.wanderX, coordinate(c.x)),
      wanderY: coordinate(c.wanderY, coordinate(c.y)),
      deadTime: clamp(c.deadTime, 0, 30),
      carry: clamp(c.carry, 0, 12),
      boost: !!c.boost,
    }));
  w.cohort = Math.floor(clamp(raw.cohort, 0, 1e15));
  if (raw.creatures.length > LIMITS.creatures)
    w.cohort += raw.creatures
      .slice(LIMITS.creatures)
      .filter(
        (c) =>
          typeof c.id === "string" &&
          /^c[0-9]{1,15}$/.test(c.id) &&
          !ids.has(c.id) &&
          ids.add(c.id),
      ).length;
  w.population = Math.min(1e15, w.cohort + w.creatures.length);
  for (const key of Object.keys(w.inventory))
    w.inventory[key] = clamp(raw.inventory?.[key], 0, 1e15);
  for (const [key, value] of Object.entries(raw.progress || {}))
    if (
      [
        "hatched",
        "bridge",
        "monolith",
        "energy",
        "peakBlocks",
        "chopped",
        "bugs",
        "pollution",
        "uplinks",
        "grabber",
        "swarm",
        "tnt",
        "cannon",
        "choicePending",
      ].includes(key)
    )
      w.progress[key] =
        typeof value === "boolean" ? value : clamp(value, 0, 1e15);
  w.progress.pollution = clamp(w.progress.pollution, 0, 1000);
  Object.assign(w.memory, normalizeMemory(raw.memory));
  w.memory.recent = (raw.memory?.recent || [])
    .slice(-LIMITS.events)
    .filter((e) => e && typeof e.kind === "string")
    .map((e) => ({
      id: clamp(e.id, 0, 1e15),
      tick: clamp(e.tick, 0, 1e12),
      at: typeof e.at === "string" ? e.at.slice(0, 32) : null,
      kind: e.kind.slice(0, 40),
      message: String(e.message || "").slice(0, 220),
      entity: typeof e.entity === "string" ? e.entity.slice(0, 40) : null,
    }));
  w.memory.totals = Object.fromEntries(
    Object.entries(raw.memory?.totals || {})
      .slice(0, 64)
      .filter(([k]) => !["__proto__", "constructor", "prototype"].includes(k))
      .map(([k, v]) => [k.slice(0, 40), clamp(v, 0, 1e15)]),
  );
  w.memory.choices = (raw.memory?.choices || [])
    .slice(-32)
    .map((v) => String(v).slice(0, 100));
  const tasks = TASKS;
  w.memory.activity = Object.fromEntries(
    Object.entries(raw.memory?.activity || {})
      .filter(([task]) => tasks.includes(task))
      .map(([task, count]) => [task, clamp(count, 0, 1e15)]),
  );
  w.memory.jobs = (raw.memory?.jobs || [])
    .slice(-64)
    .filter((j) => j && tasks.includes(j.task))
    .map((j) => ({
      task: j.task,
      unit: String(j.unit || "").slice(0, 40),
      target: String(j.target || "").slice(0, 40),
      tick: clamp(j.tick, 0, 1e12),
    }));
  const lastPlan = raw.memory?.lastPlan;
  w.memory.conversations = (
    Array.isArray(raw.memory?.conversations) ? raw.memory.conversations : []
  )
    .slice(-24)
    .filter(
      (turn) =>
        turn && typeof turn.text === "string" && typeof turn.reply === "string",
    )
    .map((turn) => ({
      text: turn.text.slice(0, 500),
      reply: turn.reply.slice(0, 500),
      source: String(turn.source || "Local conversation").slice(0, 80),
      tick: clamp(turn.tick, 0, 1e12),
      listener:
        typeof turn.listener === "string" ? turn.listener.slice(0, 40) : null,
    }));
  w.memory.goals = normalizeGoals(raw.memory?.goals);
  if (
    lastPlan &&
    ["care", "balanced", "expand", "build", "industry", "mine"].includes(lastPlan.policy)
  )
    w.memory.lastPlan = {
      policy: lastPlan.policy,
      source: String(lastPlan.source || "").slice(0, 60),
      tick: clamp(lastPlan.tick, 0, 1e12),
      goalId: w.memory.goals.some((g) => g.id === lastPlan.goalId)
        ? lastPlan.goalId
        : null,
    };
  const u = raw.ui || {};
  w.ui = {
    x: coordinate(u.x ?? 24, 24),
    y: coordinate(u.y ?? 24, 24),
    zoom: clamp(u.zoom ?? 1, 0.55, 2.4),
    tool: String(u.tool || "inspect").slice(0, 40),
    selected: typeof u.selected === "string" ? u.selected.slice(0, 40) : null,
    tab: ["care", "build", "tools"].includes(u.tab) ? u.tab : "care",
    muted: !!u.muted,
    paused: !!u.paused,
    welcome: !!u.welcome,
  };
  const s = raw.settings || {};
  w.settings = {
    provider: s.provider === "openrouter" ? "openrouter" : "laya",
    backend: ["webgpu", "wasm"].includes(s.backend) ? s.backend : "auto",
    model: String(s.model || w.settings.model).slice(0, 120),
    url: String(s.url || w.settings.url).slice(0, 300),
    autonomy: s.autonomy !== false,
    decisionSpeed: decisionPace(s).id,
    intelligenceWorkers: intelligenceWorkers(s),
    localEnabled: s.localEnabled === true,
    localBackend: ["webgpu", "wasm"].includes(s.localBackend)
      ? s.localBackend
      : null,
    voiceBackend: ["webgpu", "wasm"].includes(s.voiceBackend)
      ? s.voiceBackend
      : null,
    voiceEnabled: s.voiceEnabled === true,
    voiceConfigured: s.voiceConfigured === true || s.voiceEnabled === true,
  };
  w.savedAt = raw.savedAt || null;
  for (const g of w.memory.goals) ids.add(g.id);
  for (const id of ids)
    w.nextId = Math.max(w.nextId, Number(id.slice(1)) + 1 || 1);
  w.nextEvent = Math.max(w.nextEvent, ...w.memory.recent.map((e) => e.id + 1));
  migrateExtensions(w, raw);
  w.discovery = normalizeDiscovery(raw.discovery,w);
  return w;
}
