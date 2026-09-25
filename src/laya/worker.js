import { PreTrainedTokenizer } from "@huggingface/transformers";
import { meterGpuBuffers } from "./gpu-meter.js";
import { runtimeRoot } from "../runtime-paths.js";
const MODELS = {
  wasm: {
    base: "https://huggingface.co/nvkudva/laya-web-q8/resolve/main/v1",
    cache: "tripelkins-laya-q8-v1",
    bytes: 530000000,
  },
  webgpu: {
    base: "https://huggingface.co/inferenceprince/laya-onnx/resolve/main",
    cache: "tripelkins-laya-fp16-v1",
    bytes: 850000000,
  },
};
let ort, tokenizer, config, encoder, head, session, mode, loading;
let memory, measuredDevice, bufferCacheMode = "lazyRelease";
const tokens = new Map();
const progress = (id, data) =>
  self.postMessage({ requestId: id, type: "progress", ...data });
async function bytes(url, id, cacheName, allowDownload) {
  let cache;
  try {
    cache = await caches.open(cacheName);
    const hit = await cache.match(url);
    if (hit) {
      progress(id, {
        file: url.split("/").pop(),
        message: `Reading cached ${url.split("/").pop()}…`,
      });
      return new Uint8Array(await hit.arrayBuffer());
    }
  } catch {}
  if (!allowDownload)
    throw new Error(
      "Some Laya files are missing. Review the download in Options to enable intelligence. Missing files were not downloaded.",
    );
  progress(id, { message: `Downloading ${url.split("/").pop()}…` });
  const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!response.ok)
    throw new Error(`Model download failed (${response.status}).`);
  // Stream directly into browser cache first. Avoid a JS chunks array plus a second full-sized assembly.
  if (cache) {
    try {
      let loaded = 0,
        lastReport = 0;
      const total = Number(response.headers.get("content-length")) || 0;
      const metered = response.body
        ? new Response(
            response.body.pipeThrough(
              new TransformStream({
                transform(chunk, controller) {
                  loaded += chunk.byteLength;
                  const now = performance.now();
                  if (now - lastReport > 250) {
                    progress(id, { file: url.split("/").pop(), loaded, total });
                    lastReport = now;
                  }
                  controller.enqueue(chunk);
                },
              }),
            ),
            { headers: response.headers, status: response.status },
          )
        : response;
      await cache.put(url, metered);
      const stored = await cache.match(url);
      if (stored) return new Uint8Array(await stored.arrayBuffer());
    } catch {
      progress(id, {
        message: "Model cache unavailable; using this session only.",
      });
    }
  }
  // Retrying a consumed response could silently double the approved transfer.
  if (response.bodyUsed)
    throw new Error(
      "The download could not be cached. Free browser storage, then review the download again in Options.",
    );
  const usable = response;
  if (!usable.ok)
    throw new Error("Model could not be loaded after cache failure.");
  return new Uint8Array(await usable.arrayBuffer());
}
async function load(id, backend, allowDownload = false, diagnostics = {}) {
  if (tokenizer && mode === backend && (session || (encoder && head))) return;
  if (loading) return loading;
  loading = (async () => {
    mode = backend;
    const model = MODELS[mode];
    if (!model) throw new Error("Unknown runtime.");
    if (mode === "webgpu") {
      if (!navigator.gpu)
        throw new Error(
          "WebGPU is unavailable here. Select Q8 WASM in Options.",
        );
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) throw new Error("No WebGPU adapter. Select Q8 WASM.");
      if (!adapter.features.has("shader-f16"))
        throw new Error("This GPU lacks FP16 support. Select Q8 WASM.");
      ort = await import("onnxruntime-web/webgpu");
      ort.env.webgpu.adapter = adapter;
      if (diagnostics.measureMemory) {
        measuredDevice = await adapter.requestDevice({
          requiredFeatures: ["shader-f16", "subgroups", "timestamp-query"].filter((name) => adapter.features.has(name)),
          requiredLimits: {
            maxBufferSize: adapter.limits.maxBufferSize,
            maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
            maxComputeWorkgroupStorageSize: adapter.limits.maxComputeWorkgroupStorageSize,
          },
        });
        memory = meterGpuBuffers(measuredDevice);
      }
    } else ort = await import("onnxruntime-web/wasm");
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = runtimeRoot("ort", import.meta.url,
      import.meta.env.DEV, import.meta.env.BASE_URL);
    if (mode === "webgpu" && diagnostics.measureMemory) {
      if (diagnostics.bufferCacheMode === "bucket") bufferCacheMode = "bucket";
    }
    const estimate = await navigator.storage?.estimate?.();
    const existing = await caches.open(model.cache);
    const hasWeights = (await existing.keys()).some((r) =>
      r.url.endsWith(".data"),
    );
    if (
      !hasWeights &&
      estimate?.quota &&
      estimate.quota - estimate.usage < model.bytes * 1.2 + 32 * 1048576
    )
      throw new Error(
        "Not enough browser storage for this model. Export your world, then free space or use OpenRouter.",
      );
    const json = async (path) =>
      JSON.parse(
        new TextDecoder().decode(
          await bytes(`${model.base}/${path}`, id, model.cache, allowDownload),
        ),
      );
    const tokenizerPrefix = mode === "webgpu" ? "tokenizer/" : "";
    const [cfg, tok, tokCfg] = await Promise.all([
      json("rl_agent_config.json"),
      json(`${tokenizerPrefix}tokenizer.json`),
      json(`${tokenizerPrefix}tokenizer_config.json`),
    ]);
    config = cfg;
    tokenizer = new PreTrainedTokenizer(tok, tokCfg);
    async function create(name) {
      const graph = await bytes(
        `${model.base}/${name}.onnx`,
        id,
        model.cache,
        allowDownload,
      );
      const data = await bytes(
        `${model.base}/${name}.onnx.data`,
        id,
        model.cache,
        allowDownload,
      );
      progress(id, {
        message: `Preparing ${mode === "webgpu" ? "GPU pipelines" : "local weights"}…`,
      });
      return ort.InferenceSession.create(graph, {
        executionProviders: [mode === "webgpu"
          ? { name: "webgpu", storageBufferCacheMode: bufferCacheMode,
            ...(measuredDevice ? { device: measuredDevice } : {}) }
          : "wasm"],
        externalData: [{ data, path: `${name}.onnx.data` }],
        graphOptimizationLevel: "all",
      });
    }
    if (mode === "webgpu") session = await create("model");
    else {
      encoder = await create("encoder_q8");
      head = await create("head_q8");
    }
  })();
  try {
    await loading;
  } catch (e) {
    tokenizer = null;
    throw e;
  } finally {
    loading = null;
  }
}
function encode(text, invariant = false) {
  if (invariant && tokens.has(text)) return tokens.get(text);
  const result = tokenizer.encode(text, { add_special_tokens: false });
  if (invariant) {
    tokens.set(text, result);
    if (tokens.size > 64) tokens.delete(tokens.keys().next().value);
  }
  return result;
}
function sequence(
  context,
  options,
  question = "Which group schedule best meets current needs?",
  maxTokens = 192,
  contextParts,
  requiredContext = "",
) {
  const sep = encode("[SEP]", true)[0],
    mask = encode("[MASK]", true)[0];
  const ids = [
      encode("[CLS]", true)[0],
      ...encode(`choice question: ${question}`, true),
      sep,
    ],
    markers = [];
  for (const [key, label] of Object.entries(options)) {
    markers.push(ids.length);
    ids.push(mask, ...encode(` ${key}: ${label}`, true).slice(0, 16));
  }
  ids.push(sep);
  const limit = Math.min(
    Math.max(192, Math.min(320, maxTokens)),
    config.max_len,
  );
  const budget = limit - ids.length - 1;
  if (budget < 1) throw new Error("The local model cannot fit these choices.");
  const required = encode(requiredContext.replaceAll("[MASK]", " "));
  if (required.length > budget)
    throw new Error(
      "Please use a shorter message so the whole command can be heard.",
    );
  const state = [...required];
  let omittedParts = 0;
  const parts = contextParts || [context];
  for (const part of parts) {
    const next = encode(` ${part}`.replaceAll("[MASK]", " "));
    if (state.length + next.length <= budget) state.push(...next);
    else omittedParts++;
  }
  if (!state.length)
    throw new Error(
      "The local context is too large. Please use a shorter message.",
    );
  ids.push(...state, sep);
  return {
    ids,
    markers,
    truncated: omittedParts > 0,
    stateTokens: state.length,
    omittedParts,
  };
}

