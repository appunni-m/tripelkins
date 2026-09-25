import { env, AutoTokenizer, AutoProcessor, WhisperForConditionalGeneration,
  AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";
import { createTranscriber } from "./transcriber.js";
import { VOICE_MODEL, voiceBackend } from "./model.js";
import { runtimeRoot } from "../runtime-paths.js";
import { fetchModelFile } from "../model-download.js";

env.allowLocalModels = false;
env.useBrowserCache = true;
env.useFSCache = false;
env.cacheKey = VOICE_MODEL.cache;
env.experimental_useCrossOriginStorage = false;
// Transformers checks CacheStorage before env.fetch. Never fetch missing
// model files during a background wake or an inference retry.
let allowDownload = false;
let cacheMiss = false;
let missingFiles = new Set();
let downloadId;
env.fetch = async (url, options) => {
  const response = await fetchModelFile(url, {
    cacheName: env.cacheKey, allowDownload, requestInit: options,
    onProgress: data => self.postMessage({
      id: downloadId, type: "progress", ...data,
      progress: data.total ? data.loaded / data.total * 100 : 0,
      message: data.message || (data.phase === "resume"
        ? `Resuming ${data.file} from ${Math.floor(data.loaded / 1048576)} MB…`
        : data.phase === "saving" ? `Saving ${data.file}…` : undefined),
    }),
  });
  if (!allowDownload && response.status === 404) {
    cacheMiss = true;
    missingFiles.add(new URL(url).pathname.split("/resolve/")[1] || new URL(url).pathname);
  }
  return response;
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
        missingFiles.clear();
        downloadId = id;
        if (transcriber && loadedBackend !== backend) {
          await transcriber.dispose();
          transcriber = null;
        }
        transcriber ||= await createTranscriber(
          { env, AutoTokenizer, AutoProcessor, WhisperForConditionalGeneration, AutomaticSpeechRecognitionPipeline },
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
            ? `Voice files are missing for ${VOICE_MODEL.name}. Review the new download in Options. Missing files were not downloaded. ${[...missingFiles].slice(0,4).join(", ")}. ${error.message || ""}`
            : error.message || "Voice recognition failed.",
      });
    } finally {
      allowDownload = false;
    }
  });
};
