// Exact persisted state transitions. No replay of physics or model calls.
export const TIMELINE_LIMITS = Object.freeze({
  frames: 120,
  branches: 4,
  bytes: 8 * 1024 * 1024,
});
const clone = (value) => structuredClone(value);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;
const safeKey = (key) =>
  !["__proto__", "prototype", "constructor"].includes(key);
function diff(before, after, path = [], changes = []) {
  if (equal(before, after)) return changes;
  if (
    before &&
    after &&
    !Array.isArray(before) &&
    !Array.isArray(after) &&
    typeof before === "object" &&
    typeof after === "object"
  ) {
    for (const key of new Set([
      ...Object.keys(before),
      ...Object.keys(after),
    ])) {
      if (!safeKey(key)) continue;
      if (!Object.hasOwn(after, key))
        changes.push({ path: [...path, key], remove: true });
      else diff(before[key], after[key], [...path, key], changes);
    }
  } else changes.push({ path, value: clone(after) });
  return changes;
}
function apply(world, patch) {
  for (const change of patch) {
    if (!change.path.length || change.path.some((key) => !safeKey(key)))
      throw new Error("Invalid history change.");
    let target = world;
    for (const key of change.path.slice(0, -1)) {
      if (
        !Object.hasOwn(target, key) ||
        !target[key] ||
        typeof target[key] !== "object"
      )
        throw new Error("Incomplete history.");
      target = target[key];
    }
    const key = change.path.at(-1);
    if (change.remove) delete target[key];
    else target[key] = clone(change.value);
  }
  return world;
}
export function readMoment(branch, id) {
  const world = clone(branch.base.world);
  if (id === branch.base.id) return world;
  for (const frame of branch.frames) {
    apply(world, frame.patch);
    if (frame.id === id) return world;
  }
  throw new Error("That moment is no longer in the retained history.");
}
export function latestWorld(branch) {
  return readMoment(branch, branch.frames.at(-1)?.id || branch.base.id);
}
function advanceBase(branch) {
  const frame = branch.frames.shift();
  branch.base = {
    id: frame.id,
    at: frame.at,
    world: apply(branch.base.world, frame.patch),
  };
  branch.compacted++;
}
export function appendTimeline(input, previous, record, replacement = false) {
  const history = input
    ? clone(input)
    : { schema: 1, version: 0, branches: [] };
  if (history.schema !== 1)
    throw new Error("This history needs a newer game version.");
  let branch = history.branches.at(-1);
  const stateChanged =
    !previous ||
    !equal({ ...previous, savedAt: null }, { ...record, savedAt: null });
  if (!branch || replacement) {
    // The previous branch retains its future; a rewind always starts a new branch.
    if (branch && replacement && previous) appendFrame(branch, previous);
    branch = {
      id: crypto.randomUUID(),
      startedAt: record.savedAt,
      compacted: 0,
      previousPath: history.branches.at(-1)?.id || null,
      restoredFrom: replacement?.origin || null,
      base: {
        id: crypto.randomUUID(),
        at: record.savedAt,
        world: clone(record),
      },
      frames: [],
    };
    history.branches.push(branch);
  } else if (stateChanged) appendFrame(branch, record, previous);
  history.version++;
  for (const item of history.branches)
    while (item.frames.length > TIMELINE_LIMITS.frames) advanceBase(item);
  history.branches = history.branches.slice(-TIMELINE_LIMITS.branches);
  // Count and byte bounds: always advance the base before discarding a delta.
  while (bytes(history) > TIMELINE_LIMITS.bytes) {
    const oldest = history.branches[0];
    if (oldest.frames.length) advanceBase(oldest);
    else if (history.branches.length > 1) history.branches.shift();
    else
      throw new Error(
        "This world is too large for its history budget. Download a copy.",
      );
  }
  return history;
}
function appendFrame(branch, world, previous) {
  const before = previous || latestWorld(branch);
  if (equal({ ...before, savedAt: null }, { ...world, savedAt: null })) return;
  branch.frames.push({
    id: crypto.randomUUID(),
    at: world.savedAt,
    tick: world.time,
    population: world.population,
    patch: diff(before, world),
  });
}
export function historySize(history) {
  return history ? bytes(history) : 0;
}
