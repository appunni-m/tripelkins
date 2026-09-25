// Shared by the clearing and recovery previews; never changes a saved need.
export function colonyHealth(world) {
  const needs = ["fed", "clean", "amused"];
  const lowest = Object.fromEntries(
    needs.map((key) => [
      key,
      world.creatures.length
        ? Math.min(...world.creatures.map((c) => c[key]))
        : null,
    ]),
  );
  const atRisk = world.creatures.filter(
    (c) => Math.min(c.fed, c.clean, c.amused) < 20,
  );
  const critical = atRisk.filter(
    (c) => Math.min(c.fed, c.clean, c.amused) <= 0,
  );
  const urgent = needs.filter(
    (key) => lowest[key] !== null && lowest[key] < 20,
  );
  const help = {
    fed: "give bananas",
    clean: "use the cloth",
    amused: "place a cricket ball",
  };
  return {
    lowest,
    atRisk: atRisk.length,
    critical: critical.length,
    message: urgent.length
      ? `${atRisk.length} need care: ${urgent.map((key) => help[key]).join(", ")}.`
      : "",
  };
}
