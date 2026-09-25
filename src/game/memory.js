// Deterministic memory compaction. Old prose is never used to reconstruct state.
export const MEMORY_LIMITS = Object.freeze({ commands: 96, milestones: 24 });
const count = (value, max = 1e15) =>
  Number.isFinite(Number(value))
    ? Math.min(max, Math.max(0, Number(value)))
    : 0;
const statuses = ["pending", "completed", "failed", "cancelled", "interrupted"];
const text = (value, max) => String(value ?? "").slice(0, max);
export function normalizeMemory(raw = {}) {
  const commands = (Array.isArray(raw.commands) ? raw.commands : [])
    .slice(-MEMORY_LIMITS.commands)
    .filter((c) => c && typeof c.id === "string" && typeof c.text === "string")
    .map((c) => ({
      id: text(c.id, 60),
      text: text(c.text, 500),
      reply: text(c.reply, 500),
      status: statuses.includes(c.status) ? c.status : "interrupted",
      channel: c.channel === "voice" ? "voice" : "typed",
      tick: count(c.tick, 1e12),
      at: text(c.at, 32),
      source: text(c.source, 80),
      goalId: c.goalId ? text(c.goalId, 40) : null,
      listener: c.listener ? text(c.listener, 40) : null,
    }));
  const summary = raw.summary || {};
  return {
    commands,
    summary: {
      eventsCompacted: count(summary.eventsCompacted),
      commandsCompacted: count(summary.commandsCompacted),
      throughTick: count(summary.throughTick, 1e12),
      milestones: (Array.isArray(summary.milestones) ? summary.milestones : [])
        .slice(-MEMORY_LIMITS.milestones)
        .map((m) => ({
          tick: count(m.tick, 1e12),
          kind: text(m.kind, 40),
          message: text(m.message, 220),
        })),
    },
  };
}
export function compactEvents(memory, events) {
  const summary = memory.summary;
  for (const event of events) {
    summary.eventsCompacted = Math.min(1e15, summary.eventsCompacted + 1);
    summary.throughTick = Math.max(summary.throughTick, event.tick);
    if (
      [
        "goal",
        "goal-complete",
        "goal-change",
        "choice",
        "sacrifice",
        "build",
        "upgrade",
        "hatch",
        "bridge",
        "monolith",
        "ending",
        "migration",
        "recovery",
      ].includes(event.kind)
    )
      summary.milestones.push({
        tick: event.tick,
        kind: event.kind,
        message: event.message,
      });
  }
  summary.milestones = summary.milestones.slice(-MEMORY_LIMITS.milestones);
}
export function beginCommand(world, value, channel, listener) {
  const command = {
    id: crypto.randomUUID(),
    text: text(value, 500),
    reply: "",
    status: "pending",
    channel,
    tick: world.time,
    at: new Date().toISOString(),
    source: "",
    goalId: null,
    listener: listener ? text(listener, 40) : null,
  };
  world.memory.commands.push(command);
  const excess = world.memory.commands.length - MEMORY_LIMITS.commands;
  if (excess > 0) {
    world.memory.commands.splice(0, excess);
    world.memory.summary.commandsCompacted += excess;
  }
  world.revision++;
  return command;
}
export function interruptCommands(world) {
  for (const command of world.memory.commands)
    if (command.status === "pending") command.status = "interrupted";
  return world;
}
