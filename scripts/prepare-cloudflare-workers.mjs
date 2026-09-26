import {
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { dirname, join, relative, resolve, sep } from "node:path";

const maximumAssetBytes = 25 * 1024 * 1024;
const sourceRoot = resolve(process.argv[2] || "dist");
const outputRoot = resolve(process.argv[3] || "cloudflare-workers");

if (
  outputRoot === sourceRoot ||
  outputRoot.startsWith(`${sourceRoot}${sep}`) ||
  sourceRoot.startsWith(`${outputRoot}${sep}`)
)
  throw new Error("Input and output directories must be separate.");

const manifest = JSON.parse(
  await readFile(join(sourceRoot, "deployment-manifest.json"), "utf8"),
);
if (!Array.isArray(manifest.assets))
  throw new Error("Build manifest has no assets array.");

await rm(outputRoot, { recursive: true, force: true });
await cp(sourceRoot, outputRoot, { recursive: true, errorOnExist: true });
await writeFile(
  join(outputRoot, "_worker.js"),
  await readFile(new URL("../worker.js", import.meta.url), "utf8"),
);
await writeFile(join(outputRoot, ".assetsignore"), "_worker.js\n");
const brotliAssets = [];
const gzipAssets = [];
let deployedBytes = 0;
for (const asset of manifest.assets) {
  if (
    typeof asset.path !== "string" ||
    asset.path.startsWith("/") ||
    asset.path.includes("\\") ||
    asset.path.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error(`Unsafe path in build manifest: ${asset.path}`);

  const inputPath = join(sourceRoot, asset.path);
  const bytes = await readFile(inputPath);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (bytes.length !== asset.bytes || digest !== asset.sha256)
    throw new Error(`Build manifest does not match ${asset.path}`);

  if (asset.path.endsWith(".wasm")) {
    const brotli = brotliCompressSync(bytes, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 5 },
    });
    const gzip = gzipSync(bytes, { level: 9 });
    for (const [encoding, data, suffix, records] of [
      ["Brotli", brotli, ".br", brotliAssets],
      ["gzip", gzip, ".gz", gzipAssets],
    ]) {
      if (data.length > maximumAssetBytes)
        throw new Error(`${encoding} output still exceeds 25 MiB: ${asset.path}`);
      const encodedPath = `${asset.path}${suffix}`;
      const outputPath = join(outputRoot, encodedPath);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, data);
      records.push({
        path: asset.path,
        encodedPath,
        bytes: data.length,
        sha256: createHash("sha256").update(data).digest("hex"),
      });
      deployedBytes += data.length;
      console.log(`${encoding} ${asset.path}: ${bytes.length} -> ${data.length} bytes`);
    }
    await unlink(join(outputRoot, asset.path));
  } else {
    if (bytes.length > maximumAssetBytes)
      throw new Error(`Non-WASM Worker asset exceeds 25 MiB: ${asset.path}`);
    deployedBytes += bytes.length;
  }
}

const headerRules = [
  "/*",
  "  X-Content-Type-Options: nosniff",
  "  Referrer-Policy: strict-origin-when-cross-origin",
  "  Permissions-Policy: camera=(), geolocation=(), microphone=(self)",
  "",
  "/assets/*",
  "  Cache-Control: public, max-age=31536000, immutable",
  "",
  "/ort/*",
  "  Cache-Control: public, max-age=86400",
  "",
  "/ort-whisper/*",
  "  Cache-Control: public, max-age=86400",
  "",
  "/deployment-manifest.json",
  "  Cache-Control: public, max-age=0, must-revalidate",
  "",
];
await writeFile(join(outputRoot, "_headers"), `${headerRules.join("\n")}\n`);

const workerManifest = {
  ...manifest,
  totalBytes: deployedBytes,
  sourceTotalBytes: manifest.totalBytes,
  delivery: {
    platform: "Cloudflare Workers Static Assets",
    compression: ["brotli", "gzip"],
    brotliAssets,
    gzipAssets,
  },
};
await writeFile(
  join(outputRoot, "deployment-manifest.json"),
  JSON.stringify(workerManifest, null, 2),
);

async function findOversizedFiles(directory) {
  const oversized = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) oversized.push(...(await findOversizedFiles(path)));
    else if (entry.isSymbolicLink())
      throw new Error(`Cloudflare Worker assets cannot contain symlinks: ${path}`);
    else if ((await stat(path)).size > maximumAssetBytes)
      oversized.push(relative(outputRoot, path));
  }
  return oversized;
}

const oversized = await findOversizedFiles(outputRoot);
if (oversized.length)
  throw new Error(`Files exceed Cloudflare Workers' 25 MiB limit: ${oversized.join(", ")}`);

console.log(
  `Prepared ${outputRoot} with ${brotliAssets.length} Brotli and ${gzipAssets.length} gzip WASM asset(s); ${manifest.totalBytes} -> ${deployedBytes} bytes.`,
);
