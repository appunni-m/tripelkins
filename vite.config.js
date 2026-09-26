import { defineConfig } from "vite";
import { randomBytes } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

const buildId = [
  process.env.GITHUB_RUN_ID,
  process.env.GITHUB_RUN_ATTEMPT,
  randomBytes(8).toString("hex"),
]
  .filter(Boolean)
  .join("-");
const assetFileNames = `assets/[name]-[hash]-${buildId}[extname]`;
const chunkFileNames = `assets/[name]-[hash]-${buildId}.js`;
const outputFileNames = {
  assetFileNames,
  chunkFileNames,
  entryFileNames: chunkFileNames,
};
const versionedPublicRoot = `assets/${buildId}/public`;

async function versionPublicAssets() {
  const outputRoot = "dist";
  const versionedRoot = join(outputRoot, versionedPublicRoot);
  await mkdir(versionedRoot, { recursive: true });

  for (const name of [
    "apple-touch-icon.png",
    "favicon.ico",
    "favicon.svg",
    "licenses",
    "ort",
    "ort-whisper",
  ])
    await rename(join(outputRoot, name), join(versionedRoot, name));

  for (const name of await readdir(outputRoot)) {
    if (!name.endsWith(".html")) continue;
    const path = join(outputRoot, name);
    let html = await readFile(path, "utf8");
    html = html
      .replaceAll("./favicon.ico", `./${versionedPublicRoot}/favicon.ico`)
      .replaceAll("./favicon.svg", `./${versionedPublicRoot}/favicon.svg`)
      .replaceAll(
        "./apple-touch-icon.png",
        `./${versionedPublicRoot}/apple-touch-icon.png`,
      )
      .replaceAll(
        'href="licenses/',
        `href="${versionedPublicRoot}/licenses/`,
      );
    await writeFile(path, html);
  }

  await writeFile(join(outputRoot, ".asset-build-id"), buildId);
}

function removeBundledRuntimeCopies() {
  return {
    name: "remove-bundled-onnx-wasm-copies",
    apply: "build",
    async closeBundle() {
      const assetsDir = "dist/assets";
      const emitted = (await readdir(assetsDir)).filter((name) =>
        name.startsWith("ort-") && name.endsWith(".wasm"),
      );
      for (const name of emitted)
        await rm(join(assetsDir, name), { force: true });
      if (emitted.length)
        console.log(
          `Removed ${emitted.length} unused bundled ONNX WASM file(s).`,
        );
      await versionPublicAssets();
    },
  };
}

export default defineConfig({
  // Relative URLs let the same build work at GitHub Pages' project path and
  // at the root of a custom domain.
  base: "./",
  define: { __TRIPELKINS_BUILD_ID__: JSON.stringify(buildId) },
  plugins: [removeBundledRuntimeCopies()],
  // Carry a fresh immutable URL through page assets and separately bundled
  // module workers on every build.
  worker: { rolldownOptions: { output: outputFileNames } },
  build: {
    target: "es2022",
    // Keep debug builds available without publishing source maps to every site.
    sourcemap: process.env.BUILD_SOURCEMAPS === "true",
    rolldownOptions: {
      output: {
        ...outputFileNames,
        // Keep the renderer's content hash independent of changing game code.
        // Returning players can reuse this large, unchanged download.
        codeSplitting: {
          groups: [{ name: "three", test: /node_modules\/three\// }],
        },
      },
      input: {
        game: "index.html",
        verification: "verify.html",
        review: "review.html",
        performance: "performance.html",
        engine: "engine-verify.html",
      },
    },
  },
});
