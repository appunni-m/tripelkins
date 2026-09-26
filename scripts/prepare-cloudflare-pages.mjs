import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { brotliCompressSync, constants } from "node:zlib";
import { dirname, join, relative, resolve, sep } from "node:path";

const maximumAssetBytes = 25 * 1024 * 1024;
const sourceRoot = resolve(process.argv[2] || "dist");
const outputRoot = resolve(process.argv[3] || "cloudflare-pages-brotli");

if (
  outputRoot === sourceRoot ||
  outputRoot.startsWith(`${sourceRoot}${sep}`) ||
  sourceRoot.startsWith(`${outputRoot}${sep}`)
)
  throw new Error("Input and output directories must be separate.");

try {
  await stat(outputRoot);
  throw new Error(`Output directory already exists: ${outputRoot}`);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const manifest = JSON.parse(
  await readFile(join(sourceRoot, "deployment-manifest.json"), "utf8"),
);
if (!Array.isArray(manifest.assets))
  throw new Error("Build manifest has no assets array.");

await cp(sourceRoot, outputRoot, { recursive: true, errorOnExist: true });
const encodedPaths = [];
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

  if (bytes.length <= maximumAssetBytes) continue;
  if (!asset.path.endsWith(".wasm"))
    throw new Error(`Oversized non-WASM Pages asset: ${asset.path}`);

  const compressed = brotliCompressSync(bytes, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 5 },
  });
  if (compressed.length > maximumAssetBytes)
    throw new Error(`Brotli output still exceeds 25 MiB: ${asset.path}`);

  const outputPath = join(outputRoot, asset.path);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, compressed);
  encodedPaths.push(asset.path);
  console.log(
    `Brotli ${asset.path}: ${bytes.length} -> ${compressed.length} bytes`,
  );
}

const headerRules = encodedPaths.flatMap((path) => [
  `/${path}`,
  "  Content-Type: application/wasm",
  "  Content-Encoding: br",
  "  Cache-Control: public, max-age=86400, no-transform",
  "",
]);
await writeFile(join(outputRoot, "_headers"), `${headerRules.join("\n")}\n`);

async function findOversizedFiles(directory) {
  const oversized = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) oversized.push(...(await findOversizedFiles(path)));
    else if (entry.isSymbolicLink())
      throw new Error(`Cloudflare Pages assets cannot contain symlinks: ${path}`);
    else if ((await stat(path)).size > maximumAssetBytes)
      oversized.push(relative(outputRoot, path));
  }
  return oversized;
}

const oversized = await findOversizedFiles(outputRoot);
if (oversized.length)
  throw new Error(`Files exceed Cloudflare Pages' 25 MiB limit: ${oversized.join(", ")}`);

console.log(
  `Prepared ${outputRoot} with ${encodedPaths.length} Brotli-encoded WASM asset(s).`,
);
