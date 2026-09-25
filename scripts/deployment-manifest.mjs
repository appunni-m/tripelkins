import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const root = "dist";
async function walk(directory) {
  const files = [];
  for (const entry of await readdir(join(root, directory), {
    withFileTypes: true,
  })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (
      entry.isFile() &&
      !path.endsWith(".map") &&
      path !== "deployment-manifest.json"
    )
      files.push(path);
    else if (entry.isSymbolicLink())
      throw new Error(`Pages artifacts cannot contain symlinks: ${path}`);
  }
  return files.sort();
}
const files = await walk("");
if (!files.some(path=>/^assets\/tripelkins_engine_bg-[^/]+\.wasm$/.test(path)))
  throw new Error("Missing colony simulation WASM binary.");
const required = ["engine-verify.html", "index.html", "verify.html", "credits.html", "licenses/dependencies.txt", "licenses/rust-dependencies.txt"];
for (const [directory, suffixes] of [
  ["ort", ["", ".jsep", ".asyncify"]],
  ["ort-whisper", ["", ".asyncify"]],
])
  for (const suffix of suffixes)
    for (const extension of ["wasm", "mjs"])
      required.push(
        `${directory}/ort-wasm-simd-threaded${suffix}.${extension}`,
      );
for (const path of required)
  if (!files.includes(path))
    throw new Error(`Missing deployment file: ${path}`);
const assets = [];
for (const path of files) {
  const data = await readFile(join(root, path));
  if (
    path.endsWith(".wasm") &&
    data.subarray(0, 4).toString("hex") !== "0061736d"
  )
    throw new Error(`Invalid WASM binary: ${path}`);
  if (
    path.endsWith(".html") &&
    /(?:src|href)="\//.test(data.toString())
  )
    throw new Error(`An HTML asset uses a root-relative URL: ${path}`);
  assets.push({
    path,
    bytes: (await stat(join(root, path))).size,
    sha256: createHash("sha256").update(data).digest("hex"),
  });
}
const totalBytes = assets.reduce((sum, item) => sum + item.bytes, 0);
if (totalBytes > 1000000000)
  throw new Error("Published assets exceed the GitHub Pages site limit.");
let commit = process.env.GITHUB_SHA;
if (!commit) {
  try {
    commit = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    commit = "uncommitted";
  }
}
await writeFile(
  join(root, "deployment-manifest.json"),
  JSON.stringify(
    {
      commit,
      builtAt: new Date().toISOString(),
      base: "./",
      totalBytes,
      assets,
    },
    null,
    2,
  ),
);
console.log(
  `Verified ${assets.length} build assets, ${(totalBytes / 1048576).toFixed(1)} MiB. Wrote deployment-manifest.json.`,
);
