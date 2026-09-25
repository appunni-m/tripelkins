import { resolveListener } from "./identity.js";
import { noteEvidence } from "./story.js";
import { GOAL_OPTIONS } from "./goals.js";
export const COMMAND_QUESTION = "Which lasting goal is explicitly requested? Choose none for questions, negations or unsupported tasks.";
export function commandInput(text) {
  // Classification needs the complete instruction. Feeding unrelated colony
  // needs/candidate schedules here can change the inferred intent. The selected
  // goal is grounded against actual world state afterward, by the goal planner.
  return { question: COMMAND_QUESTION, requiredContext: `Player command: ${text}.`, contextParts: [], maxTokens: 320, options: commandOptions(text) };
}
export function commandOptions(text) {
  // Explicit resources/entities constrain the possible project; the model still
  // decides whether a project is requested at all. Vague requests retain the full
  // vocabulary. Never turn an 80-Tripelkin target into an 80-block objective.
  const vocabulary = {
    care: /\b(?:care|healthy|fed|feed|food|wash|clean|happy|play|safe)\b/i,
    grow: /\b(?:grow|growth|multiply|reproduce|population)\b|\b(?:reach|to|of)\s+(?:\d[\d,.]*|[a-z-]+)\s+(?:tripelkins|creatures)\b/i,
    bridge: /\bbridge\b/i,
    wood: /\b(?:wood|logs?|timber|trees?|chop|cutting)\b/i,
    ore: /\b(?:ore|rocks?|stones?|quarry)\b/i,
    blocks: /\b(?:blocks?|cut stone)\b/i,
  };
  const mentioned = Object.keys(vocabulary).filter(kind => vocabulary[kind].test(text));
  return mentioned.length
    ? Object.fromEntries(Object.entries(GOAL_OPTIONS).filter(([kind]) => kind === "none" || mentioned.includes(kind)))
    : GOAL_OPTIONS;
}
export function informationQuestion(text) {
  return /(?:^|[,;.!?]\s*)\s*(?:how\s+(?:many|much|are|is|do|does|did|can)|what\s+(?:is|are|do|does|did|happened)|where\s+(?:is|are|do)|why\b|who\s+(?:is|are))\b/i.test(text);
}
export function parseConstraints(w, text, selected) {
  const listener = resolveListener(w, text, selected);
  if (listener.error) return { error: listener.error };
  const result = { listener: listener.id, changes: {}, negated: false };
  if (informationQuestion(text)) return { ...result, question: true };
  const stop =
    /\b(?:do not|don't|dont|stop|pause|hold off|not yet)\b[\s\S]{0,45}\b(?:build|building|work|working|haul|hauling|chop|chopping|cut|cutting|gather|gathering|quarry|quarrying|mine|mining|refine|refining|project|bridge)\b|\b(?:build|work|project)\b.{0,12}\bnot yet\b/i.test(
      text,
    );
  const resume =
    /\b(?:resume|continue|start again)\b.{0,30}\b(?:build|work|haul|chop|cutting|gather|quarry|mine|refine|project|bridge)/i.test(
      text,
    );
  if (stop) {
    result.changes.pauseWork = true;
    result.negated = true;
    result.reply =
      "We will hold that work. Eating, washing and play will continue.";
  }
  if (resume) {
    result.changes.pauseWork = false;
    result.reply =
      "We can return to the project while looking after one another.";
  }
  if (/\b(?:avoid|reduce|no|without|stop)\b.{0,18}\bpollution\b/i.test(text)) {
    result.changes.avoidPollution = true;
    result.reply =
      "We will hold factory work and keep caring for one another. You can clean the ground with the mop.";
  }
  if (/\b(?:allow|resume)\b.{0,12}\b(?:factory|pollution)/i.test(text))
    result.changes.avoidPollution = false;
  if (/\bkeep\b.{0,40}\b(?:fed|healthy|safe|clean)\b/i.test(text))
    result.changes.careFloor = 55;
  if (
    listener.id &&
    /\b(?:help|build|haul|mine|work|chop|cut|gather|quarry|refine|stop|pause|resume)\b/i.test(text)
  )
    result.changes.members = [listener.id];
  if (/\b(?:everyone|all of you|whole colony)\b/i.test(text))
    result.changes.members = [];
  if (/\b(?:east|west)\b.{0,12}\b(?:bank|side|region)\b/i.test(text))
    result.changes.region = { x: /\beast\b/i.test(text) ? 50 : 24, y: 25 };
  result.negated ||=
    /\b(?:do not|don't|dont|never|not)\b/i.test(text) &&
    !result.changes.careFloor;
  return result;
}
export function commitConstraints(w, result) {
  if (!Object.keys(result.changes).length) return;
  Object.assign(w.directives, result.changes);
  w.commandRevision++;
  w.revision++;
  if (result.changes.pauseWork || result.changes.avoidPollution)
    for (const c of w.creatures) {
      if (w.directives.members.length && !w.directives.members.includes(c.id))
        continue;
      if (
        (result.changes.pauseWork &&
          ["haul", "mine", "work", "orbit", "gather", "quarry", "refine", "construct"].includes(c.task)) ||
        (result.changes.avoidPollution && c.task === "work")
      ) {
        if (c.job) c.job.state = "cancelled";
        c.task = "idle";
        c.target = null;
        c.work = 0;
      }
    }
  noteEvidence(
    w,
    "autonomy",
    result.reply || "Agreed on boundaries for the current work.",
  );
}