async function infer(
  context,
  options,
  question,
  maxTokens,
  contextParts,
  requiredContext,
) {
  const start = performance.now();
  const { ids, markers, truncated, stateTokens, omittedParts } = sequence(
    context,
    options,
    question,
    maxTokens,
    contextParts,
    requiredContext,
  );
  const count = markers.length,
    length = ids.length;
  const owned = [];
  const tensor = (type, data, dims) => {
    const t = new ort.Tensor(type, data, dims);
    owned.push(t);
    return t;
  };
  const inputs = {
    input_ids: tensor("int64", BigInt64Array.from(ids, BigInt), [1, length]),
    attention_mask: tensor("int64", new BigInt64Array(length).fill(1n), [
      1,
      length,
    ]),
  };
  const markersInput = {
    marker_pos: tensor("int64", BigInt64Array.from(markers, BigInt), [
      1,
      count,
    ]),
    marker_mask: tensor("bool", new Uint8Array(count).fill(1), [1, count]),
    qtype: tensor("int64", BigInt64Array.from([0], BigInt), [1]),
  };
  const prep = performance.now();
  let encodedAt = prep,
    outputs;
  try {
    if (session) outputs = await session.run({ ...inputs, ...markersInput });
    else {
      const hidden = await encoder.run(inputs);
      owned.push(...Object.values(hidden));
      encodedAt = performance.now();
      outputs = await head.run({
        hidden: hidden.hidden,
        attention_mask: inputs.attention_mask,
        ...markersInput,
      });
    }
    owned.push(...Object.values(outputs));
    const values = Array.from(outputs.logits.data).slice(0, count);
    if (values.some((v) => !Number.isFinite(v)))
      throw new Error("The model returned invalid scores.");
    const bucket =
      count <= 2 ? "2" : count <= 5 ? "3-5" : count <= 10 ? "6-10" : "11+";
    const temp =
      config.temperature_by_options?.[`choice:${bucket}`] ||
      config.temperature?.[0] ||
      1;
    const mx = Math.max(...values),
      exp = values.map((v) => Math.exp((v - mx) / temp)),
      sum = exp.reduce((a, b) => a + b, 0),
      probabilities = exp.map((v) => v / sum);
    const labels = Object.keys(options);
    return {
      policy: labels[probabilities.indexOf(Math.max(...probabilities))],
      distribution: Object.fromEntries(
        labels.map((v, i) => [v, probabilities[i]]),
      ),
      source: mode === "webgpu" ? "Laya FP16 · WebGPU" : "Laya Q8 · WASM",
      timing: {
        tokens: length,
        stateTokens,
        truncated,
        omittedParts,
        prepareMs: prep - start,
        encoderMs: session ? null : encodedAt - prep,
        headMs: session ? null : performance.now() - encodedAt,
        inferenceMs: performance.now() - prep,
        totalMs: performance.now() - start,
      },
      note: "One fresh model decision selected the schedule for all groups.",
      ...(memory ? { memory: memory() } : {}),
    };
  } finally {
    for (const t of new Set(owned)) t.dispose();
  }
}
// Serialize model operations. A second request never duplicates sessions or activation memory.
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    const {
      requestId: id,
      kind,
      backend,
      context,
      options,
      question,
      maxTokens,
      contextParts,
      requiredContext,
    } = data;
    try {
      const start = performance.now();
      await load(
        id,
        backend || mode || "wasm",
        kind === "load" && data.allowDownload === true,
        kind === "load" ? data : {},
      );
      const result =
        kind === "load"
          ? { loaded: true, backend: mode, loadMs: performance.now() - start,
            ...(memory ? { memory: memory(), bufferCacheMode } : {}) }
          : await infer(
              context,
              options,
              question,
              maxTokens,
              contextParts,
              requiredContext,
            );
      self.postMessage({ requestId: id, type: "result", result });
    } catch (error) {
      self.postMessage({
        requestId: id,
        type: "error",
        error: error.message || "Local inference failed.",
      });
    }
  });
};
