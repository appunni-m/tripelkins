import { noteEvidence } from "./story.js";
export const MAX_POPULATION = 1e15;
export function syncPopulation(w) {
  const room = MAX_POPULATION - w.creatures.length;
  w.cohort = Math.max(0, Math.min(room, Math.floor(w.cohort)));
  w.orbital.population = Math.max(0,
    Math.min(room - w.cohort, Math.floor(w.orbital.population)));
  w.population = w.creatures.length + w.cohort + w.orbital.population;
}
export function launch(w, c, remember) {
  if (w.creatures.length <= 8) return false;
  if (c.carry) {
    w.inventory[c.cargoKind || "wood"] += c.carry;
    c.carry = 0;
  }
  w.creatures = w.creatures.filter((o) => o.id !== c.id);
  w.orbital.population++;
  w.orbital.launches++;
  w.orbital.lastLaunch = w.time;
  const cannon = w.objects.find((o) => o.type === "cannon");
  if (cannon) cannon.phase = w.time;
  w.departed.push({ id: c.id, name: c.name, cause: "orbit", tick: w.time });
  w.departed = w.departed.slice(-32);
  noteEvidence(w, "launches", `${c.name} left for orbit.`, 1, c.id);
  remember(w, "launch", `${c.name} is part of the orbital collective.`, c.id);
  syncPopulation(w);
  return true;
}
export function stepCohorts(w, dt) {
  const orbital = w.orbital;
  orbital.fraction = 0;
  if (orbital.population > 0 && w.stage === 2) {
    // Residents here are actual arrivals. Time passing must not add people.
    const energy = orbital.population * 0.025 * dt;
    w.progress.energy = Math.min(MAX_POPULATION, w.progress.energy + energy);
    orbital.energy = Math.min(MAX_POPULATION, orbital.energy + energy);
  }
  const homes = w.objects
    .filter((o) => o.type === "dwelling")
    .reduce((s, o) => s + o.level * 48, 0);
  w.district.capacity = homes;
  w.district.population = w.cohort;
  if (w.cohort > 0) {
    const supported = Math.min(w.cohort, homes),
      unsupported = Math.max(0, w.cohort - supported);
    w.district.health = Math.max(
      0,
      Math.min(100, w.district.health + dt * (unsupported ? -0.15 : 0.2)),
    );
    const growth = supported * 0.003 * dt + w.district.fraction,
      births = Math.min(Math.floor(growth), Math.max(0, homes - w.cohort),
        // Keep district births within the shared census capacity.
        Math.max(0, MAX_POPULATION - w.creatures.length - w.cohort - orbital.population));
    w.district.fraction = growth - Math.floor(growth);
    w.cohort += births;
    if (unsupported && w.district.health === 0) {
      const lost = Math.min(
        unsupported,
        Math.floor(unsupported * 0.005 * dt + w.district.lossFraction),
      );
      w.district.lossFraction =
        (unsupported * 0.005 * dt + w.district.lossFraction) % 1;
      w.cohort -= lost;
      if (lost) {
        noteEvidence(
          w,
          "neglect",
          `${lost} unrepresented residents were lost without housing.`,
          lost,
        );
        noteEvidence(
          w,
          "deaths",
          `${lost} district residents died from unmet needs.`,
          lost,
        );
      }
    }
  }
  syncPopulation(w);
  refreshDistrict(w);
}
export function refreshDistrict(w) {
  const homes = w.objects
    .filter((o) => o.type === "dwelling")
    .reduce((s, o) => s + o.level * 48, 0);
  w.district.capacity = homes;
  const supported = Math.min(w.cohort, homes),
    unsupported = Math.max(0, w.cohort - supported);
  w.district.population = w.cohort;
  w.district.healthCounts = {
    healthy: supported,
    unwell: w.district.health > 0 ? unsupported : 0,
    critical: w.district.health === 0 ? unsupported : 0,
  };
  w.district.allocations = {
    care: Math.ceil(supported / 8),
    rest: Math.max(0, w.cohort - Math.ceil(supported / 8)),
  };
  w.district.rates = {
    births: w.cohort < homes ? supported * 0.003 : 0,
    deaths: w.district.health === 0 ? unsupported * 0.005 : 0,
    energy: 0,
  };
}
