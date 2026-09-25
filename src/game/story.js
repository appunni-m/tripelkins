import { BEATS, INCIDENTS, PHILOSOPHY, ARCHIVES } from "./story-content.js";
import { CHAPTERS } from "./colony-letters.js";
import { postMessage } from "./community.js";
const all = [...BEATS, ...INCIDENTS, ...PHILOSOPHY, ...CHAPTERS];
export const STORY_LIMIT = 128;
export function initialStory() {
  return {
    completed: [],
    seen: [],
    queue: [],
    active: null,
    lastAt: -60,
    lastLetterAt: 0,
    lastIncidentAt: 0,
    refusals: [],
    promises: [],
    responses: [],
    archives: [],
    evidence: [],
    assessments: [],
  };
}
export function initialEvidence() {
  return {
    care: 0,
    deliveries: 0,
    woodDelivered: 0,
    bonesDelivered: 0,
    deaths: 0,
    neglect: 0,
    pollutionDeaths: 0,
    hammer: 0,
    meteor: 0,
    meteorDeaths: 0,
    sacrificed: 0,
    cleaned: 0,
    discovered: 0,
    launches: 0,
    autonomy: 0,
  };
}
export function noteEvidence(w, kind, text, amount = 1, entity = null) {
  if (Object.hasOwn(w.evidence, kind))
    w.evidence[kind] = Math.min(1e15, w.evidence[kind] + amount);
  const old = w.story.evidence.find((e) => e.kind === kind);
  if (old) {
    old.count += amount;
    old.last = text.slice(0, 180);
    old.tick = w.time;
    old.entity = entity;
  } else
    w.story.evidence.push({
      kind,
      count: amount,
      first: text.slice(0, 180),
      last: text.slice(0, 180),
      tick: w.time,
      entity,
    });
  w.story.evidence = w.story.evidence.slice(-24);
}
export function updateStory(w) {
  let milestone = false;
  for (const beat of BEATS)
    if (!w.story.completed.includes(beat.id) && beat.when(w)) {
      w.story.completed.push(beat.id);
      enqueue(w, beat.id);
      milestone = true;
    }
  if (milestone) {
    const thought = PHILOSOPHY.find((b) => b.when(w) && !w.story.seen.includes(b.id) &&
      !w.community.inbox.some((m) => m.key === `story:${b.id}`));
    if (thought) enqueue(w,thought.id);
  }
  // One new letter at most per minute of play, and only after its actual event.
  // Save its ID separately from inbox retention so an old letter never repeats.
  if (w.time - w.story.lastLetterAt >= 60) {
    const letter = CHAPTERS.find(b => !w.story.completed.includes(b.id) && b.when(w));
    if (letter) {
      w.story.completed.push(letter.id);
      w.story.lastLetterAt = w.time;
      enqueue(w,letter.id);
    }
  }
  if (w.time - Math.max(w.story.lastAt,w.story.lastIncidentAt) > 90 && w.story.queue.length < 3) {
    const incident = INCIDENTS.find(
      (b) =>
        !w.story.seen.includes(b.id) &&
        !w.story.queue.includes(b.id) &&
        !w.community.inbox.some((m) => m.key === `story:${b.id}`) &&
        b.when(w),
    );
    if (incident) { enqueue(w, incident.id); w.story.lastIncidentAt = w.time; }
    // Reflections stay in the archive/inbox only after a concrete milestone.
  }
  const flags = [
    w.progress.hatched,
    w.population >= 6,
    w.progress.bridge,
    w.objects.some((o) => o.type === "factory"),
    w.orbital.population > 0,
    w.stage >= 3,
  ];
  flags.forEach((yes, i) => {
    if (yes && !w.story.archives.includes(ARCHIVES[i].id))
      w.story.archives.push(ARCHIVES[i].id);
  });
  for (const promise of w.story.promises) {
    if (promise.status !== "pending") continue;
    if (
      (promise.request === "mop" && w.evidence.cleaned > promise.before) ||
      w.objects.some((o) => o.type === promise.request)
    ) {
      promise.status = "kept";
      noteEvidence(w, "care", `Kept a promise: ${promise.request}`);
    }
  }
}
function enqueue(w, id) {
  if (!w.story.seen.includes(id) && !w.story.queue.includes(id) &&
      !w.community.inbox.some((m) => m.key === `story:${id}`))
    w.story.queue.push(id);
  w.story.queue = w.story.queue.slice(0, 24);
}
export function storyEntry(id) { return all.find((b) => b.id === id) || null; }
export function collectStoryMessages(w) {
  const ids = [...new Set([w.story.active, ...w.story.queue].filter(Boolean))];
  w.story.queue = [];
  w.story.active = null;
  for (const id of ids) {
    const entry = storyEntry(id);
    if (!entry || w.story.seen.includes(id)) continue;
    const message = postMessage(w,{ key:`story:${id}`, title:entry.title,
      text:typeof entry.text === "function" ? entry.text(w) : entry.text, story:id,
      category:entry.category || (entry.request ? "help" : "milestone"), responseRequired:entry.responses.length>1 });
    if (message && id.startsWith("thought-")) message.notified = true;
    // Archiving a one-way observation needs no player answer. Decisions retain
    // their response buttons and are never silently answered on dismissal.
    if (entry.responses.length === 1) w.story.seen = [...new Set([...w.story.seen,id])].slice(-STORY_LIMIT);
  }
}
export function nextStory(w) {
  if (w.story.active) return all.find((b) => b.id === w.story.active) || null;
  if (w.time - w.story.lastAt < 12) return null;
  const id = w.story.queue.shift();
  if (!id) return null;
  w.story.active = id;
  return all.find((b) => b.id === id) || null;
}
export function answerStory(w, response) {
  const entry = all.find((b) => b.id === w.story.active);
  if (!entry) return;
  if (!entry.responses.includes(response)) response = entry.responses[0];
  w.story.responses.push({ id: entry.id, response, tick: w.time });
  w.story.responses = w.story.responses.slice(-32);
  if (response === "We can choose together")
    noteEvidence(
      w,
      "autonomy",
      `At “${entry.title}”, agreed to choose together.`,
    );
  if (response === "What do you think?")
    noteEvidence(
      w,
      "discovered",
      `Asked the collective about ${entry.id.replace("thought-", "")}.`,
    );
  w.story.seen.push(entry.id);
  w.story.seen = [...new Set(w.story.seen)].slice(-STORY_LIMIT);
  w.story.lastAt = w.time;
  w.story.active = null;
  if (entry.request && response === "Not now") {
    w.story.refusals.push(entry.request);
    w.story.refusals = [...new Set(w.story.refusals)].slice(-24);
    noteEvidence(
      w,
      "autonomy",
      `Declined the request for ${entry.request}; the colony respected the answer.`,
    );
  }
  if (entry.request && response === "I will help") {
    w.story.promises.push({
      request: entry.request,
      status: "pending",
      tick: w.time,
      before: w.evidence.cleaned,
    });
    w.story.promises = w.story.promises.slice(-16);
  }
  w.commandRevision++;
  w.revision++;
}
export function assessment(w) {
  const e = w.evidence,
    proof = (kind) => w.story.evidence.find((x) => x.kind === kind)?.last;
  return [
    {
      dimension: "Care",
      text: proof("care") || "Small gifts and facilities shaped daily life.",
      value: e.care,
      consequence: `${e.neglect} losses from unmet needs.`,
    },
    {
      dimension: "Expediency",
      text: proof("meteorDeaths") || proof("hammer") || proof("sacrificed") || "No deliberate sacrifices were recorded.",
      value: e.sacrificed + e.hammer + e.meteorDeaths,
      consequence: `${e.woodDelivered} wood and ${e.bonesDelivered} bones reached the crossing. ${e.meteorDeaths} lives were lost to meteors.`,
    },
    {
      dimension: "Curiosity",
      text:
        proof("discovered") || "The first lander was the beginning of discovery.",
      value: e.discovered,
      consequence: `${w.story.archives.length} archive entries opened.`,
    },
    {
      dimension: "Stewardship",
      text:
        proof("cleaned") || "The ground remembers what production left behind.",
      value: e.cleaned,
      consequence: `${Math.round(w.progress.pollution)} pollution remains; ${e.pollutionDeaths} losses from exposure.`,
    },
    {
      dimension: "Autonomy",
      text:
        proof("autonomy") || "The colony worked within the choices you made.",
      value: e.autonomy,
      consequence: `${w.story.promises.filter((p) => p.status === "kept").length} promises kept; ${w.story.refusals.length} requests declined.`,
    },
  ];
}
export function archiveEntries(w) {
  return ARCHIVES.filter((a) => w.story.archives.includes(a.id));
}
export const STORY_IDS = new Set(all.map((b) => b.id));
