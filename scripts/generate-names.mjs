// Generated names for the individual-identity system. No model/download.
// Keep this order stable: future saves will refer to the version and entry index.
import { mkdir, writeFile } from "node:fs/promises";

import { given, beginnings, endings } from "../src/game/name-data.js";
const names = given.flatMap((first) =>
  beginnings.flatMap((start) =>
    endings.map((end) => `${first} ${start}${end}`),
  ),
);
// Generation must fail rather than publish a dictionary with unstable collisions.
if (names.length !== 16384 || new Set(names).size !== names.length)
  throw new Error("Name dictionary must contain 16,384 distinct entries.");
if (names.some((name) => name.length > 30))
  throw new Error("Names must fit the existing save's 30-character allowance.");
const directory = new URL("../docs/resources/", import.meta.url);
await mkdir(directory, { recursive: true });
const text = `${names.join("\n")}\n`;
await writeFile(new URL("tripelkin-names-v1.txt", directory), text);
console.log(
  `Generated ${names.length.toLocaleString()} names (${Buffer.byteLength(text)} bytes).`,
);
