import { env, pipeline } from "@huggingface/transformers";
import { VOICE_MODEL, voiceBackend, isVoiceFile } from "./model.js";
import { runtimeRoot } from "../runtime-paths.js";

env.allowLocalModels = false;
env.useBrowserCache = true;
env.useFSCache = false;
env.cacheKey = VOICE_MODEL.cache;
env.experimental_useCrossOriginStorage = false;
// Transformers checks CacheStorage before env.fetch. Never fetch missing
// model files during a background wake or an inference retry.
let allowDownload = false;
let cacheMiss = false;
env.fetch = (url, options) => {
  if (!allowDownload) {
    cacheMiss = true;
    // Missing optional configurations must remain optional. Transformers treats
    // this as a local miss; required files fail without any network transfer.
    return Promise.resolve(new Response(null, { status: 404 }));
  }
  return fetch(url, options);
};
const wasm = env.backends.onnx.wasm;
wasm.numThreads = 1;
wasm.proxy = false;
// Transformers and Laya use different ORT versions. Keep their loaders paired
// with the corresponding WASM binaries, including the Safari compatibility path.
const suffix = wasm.wasmPaths?.mjs?.includes(".asyncify") ? ".asyncify" : "";
const root = runtimeRoot("ort-whisper", import.meta.url,
  import.meta.env.DEV, import.meta.env.BASE_URL);
wasm.wasmPaths = {
  mjs: new URL(`ort-wasm-simd-threaded${suffix}.mjs`, root).href,
  wasm: new URL(`ort-wasm-simd-threaded${suffix}.wasm`, root).href,
};
let transcriber;
let loadedBackend;
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    const { id, kind, backend } = data;
    try {
      if (kind === "load") {
        const config = voiceBackend(backend);
        allowDownload = data.allowDownload === true;
        cacheMiss = false;
        const estimate = await navigator.storage?.estimate?.();
        const cached = await caches.open(env.cacheKey);
        const names = (await cached.keys()).map((entry) => entry.url);
        const missing = config.files.filter(
          (file) => !names.some((url) => isVoiceFile(url, file.name)),
        );
        // Reserve space for missing weights/support files and the saved world.
        const downloadMB = missing.length
          ? missing.reduce((sum, file) => sum + file.megabytes, 0) + 44
          : 0;
        if (
          estimate?.quota &&
          estimate.quota - (estimate.usage || 0) <
            32 * 1048576 + downloadMB * 1000000
        )
          throw new Error(
            "Not enough browser storage for voice and saved worlds. Free space or keep using typed messages.",
          );
        if (transcriber && loadedBackend !== backend) {
          await transcriber.dispose();
          transcriber = null;
        }
        transcriber ||= await pipeline(
          "automatic-speech-recognition",
          VOICE_MODEL.id,
          {
            revision: VOICE_MODEL.revision,
            device: backend,
            dtype: config.dtype,
            progress_callback: (p) => {
              if (p.status === "progress")
                self.postMessage({
                  id,
                  type: "progress",
                  file: p.file,
                  progress: p.progress,
                });
            },
          },
        );
        loadedBackend = backend;
        self.postMessage({
          id,
          type: "result",
          result: { backend, model: VOICE_MODEL.id },
        });
        return;
      }
      allowDownload = false;
      if (!transcriber) throw new Error("Enable voice first.");
      if (!(data.audio instanceof Float32Array) || data.audio.length > 240000)
        throw new Error("Recordings must be no longer than 15 seconds.");
      const start = performance.now();
      // English-only checkpoints reject multilingual language/task tokens.
      const result = await transcriber(data.audio, {
        return_timestamps: false,
        max_new_tokens: 128,
        do_sample: false,
      });
      self.postMessage({
        id,
        type: "result",
        result: {
          text: String(result.text || "")
            .trim()
            .slice(0, 500),
          elapsedMs: performance.now() - start,
        },
      });
    } catch (error) {
      self.postMessage({
        id,
        type: "error",
        error:
          kind === "load" && !allowDownload && cacheMiss
            ? `Voice files are missing for ${VOICE_MODEL.name}. Review the new download in Options. Missing files were not downloaded.`
            : error.message || "Voice recognition failed.",
      });
    } finally {
      allowDownload = false;
    }
  });
};
