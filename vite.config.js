import { defineConfig } from "vite";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";

function removeBundledRuntimeCopies() {
  return {
    name: "remove-bundled-onnx-wasm-copies",
    apply: "build",
    async closeBundle() {
      const assetsDir = "dist/assets";
      const emitted = (await readdir(assetsDir)).filter((name) =>
        name.endsWith(".wasm"),
      );
      for (const name of emitted)
        await rm(join(assetsDir, name), { force: true });
      if (emitted.length)
        console.log(
          `Removed ${emitted.length} unused bundled ONNX WASM file(s).`,
        );
    },
  };
}

export default defineConfig({
  // Relative URLs let the same build work at GitHub Pages' project path and
  // at the root of a custom domain.
  base: "./",
  plugins: [removeBundledRuntimeCopies()],
  build: {
    target: "es2022",
    sourcemap: true,
    rolldownOptions: {
      input: {
        game: "index.html",
        verification: "verify.html",
        review: "review.html",
        performance: "performance.html",
      },
    },
  },
});
