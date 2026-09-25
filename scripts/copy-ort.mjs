import { copyFile, mkdir, readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
async function copyIfChanged(source, destination) {
  const content = await readFile(source);
  try {
    if (content.equals(await readFile(destination))) return;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  // Avoid notifying Vite's public-file watcher for identical runtime files.
  await copyFile(source, destination);
}
const distDir = dirname(require.resolve("onnxruntime-web"));
const outputDir = new URL("../public/ort/", import.meta.url).pathname;
await mkdir(outputDir, { recursive: true });
const isRuntime = (name) =>
  /^ort-wasm-simd-threaded(?:\.jsep|\.asyncify)?\.(wasm|mjs)$/.test(name);
const runtimeFiles = (await readdir(distDir)).filter(isRuntime);
if (runtimeFiles.length !== 6) {
  throw new Error(
    `Expected ONNX Runtime's WASM and loader files, found: ${runtimeFiles.join(", ") || "none"}`,
  );
}
for (const name of runtimeFiles)
  await copyIfChanged(join(distDir, name), join(outputDir, name));
console.log(`Prepared ONNX Runtime WebAssembly files in ${outputDir}`);
// Resolve from Transformers itself: its runtime version may differ from Laya's.
const transformerRequire = createRequire(
  require.resolve("@huggingface/transformers"),
);
const whisperDist = dirname(transformerRequire.resolve("onnxruntime-web"));
const whisperOutput = new URL("../public/ort-whisper/", import.meta.url)
  .pathname;
await mkdir(whisperOutput, { recursive: true });
for (const suffix of ["", ".asyncify"])
  for (const extension of ["wasm", "mjs"]) {
    const name = `ort-wasm-simd-threaded${suffix}.${extension}`;
    await copyIfChanged(join(whisperDist, name), join(whisperOutput, name));
  }
console.log(
  `Prepared Whisper's matching ONNX Runtime files in ${whisperOutput}`,
);
