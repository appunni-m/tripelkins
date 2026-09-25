// Keep runtime, download consent and cache accounting on the same model version.
export const VOICE_MODEL = {
  id: "onnx-community/whisper-base.en",
  name: "Whisper Base English",
  revision: "fd8ac034a560b217176fae5215ca3fe05c9140f3",
  cache: "tripelkins-whisper-base-en-v1",
};
export const VOICE_CACHES = [VOICE_MODEL.cache, "tripelkins-whisper-tiny-v1"];

// Whisper's encoder is sensitive to reduced precision. Preserve FP32 on both
// backends; use a smaller decoder for single-thread WASM. Sizes are rounded MB.
export const VOICE_BACKENDS = {
  wasm: {
    dtype: { encoder_model: "fp32", decoder_model_merged: "q8" },
    files: [
      { name: "encoder_model.onnx", megabytes: 83 },
      { name: "decoder_model_merged_quantized.onnx", megabytes: 54 },
    ],
    download: {
      name: `${VOICE_MODEL.name} · WASM`,
      weights: 137,
      allowance: 180,
    },
  },
  webgpu: {
    dtype: { encoder_model: "fp32", decoder_model_merged: "q8" },
    files: [
      { name: "encoder_model.onnx", megabytes: 83 },
      { name: "decoder_model_merged_quantized.onnx", megabytes: 54 },
    ],
    download: {
      name: `${VOICE_MODEL.name} · WebGPU`,
      weights: 137,
      allowance: 180,
    },
  },
};

export function voiceBackend(backend) {
  if (!Object.hasOwn(VOICE_BACKENDS, backend))
    throw new Error("Unsupported voice runtime.");
  return VOICE_BACKENDS[backend];
}

export function isVoiceFile(url, file) {
  return (
    new URL(url, "https://huggingface.co").pathname ===
    `/${VOICE_MODEL.id}/resolve/${VOICE_MODEL.revision}/onnx/${file}`
  );
}
