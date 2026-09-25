import { createRequire } from "node:module";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// Include the browser libraries and their JS dependencies, even when a library
// bundles a dependency internally. Native Node backends are not shipped.
const excluded = new Set(["onnxruntime-node", "sharp", "@types/node"]);
const seen = new Set(), sections = [];
async function collect(name, from = join(process.cwd(), "package.json")) {
  if (excluded.has(name)) return;
  const resolve = createRequire(from);
  let directory = dirname(resolve.resolve(name)), pkg;
  while (directory !== dirname(directory)) {
    try {
      pkg = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
      if (pkg.name === name) break;
    } catch {}
    directory = dirname(directory);
  }
  if (pkg?.name !== name) throw new Error(`Cannot locate license metadata: ${name}`);
  const key = `${name}@${pkg.version}`;
  if (seen.has(key)) return;
  seen.add(key);
  let licenses = (await readdir(directory)).filter(file => /^(?:licen[cs]e|copying|notice)(?:[.-]|$)/i.test(file));
  const texts = [];
  for (const file of licenses) texts.push(`${file}\n${await readFile(join(directory, file), "utf8")}`);
  if (name.startsWith("onnxruntime-")) {
    if (!/^(?:1\.30\.0|1\.31\.0-dev\.202609(?:11-2a43ec07e|14-8d85527a0))$/.test(pkg.version))
      throw new Error(`Refresh pinned ONNX license notices for ${key}.`);
    texts.push(await readFile("public/licenses/onnxruntime-LICENSE.txt", "utf8"));
  }
  if (!texts.length) throw new Error(`No license text found for browser dependency ${key}`);
  sections.push(`${key}\nDeclared license: ${pkg.license}\n${texts.join("\n\n")}`);
  // We import ORT's /wasm and /webgpu entry points. Its /webgl dependencies
  // (including guid-typescript and protobufjs) are not bundled in these paths.
  const dependencies = name === "onnxruntime-web" ? ["onnxruntime-common"] : Object.keys(pkg.dependencies || {});
  for (const dependency of dependencies)
    await collect(dependency, join(directory, "package.json"));
}
for (const name of ["three", "@huggingface/transformers", "onnxruntime-web"]) await collect(name);
await mkdir("public/licenses", { recursive: true });
await writeFile("public/licenses/dependencies.txt",
  "TRIPELKINS — BROWSER DEPENDENCY NOTICES\nGenerated from installed package license files.\nNative Node inference/image backends are not distributed in this browser app.\nAdditional runtime, font and model notices are linked from credits.html.\n\n" + sections.join("\n\n========================================\n\n") + "\n");
console.log(`Prepared notices for ${seen.size} browser dependency versions.`);
