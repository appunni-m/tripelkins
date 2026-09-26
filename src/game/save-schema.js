import { refreshDistrict, syncPopulation } from "./population.js";
import { addWorkProject, MAX_WORK_PROJECTS, MAX_PROJECT_CREW } from "./work-projects.js";
import { LIMITS } from "./catalog.js";
import { initialStory, initialEvidence, STORY_IDS, STORY_LIMIT, storyEntry } from "./story.js";
import {
  bridgeGeometry,
  serviceSlots,
  freePosition,
  clearPosition,
} from "./geometry.js";
import { TASKS, JOB_STATES } from "./jobs.js";
import { coordinate } from "./map.js";
import { DEVELOPMENT_TYPES } from "./development.js";
import { initialCommunity, INBOX_LIMIT } from "./community.js";
const n = (v, lo = 0, hi = 1e15) =>
  Math.max(lo, Math.min(hi, Number.isFinite(Number(v)) ? Number(v) : lo));
const text = (v, max = 160) => String(v || "").slice(0, max);
const list = (v, max) => (Array.isArray(v) ? v.slice(-max) : []);
const point = (v) => ({ x: coordinate(v?.x), y: coordinate(v?.y) });
export function extendWorld(w) {
  Object.assign(w, {
    nextBirth: 0,
    commandRevision: 0,
    navRevision: 0,
    groups: [],
    departed: [],
    pollution: [],
    story: initialStory(),
    evidence: initialEvidence(),
    directives: {
      pauseWork: false,
      avoidPollution: false,
      careFloor: 35,
      members: [],
      region: null,
    },
    orbital: {
      population: 0,
      fraction: 0,
      energy: 0,
      launches: 0,
      lastLaunch: 0,
    },
    district: {
      population: 0,
      capacity: 0,
      health: 100,
      fraction: 0,
      lossFraction: 0,
    },
    metrics: {
      switches: 0,
      stalls: 0,
      completed: 0,
      violations: 0,
      decisions: 0,
    },
    decisions: [],
    community: initialCommunity(),
  });
  w.inventory.corpses = 0;
}
export function migrateExtensions(w, raw) {
  w.nextBirth = Math.floor(n(raw.nextBirth));
  w.commandRevision = n(raw.commandRevision);
  w.navRevision = n(raw.navRevision);
  const currentIds = new Set(w.creatures.map((c) => c.id));
  for (let i = 0; i < w.creatures.length; i++) {
    const c = w.creatures[i],
      original = raw.creatures.find((x) => x.id === c.id) || {};
    c.identityVersion = 1;
    c.birthOrdinal = Math.floor(n(original.birthOrdinal ?? i));
    c.dictionaryVersion = original.dictionaryVersion === 1 ? 1 : 0;
    c.nameIndex = Math.floor(n(original.nameIndex, 0, 16383));
    c.customName = original.customName ? text(original.customName, 100) : null;
    c.parentId = original.parentId ? text(original.parentId, 40) : null;
    c.birthTick = n(original.birthTick, 0, w.time);
    c.traits = Object.fromEntries(
      ["curiosity", "sociability", "diligence"].map((key) => [
        key,
        n(original.traits?.[key] ?? 0.5, 0, 1),
      ]),
    );
    c.favorite = !!original.favorite;
    c.encounters = list(original.encounters, 8).map((e) => ({
      kind: text(e.kind, 24),
      other: text(e.other, 40),
      tick: n(e.tick),
    }));
    c.relationships = list(original.relationships, 4).map((e) => ({
      id: text(e.id, 40),
      affinity: n(e.affinity, -10, 10),
      last: n(e.last),
    }));
    c.cargoKind = ["wood", "bones", "ore"].includes(original.cargoKind)
      ? original.cargoKind
      : c.carry
        ? "wood"
        : null;
    c.heading = n(original.heading ?? 0, -Math.PI, Math.PI);
    c.sickness = n(original.sickness, 0, 100);
    c.boostUntil = n(original.boostUntil, 0, 1e12);
    c.lastWorkTurn = Math.floor(n(original.lastWorkTurn));
    c.workCycles = Math.floor(n(original.workCycles));
    c.task = TASKS.includes(original.task) ? original.task : "idle";
    c.blocked = list(original.blocked, 8).map((b) => ({
      target: text(b.target, 40),
      until: n(b.until, 0, 1e12),
      revision: n(b.revision),
    }));
    const j = original.job;
    c.job =
      j && JOB_STATES.includes(j.state) && j.point
        ? {
            state: j.state,
            slot: Math.floor(n(j.slot, 0, 64)),
            point: point(j.point),
            partner: currentIds.has(j.partner) ? j.partner : null,
            project: j.project ? Math.floor(n(j.project)) : null,
            purpose: text(j.purpose),
            started: n(j.started, 0, w.time),
            lastProgress: n(j.lastProgress, 0, w.time),
            progressAt: n(j.progressAt ?? j.lastProgress, 0, w.time),
            bestDistance: n(
              j.bestDistance ?? Math.hypot(c.x - j.point.x, c.y - j.point.y),
              0,
              300,
            ),
            expected: n(j.expected, 0, 300),
          }
        : null;
    if (!c.job && c.target) {
      const o = w.objects.find((o) => o.id === c.target),
        p = o && serviceSlots(w, o, c)[0];
      if (p)
        c.job = {
          state: "reserved",
          slot: p.slot,
          point: p,
          partner: null,
          purpose: "Continue saved work",
          started: w.time,
          lastProgress: w.time,
          expected: 60,
        };
      else {
        c.task = "idle";
        c.target = null;
      }
    }
    w.nextBirth = Math.max(w.nextBirth, c.birthOrdinal + 1);
  }
  for (const o of w.objects) {
    const original = raw.objects.find((x) => x.id === o.id) || {};
    if (o.type === "bridge") {
      const b = original.bridge,
        g = bridgeGeometry(o);
      if (b) {
        g.a = point(b.a);
        g.b = point(b.b);
        g.width = n(b.width, 1, 4);
        g.required = n(b.required, 1, 1000);
        g.delivered = {
          wood: n(b.delivered?.wood, 0, 1000),
          bones: n(b.delivered?.bones, 0, 1000),
        };
        g.complete = !!b.complete;
      } else if (raw.progress?.bridge) {
        g.complete = true;
        g.delivered.wood = g.required;
      }
      o.bridge = g;
      o.stock = g.delivered.wood + g.delivered.bones;
    }
    o.inputOre = n(original.inputOre, 0, 60);
    o.discovered = !!original.discovered;
    o.phase = n(original.phase, 0, 1e12);
    o.contact = original.contact === 2 ? 2 : 1;
  }
  w.departed = list(raw.departed, 32).map((d) => ({
    id: text(d.id, 40),
    name: text(d.name, 100),
    cause: text(d.cause, 30),
    tick: n(d.tick),
    actor: text(d.actor, 40),
  }));
  w.pollution = list(raw.pollution, 64).map((z) => ({
    source: text(z.source, 40),
    ...point(z),
    radius: n(z.radius, 1, 12),
    amount: n(z.amount, 0, 250),
  }));
  if (raw.schema < 4 && w.progress.pollution > 0) {
    const factories = w.objects.filter((o) => o.type === "factory");
    w.pollution = factories.slice(0, 64).map((o) => ({
      source: o.id,
      x: o.x,
      y: o.y,
      radius: 5,
      amount: w.progress.pollution / Math.max(1, factories.length),
    }));
  }
  const s = raw.story || {};
  w.story = {
    ...initialStory(),
    completed: [...new Set(list(s.completed, STORY_LIMIT).filter((id) => STORY_IDS.has(id)))],
    seen: [...new Set(list(s.seen, STORY_LIMIT).filter((id) => STORY_IDS.has(id)))],
    queue: list(s.queue, 24).filter((id) => STORY_IDS.has(id)),
    active: STORY_IDS.has(s.active) ? s.active : null,
    lastAt: n(s.lastAt ?? -60, -60, 1e12),
    lastLetterAt: n(s.lastLetterAt ?? w.time,0,w.time),
    lastIncidentAt: n(s.lastIncidentAt ?? 0,0,w.time),
    refusals: list(s.refusals, 24).map((x) => text(x, 40)),
    promises: list(s.promises, 16).map((p) => ({
      request: text(p.request, 40),
      status: p.status === "kept" ? "kept" : "pending",
      tick: n(p.tick),
      before: n(p.before),
    })),
    archives: list(s.archives, 6).map((x) => text(x, 40)),
    evidence: list(s.evidence, 24).map((e) => ({
      kind: text(e.kind, 40),
      count: n(e.count),
      first: text(e.first, 180),
      last: text(e.last, 180),
      tick: n(e.tick),
      entity: text(e.entity, 40),
    })),
    assessments: list(s.assessments, 5).map((a) => ({
      dimension: text(a.dimension, 32),
      text: text(a.text, 220),
      value: n(a.value),
      consequence: text(a.consequence, 200),
    })),
  };
  w.story.responses = list(s.responses, 32)
    .filter((r) => STORY_IDS.has(r.id))
    .map((r) => ({
      id: r.id,
      response: text(r.response, 100),
      tick: n(r.tick),
    }));
  for (const key of Object.keys(w.evidence))
    w.evidence[key] = n(raw.evidence?.[key]);
  const d = raw.directives || {};
  w.directives = {
    pauseWork: !!d.pauseWork,
    avoidPollution: !!d.avoidPollution,
    careFloor: n(d.careFloor ?? 35, 35, 90),
    members: list(d.members, LIMITS.creatures).filter((id) => currentIds.has(id)),
    region: d.region ? point(d.region) : null,
  };
  for (const key of Object.keys(w.orbital))
    w.orbital[key] = n(raw.orbital?.[key]);
  w.orbital.population = Math.floor(w.orbital.population);
  w.orbital.fraction = n(raw.orbital?.fraction, 0, 0.999999999);
  for (const key of Object.keys(w.district))
    w.district[key] = n(raw.district?.[key] ?? (key === "health" ? 100 : 0));
  for (const key of Object.keys(w.metrics))
    w.metrics[key] = n(raw.metrics?.[key]);
  w.groups = list(raw.groups, 16).map((g) => ({
    id: text(g.id, 40),
    role: text(g.role, 40),
    project: text(g.project, 80),
    revision: n(g.revision),
    members: list(g.members, LIMITS.creatures).filter((id) => currentIds.has(id)),
    outcomes: list(g.outcomes, 8).map((x) => text(x, 180)),
  }));
  w.decisions = list(raw.decisions, 32).map((d) => ({
    tick: n(d.tick),
    goal: text(d.goal, 80),
    source: text(d.source, 80),
    model: text(d.model, 120),
    candidate: text(d.candidate, 24),
    facts: text(d.facts, 250),
    expected: text(d.expected, 200),
    observed: text(d.observed, 200),
    rejection: text(d.rejection, 160),
    baseline: n(d.baseline),
    completed: n(d.completed),
  }));
  const community = raw.community || {};
  w.community = {
    ...initialCommunity(),
    consent: ["unasked", "offered", "accepted", "declined"].includes(community.consent) ? community.consent : "unasked",
    nextProject: Math.max(1, Math.floor(n(community.nextProject))),
    workTurn: Math.max(n(community.workTurn),...w.creatures.map(c=>c.lastWorkTurn||0)),
    nextAccess: Math.max(1,Math.floor(n(community.nextAccess))),
    access: list(community.access,8).filter(r=>r && r.point && TASKS.includes(r.task)).map(r=>({
      id:Math.max(1,Math.floor(n(r.id))),key:text(r.key,80),target:r.target?text(r.target,40):null,
      point:point(r.point),unit:currentIds.has(r.unit)?r.unit:null,task:r.task,
      project:r.project?Math.floor(n(r.project)):null,label:text(r.label,40),reason:text(r.reason,240),
      created:n(r.created,0,w.time),lastSeen:n(r.lastSeen,0,w.time),checked:-10,
      status:["waiting","ready","clearing","help"].includes(r.status)?r.status:"waiting",
      blocker:r.blocker?text(r.blocker,40):null,crew:list(r.crew,1).filter(id=>currentIds.has(id)),
      source:text(r.source,80),notified:!!r.notified,
    })),
    nextMessage: Math.max(1, Math.floor(n(community.nextMessage))),
    completed: Math.floor(n(community.completed)),
    lastProjectAt: n(community.lastProjectAt ?? -60,-60,w.time),
    lastNoticeAt: n(community.lastNoticeAt ?? -60,-60,w.time),
    explored: Math.floor(n(community.explored)),
    visited: [...new Set(list(community.visited,64).filter((v) => typeof v === "string" && /^-?\d{1,10}:-?\d{1,10}$/.test(v)))],
    inbox: list(community.inbox,INBOX_LIMIT).filter((m) => m && typeof m === "object").map((m) => ({
      id: Math.floor(n(m.id)), key: m.key ? text(m.key,80) : null,
      title: text(m.title,100), text: text(m.text,1200), tick:n(m.tick,0,w.time),
      story: STORY_IDS.has(m.story) ? m.story : null,
      action: m.action === "independence" ? "independence" : null,
      category:["letter","flight","milestone","work","help"].includes(m.category) ? m.category : "letter",
      responseRequired:!!(STORY_IDS.has(m.story) && storyEntry(m.story)?.responses.length>1 && !w.story.responses.some(r=>r.id===m.story)),
      read:!!m.read, notified:!!m.notified,
    })),
    activity: list(community.activity,40).map((a) => ({tick:n(a.tick,0,w.time),kind:text(a.kind,32),text:text(a.text,220),source:text(a.source,80),detail:text(a.detail,300)})),
  };
  for (const m of w.community.inbox) w.community.nextMessage = Math.max(w.community.nextMessage,m.id+1);
  for (const r of w.community.access) w.community.nextAccess=Math.max(w.community.nextAccess,r.id+1);
  if (community.plan && Array.isArray(community.plan.children)) {
    const plan=community.plan;
    w.community.plan={parent:text(plan.parent,80),title:text(plan.title,120),expanding:!!plan.expanding,
      density:{target:6,abovePenalty:4,belowPenalty:.6,crowded:Math.floor(n(plan.density?.crowded,0,LIMITS.creatures)),
        areas:list(plan.density?.areas,6).map(a=>({...point(a),residents:n(a.residents,0,1e5),buildings:n(a.buildings,0,LIMITS.objects)}))},
      children:list(plan.children,7).map(s=>({id:text(s.id,80),kind:text(s.kind,24),title:text(s.title,120),
        remaining:n(s.remaining),status:["urgent","needed","satisfied","working","waiting","blocked"].includes(s.status)?s.status:"needed"}))};
  }
  w.community.projects=[];
  const claimed=new Set(), projectIds=new Set();
  for (const project of [community.project,...list(community.projects,MAX_WORK_PROJECTS-1)].filter(Boolean)) {
    if (w.community.consent !== "accepted" || !DEVELOPMENT_TYPES.includes(project.type)) continue;
    const id=Math.max(1,Math.floor(n(project.id)));
    if (projectIds.has(id)) continue;
    const crew=[...new Set(list(project.crew,MAX_PROJECT_CREW))].filter(id=>currentIds.has(id)&&!claimed.has(id));
    if (!crew.length) continue;
    crew.forEach(id=>claimed.add(id));projectIds.add(id);
    addWorkProject(w,{
      id:Math.max(1,Math.floor(n(project.id))), type:project.type, ...point(project),
      crew,
      target:Math.floor(n(project.target ?? 24,1,1e6)),
      progress:n(project.progress,0,32), required:32, started:n(project.started,0,w.time),
      source:text(project.source,80), blocked:text(project.blocked,200),
      parentGoal:text(project.parentGoal,80),subgoal:text(project.subgoal,40),siteReason:text(project.siteReason,240),
    });
    w.community.nextProject = Math.max(w.community.nextProject,id+1);
  }
  syncPopulation(w);
  refreshDistrict(w);
  w.progress.secondContact = !!raw.progress?.secondContact;
  w.progress.finalRequired = Math.floor(n(raw.progress?.finalRequired, 0, 3));
  w.ui.held =
    raw.ui?.held &&
    ["log", "bone", "ore", "corpse", "rock"].includes(raw.ui.held.type)
      ? {
          type: raw.ui.held.type,
          stock: n(raw.ui.held.stock),
          id: text(raw.ui.held.id, 40),
        }
      : null;
  w.settings.provider = ["laya", "openrouter", "jev"].includes(
    raw.settings?.provider,
  )
    ? raw.settings.provider
    : "laya";
  if (raw.schema < 4) {
    // Geometry migration moves invalid bodies to nearby free ground, never heals them.
    let repaired = 0;
    for (const c of w.creatures)
      if (!clearPosition(w, c)) {
        const p = freePosition(
          w,
          c,
          w.creatures.filter((o) => o !== c),
          10,
        );
        if (p) {
          c.x = p.x;
          c.y = p.y;
          c.job = null;
          c.target = null;
          c.task = "idle";
          repaired++;
        }
      }
    if (!w.progress.monolith) {
      const stone = w.objects.find((o) => o.type === "monolith");
      if (stone) {
        stone.x = 35;
        stone.y = 25;
      }
    }
    if (w.progress.tnt) w.progress.secondContact = true;
    w.ui.paused = true;
    w.commandRevision++;
    w.navRevision++;
    w.memory.recent.push({
      id: w.nextEvent++,
      tick: Math.floor(w.time),
      at: new Date().toISOString(),
      kind: "migration",
      message: `World updated; names and health preserved. ${repaired} creatures moved onto clear ground.`,
      entity: null,
    });
    w.memory.recent = w.memory.recent.slice(-160);
  }
}
