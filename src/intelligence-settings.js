export const DECISION_SPEEDS = Object.freeze([
  { id: "slow", label: "Slow", schedule: 30, development: 60 },
  { id: "medium", label: "Med", schedule: 12, development: 30 },
  { id: "fast", label: "Fast", schedule: 6, development: 15 },
  { id: "extra-fast", label: "Extra fast", schedule: 3, development: 8 },
]);
export const MAX_INTELLIGENCE_WORKERS = 3;
export function decisionPace(settings = {}) {
  return DECISION_SPEEDS.find(p => p.id === settings.decisionSpeed) || DECISION_SPEEDS[1];
}
export function intelligenceWorkers(settings = {}) {
  const count = Number(settings.intelligenceWorkers);
  return Number.isFinite(count) ? Math.max(1, Math.min(MAX_INTELLIGENCE_WORKERS, Math.round(count))) : 1;
}
