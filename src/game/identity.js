import { given, beginnings, endings } from "./name-data.js";
export const DICTIONARY_SIZE = 16384;
const parts = (text) =>
  [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(text)].map(
    (s) => s.segment,
  );
export function dictionaryName(index) {
  const i = ((index % DICTIONARY_SIZE) + DICTIONARY_SIZE) % DICTIONARY_SIZE;
  return `${given[Math.floor(i / 256)]} ${beginnings[Math.floor(i / 16) % 16]}${endings[i % 16]}`;
}
export function identity(w, parent = null) {
  const ordinal = w.nextBirth++,
    index = (ordinal * 7919 + (w.map.seed % DICTIONARY_SIZE)) % DICTIONARY_SIZE;
  const generation = Math.floor(ordinal / DICTIONARY_SIZE);
  let name = dictionaryName(index) + (generation ? ` ${generation + 1}` : "");
  // A custom name may occupy an automatic name before its ordinal is born.
  if (
    w.creatures.some(
      (c) => c.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
    )
  )
    name += ` · ${ordinal + 1}`;
  const hash = (n) =>
    ((Math.imul(ordinal + 1, n) ^ w.map.seed) >>> 0) / 4294967296;
  return {
    identityVersion: 1,
    birthOrdinal: ordinal,
    dictionaryVersion: 1,
    nameIndex: index,
    name,
    customName: null,
    parentId: parent?.id || null,
    birthTick: w.time,
    traits: {
      curiosity: hash(1597334677),
      sociability: hash(3812015801),
      diligence: hash(958282573),
    },
    encounters: [],
    relationships: [],
    favorite: false,
  };
}
export function renameCreature(w, c, text) {
  const name = String(text)
    .normalize("NFC")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .trim()
    .replace(/\s+/g, " ");
  if (!name) return { error: "Give them a name first." };
  if (parts(name).length > 30)
    return { error: "Choose a name with at most 30 characters." };
  if (
    w.creatures.some(
      (o) =>
        o.id !== c.id &&
        o.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
    )
  )
    return { error: "Someone here already has that name." };
  const old = c.name;
  c.name = name;
  c.customName = name;
  w.commandRevision++;
  w.revision++;
  return { old, name };
}
export function resolveListener(w, text, selected) {
  const t = text.toLocaleLowerCase(),
    full = w.creatures.filter((c) => t.includes(c.name.toLocaleLowerCase()));
  if (full.length === 1) return { id: full[0].id };
  const first = w.creatures.filter((c) =>
    new RegExp(
      `\\b${c.name.split(" ")[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
      "i",
    ).test(text),
  );
  const found = full.length ? full : first;
  if (found.length > 1 && found.some((c) => c.id === selected))
    return { id: selected };
  if (found.length > 1)
    return {
      error: `Which one do you mean: ${found
        .slice(0, 3)
        .map((c) => c.name)
        .join(", ")}? Select one of us and try again.`,
    };
  return {
    id:
      found[0]?.id ||
      (w.creatures.some((c) => c.id === selected) ? selected : null),
  };
}
export function encounter(c, kind, other, tick) {
  c.encounters.push({ kind, other, tick });
  c.encounters = c.encounters.slice(-8);
  if (!other) return;
  let bond = c.relationships.find((r) => r.id === other);
  if (!bond) {
    bond = { id: other, affinity: 0, last: tick };
    c.relationships.push(bond);
  }
  bond.affinity = Math.max(
    -10,
    Math.min(10, bond.affinity + (kind === "loss" ? -1 : 1)),
  );
  bond.last = tick;
  c.relationships.sort((a, b) => b.last - a.last);
  c.relationships = c.relationships.slice(0, 4);
}
