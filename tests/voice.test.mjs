import test from "node:test";
import assert from "node:assert/strict";
import { createTranscriber } from "../src/voice/transcriber.js";
import { VOICE_MODEL, voiceBackend } from "../src/voice/model.js";

function fixture(processor = {feature_extractor: {config: {sampling_rate: 16000}}}) {
  const calls = [], tokenizer = () => {}, model = {dispose: async () => calls.push("dispose")};
  const loader = (kind, result) => ({from_pretrained: async (id, options) => {
    calls.push({kind, id, options}); return result;
  }});
  return {calls, api: {
    env: {},
    AutoTokenizer: loader("tokenizer", tokenizer),
    AutoProcessor: loader("processor", processor),
    WhisperForConditionalGeneration: loader("model", model),
    AutomaticSpeechRecognitionPipeline: class {constructor(parts) {Object.assign(this, parts);}},
  }};
}
test("Whisper explicitly loads every required component at the same pinned revision on each wake", async () => {
  for (const device of ["webgpu", "wasm"]) for (let wake = 0; wake < 2; wake++) {
    const {api, calls} = fixture(), options = {
      revision: VOICE_MODEL.revision, device, dtype: voiceBackend(device).dtype,
    };
    const pipeline = await createTranscriber(api, VOICE_MODEL.id, options);
    assert.deepEqual(calls.map(c => c.kind), ["tokenizer", "processor", "model"]);
    assert.ok(calls.every(c => c.id === VOICE_MODEL.id && c.options === options));
    assert.equal(api.env.remotePathTemplate,`{model}/resolve/${VOICE_MODEL.revision}/`);
    assert.ok(pipeline.processor.feature_extractor);
    assert.equal(typeof pipeline.tokenizer, "function");
    assert.equal(pipeline.task, "automatic-speech-recognition");
  }
});
test("missing speech processor fails setup before allocating the model", async () => {
  const {api, calls} = fixture(null);
  await assert.rejects(createTranscriber(api, VOICE_MODEL.id, {}), /setup is incomplete/);
  assert.deepEqual(calls.map(c => c.kind), ["tokenizer", "processor"]);
});
test("failed pipeline assembly releases the speech model", async () => {
  const {api, calls} = fixture();
  api.AutomaticSpeechRecognitionPipeline = class {constructor() {throw new Error("assembly failed");}};
  await assert.rejects(createTranscriber(api, VOICE_MODEL.id, {}), /assembly failed/);
  assert.equal(calls.at(-1), "dispose");
});
