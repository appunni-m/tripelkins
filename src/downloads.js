import { VOICE_BACKENDS } from "./voice/model.js";

// Rounded allowances include weights, tokenizer/configuration and runtime files.
// Actual transfer depends on the browser and which files are already cached.
export const DOWNLOADS = {
  laya: {
    wasm: { name: "Laya Q8 · WASM", weights: 524, allowance: 600 },
    webgpu: { name: "Laya FP16 · WebGPU", weights: 846, allowance: 950 },
  },
  whisper: {
    wasm: VOICE_BACKENDS.wasm.download,
    webgpu: VOICE_BACKENDS.webgpu.download,
  },
};

export const DOWNLOAD_NOTICE =
  "Uses internet data and browser storage. Metered data charges may apply. Inference runs on your device with no model API fee. Downloads are cached for later visits; clearing browser data, storage eviction, or changing model versions or runtimes can require another download. Existing cached files are reused.";
