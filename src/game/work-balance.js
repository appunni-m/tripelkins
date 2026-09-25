// Simulation seconds. Recovery takes seconds; comfortable needs last minutes.
export const NEED_DECAY = Object.freeze({ fed: 0.08, clean: 0.05, amused: 0.065 });
export const CARE_START = 68;
export const USEFUL_TASKS = new Set(["haul", "mine", "work", "orbit", "explore", "clean", "gather", "quarry", "refine", "construct"]);
export const working = c => USEFUL_TASKS.has(c.task) && c.job &&
  !["completed", "cancelled", "blocked"].includes(c.job.state);
// Least recently offered useful work goes first. The ordinal only breaks ties
// for new residents; it never pins someone to the front of the queue forever.
export const workOrder = (a, b) => (a.lastWorkTurn || 0) - (b.lastWorkTurn || 0) || a.birthOrdinal - b.birthOrdinal;
export const workRole = (w, c) => (c.birthOrdinal + (c.workCycles || 0) + Math.floor(w.time / 60)) % 4;
export function recordWork(w, c) {
  w.community.workTurn = (w.community.workTurn || 0) + 1;
  c.lastWorkTurn = w.community.workTurn;
}
