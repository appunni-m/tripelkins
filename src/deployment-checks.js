import {
  DECISION_CASES,
  decisionWorld,
  decisionOutcome,
  localReference,
} from "./game/evaluation.js";
import { buildContext } from "./game/context.js";
import { VOICE_MODEL, voiceBackend, isVoiceFile } from "./voice/model.js";
import { GOAL_OPTIONS } from "./game/goals.js";
import { commandInput, parseConstraints } from "./game/commands.js";
import { COMMAND_CASES } from "./game/command-evaluation.js";
import { settlementWorld, developmentWorld, carePressureWorld } from "./game/settlement-evaluation.js";
import { settlementChoices, settlementDecisionChoices, settlementDecisionInput, startSettlement } from "./game/settlement.js";
import { stepWorld } from "./game/simulation.js";
import { addCreature, addObject } from "./game/state.js";
import { auditColony } from "./game/colony-audit.js";
import { groundFixture } from "./game/scale-fixture.js";

const $ = (id) => document.getElementById(id);
const base = new URL(import.meta.env.BASE_URL, location.href);
const results = [];
let activeWorker,
  running = false,
  cancelled = false,
  cancelJob,
  requestId = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function showProgress(text) {
  $("progress").textContent = text;
}
function startRow(name) {
  const row = document.createElement("article");
  row.dataset.status = "running";
  const title = document.createElement("h2");
  title.textContent = name;
  const detail = document.createElement("pre");
  detail.textContent = "RUNNING";
  row.append(title, detail);
  $("results").append(row);
  return { row, detail };
}
async function check(name, run) {
  if (cancelled) return;
  const { row, detail } = startRow(name);
  const started = performance.now();
  const record = { name, status: "pass", at: new Date().toISOString() };
  try {
    record.result = await run();
  } catch (error) {
    record.status = error.name === "NotSupportedError" ? "skip" : "fail";
    record.error = error.message;
    if (error.result) record.result = error.result;
  } finally {
    activeWorker?.terminate();
    activeWorker = null;
    cancelJob = null;
    record.elapsedMs = Math.round(performance.now() - started);
    results.push(record);
    row.dataset.status = record.status;
    detail.textContent = `${record.status.toUpperCase()} · ${record.elapsedMs} ms\n${record.result && record.error ? record.error + "\n" : ""}${JSON.stringify(record.result || record.error, null, 2)}`;
    $("download").disabled = false;
  }
}
function callWorker(worker, message, timeout = 300000) {
  const id = ++requestId;
  return new Promise((resolve, reject) => {
    const finish = (error, value) => {
      clearTimeout(timer);
      cancelJob = null;
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(
      () => finish(new Error("Worker timed out.")),
      timeout,
    );
    cancelJob = () => finish(new Error("Stopped by user."));
    worker.onmessage = ({ data }) => {
      if ((data.requestId ?? data.id) !== id) return;
      if (data.type === "progress") {
        showProgress(
          data.message ||
            `${data.file}: ${data.progress !== undefined ? `${Math.round(data.progress)}%` : `${Math.round((data.loaded || 0) / 1048576)} MB`}`,
        );
      } else if (data.type === "error") finish(new Error(data.error));
      else finish(null, data.result);
    };
    worker.onerror = (event) =>
      finish(new Error(event.message || "Worker failed to start."));
    worker.postMessage({ ...message, id, requestId: id });
  });
}
async function requireGpu(fp16 = true) {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter || (fp16 && !adapter.features.has("shader-f16")))
    throw new DOMException(
      "FP16 WebGPU is unavailable on this device. Run the WASM checks.",
      "NotSupportedError",
    );
}
async function cachedFiles(name) {
  const cache = await caches.open(name);
  return (await cache.keys()).map((request) => new URL(request.url).pathname);
}
async function laya(backend, bufferCacheMode = "lazyRelease") {
  if (backend === "webgpu") await requireGpu();
  const cache =
    backend === "webgpu" ? "tripelkins-laya-fp16-v1" : "tripelkins-laya-q8-v1";
  const before = await cachedFiles(cache);
  activeWorker = new Worker(new URL("./laya/worker.js", import.meta.url), {
    type: "module",
  });
  const load = await callWorker(activeWorker, {
    kind: "load",
    backend,
    allowDownload: true,
    measureMemory: backend === "webgpu",
    bufferCacheMode,
  });
  const options = {
    care: "Feed hungry creatures",
    bridge: "Carry logs to the bridge",
    industry: "Mine ore and work in factories",
  };
  const answer = await callWorker(
    activeWorker,
    {
      kind: "infer",
      backend,
      context:
        "Four Tripelkins. Food 10/100, clean 70/100, play 70/100. Bananas nearby. Bridge incomplete. No mines or factories. Keep everyone healthy.",
      options,
    },
    90000,
  );
  assert(
    Object.hasOwn(options, answer.policy),
    "Laya did not return one of the supplied choices.",
  );
  assert(
    Object.values(answer.distribution).every(Number.isFinite),
    "Laya returned invalid probabilities.",
  );
  const behavior = [], qualityFailures = [];
  for (const spec of DECISION_CASES) {
    showProgress(`Laya ${backend}: behavior ${spec.id}`);
    const world = decisionWorld(spec),
      snapshot = buildContext(world);
    let selected = snapshot.plans[0]?.id,
      latency = 0;
    if (snapshot.plans.length > 1) {
      const result = await callWorker(
        activeWorker,
        {
          kind: "infer",
          backend,
          maxTokens: snapshot.maxTokens,
          context: snapshot.local,
          requiredContext: snapshot.localParts[0],
          contextParts: snapshot.localParts.slice(1),
          options: snapshot.options,
          question: snapshot.question,
        },
        90000,
      );
      selected = result.policy;
      latency = Math.round(result.timing.inferenceMs);
    }
    const chosen = decisionOutcome(world, selected),
      baseline = decisionOutcome(world, localReference(world));
    const qualityCheck = (condition, message) => { if (!condition) qualityFailures.push(message); };
    qualityCheck(
      chosen.violations === 0 && chosen.deaths === 0,
      `Unsafe choice in ${spec.id}`,
    );
    qualityCheck(
      chosen.useful >= baseline.useful * 0.8 ||
        (baseline.unmetSeconds > 0 &&
          chosen.unmetSeconds <= baseline.unmetSeconds * 0.8),
      `Useful-work regression in ${spec.id}`,
    );
    qualityCheck(
      chosen.unmetSeconds <=
        baseline.unmetSeconds + Math.max(5, baseline.unmetSeconds * 0.1),
      `Care regression in ${spec.id}`,
    );
    qualityCheck(
      chosen.stalls <= baseline.stalls + 1,
      `Route regression in ${spec.id}`,
    );
    behavior.push({
      id: spec.id,
      holdout: !!spec.holdout,
      inferenceMs: latency,
      chosen,
      baseline,
    });
  }
  const after = await cachedFiles(cache);
  const commands = [];
  for (const spec of COMMAND_CASES) {
    const constraints = parseConstraints(decisionWorld(DECISION_CASES[0]), spec.text);
    const guarded = constraints.question || constraints.negated || constraints.reply;
    const result = guarded ? {policy: "none"} : await callWorker(activeWorker, {
      kind: "infer", backend, options: GOAL_OPTIONS, ...commandInput(spec.text),
    });
    commands.push({...spec, policy: result.policy, guarded: !!guarded, inferenceMs: result.timing?.inferenceMs || 0});
    assert(result.policy === spec.goal, `Command interpreted as ${result.policy}, expected ${spec.goal}: ${spec.text}`);
  }
  const construction = [];
  for (const missing of ["orchard","bath","roundabout"]) {
    showProgress(`Laya ${backend}: independent ${missing}`);
    const world = settlementWorld(missing), choices=settlementDecisionChoices(world);
    assert(choices.length>0, `No construction option for ${missing}`);
    const result = await callWorker(activeWorker,{kind:"infer",backend,...settlementDecisionInput(world,choices)},90000);
    const choice=choices.find(c=>(c.key||c.id)===result.policy);
    assert(choice?.id===missing,`A ${missing} was needed; Laya chose ${result.policy}.`);
    assert(startSettlement(world,choice,result.source),"Project was rejected.");
    for(let tick=0; tick<1800 && world.community.project; tick++)stepWorld(world,.1);
    assert(world.community.completed===1,`The ${missing} crew did not finish.`);
    assert(world.inventory.wood>=0 && world.progress.chopped>=1,"Construction did not use gathered timber.");
    construction.push({needed:missing,chosen:result.policy,inferenceMs:Math.round(result.timing.inferenceMs),completed:world.community.completed,seconds:Math.round(world.time),treesGathered:world.progress.chopped,woodRemaining:world.inventory.wood});
  }
  const carePressure=[];
  for (const needed of ["orchard","bath"]) {
    showProgress(`Laya ${backend}: more ${needed} capacity`);
    const world=carePressureWorld(needed),choices=settlementDecisionChoices(world);
    assert(settlementChoices(world).some(c=>c.id==="factory"),"Fixture must include available industrial development.");
    assert(!choices.some(c=>c.id==="factory"),"Unrelated industry must wait for essential care capacity.");
    const result=await callWorker(activeWorker,{kind:"infer",backend,...settlementDecisionInput(world,choices)},90000);
    const choice=choices.find(c=>(c.key||c.id)===result.policy);
    assert(choice && [needed,"dwelling"].includes(choice.id),`Existing ${needed} capacity was insufficient; Laya chose ${result.policy}.`);
    assert(startSettlement(world,choice,result.source),"Care expansion rejected.");
    for(let tick=0;tick<2400&&world.community.project;tick++)stepWorld(world,.1);
    assert(world.community.completed===1 && world.evidence.deaths===0,"Care expansion did not complete safely.");
    carePressure.push({needed,chosen:result.policy,inferenceMs:Math.round(result.timing.inferenceMs),tokens:result.timing.tokens,omittedOptionalParts:result.timing.omittedParts});
  }
  const crowded=carePressureWorld("bath");
  for(let i=0;i<40;i++) {
    const c=addCreature(crowded,18+i%8,18+Math.floor(i/8));
    c.fed=c.clean=c.amused=45;
  }
  crowded.objects=crowded.objects.filter(o=>!["orchard","bath","roundabout"].includes(o.type));
  crowded.progress.bridge=false;
  crowded.inventory.blocks=crowded.progress.peakBlocks=1000;
  addObject(crowded,"bridge",42,25);
  const many=settlementChoices(crowded),manyInput=settlementDecisionInput(crowded,many);
  assert(Object.keys(manyInput.options).length===9,"Context fixture must exercise all nine choices.");
  const widest=await callWorker(activeWorker,{kind:"infer",backend,...manyInput},90000);
  assert(widest.timing.tokens<=320,"Development context exceeded its token budget.");
  const developmentBudget={options:Object.keys(manyInput.options).length,tokens:widest.timing.tokens,omittedOptionalParts:widest.timing.omittedParts};
  let soak;
  const development = [];
  for (const needed of ["timber","quarry","refine","crossing"]) {
    showProgress(`Laya ${backend}: independent ${needed}`);
    const world=developmentWorld(needed);
    if (needed==="refine") {
      world.inventory.wood=24;
      // Give this fixture its stated resource goal. With no goal, expanding
      // food capacity is also a valid choice for a growing settlement.
      world.memory.goals=[{id:"refine-fixture",kind:"blocks",target:300,status:"active",command:"Make 300 blocks",createdAt:0,reviews:[]}];
    }
    if (needed==="crossing") world.memory.goals=[{id:"crossing-fixture",kind:"bridge",target:24,status:"active",command:"Build the bridge",createdAt:0,reviews:[]}];
    const choices=settlementDecisionChoices(world);
    const result=await callWorker(activeWorker,{kind:"infer",backend,...settlementDecisionInput(world,choices)},90000);
    const choice=choices.find(c=>(c.key||c.id)===result.policy);
    assert(choice?.id===needed,`Independent ${needed} was needed; Laya chose ${result.policy}.`);
    assert(startSettlement(world,choice,result.source),"Development project rejected.");
    // Resource goals can span bounded work projects. Exercise the same model
    // replanning used by the game after a crew times out, retaining its stock.
    for(let tick=0;tick<4800 && world.community.completed===0;tick++) {
      stepWorld(world,.1);
      if (!world.community.project && tick%10===0) {
        const next=settlementDecisionChoices(world);
        if (!next.length) continue;
        const retry=await callWorker(activeWorker,{kind:"infer",backend,...settlementDecisionInput(world,next)},90000);
        const resumed=next.find(c=>(c.key||c.id)===retry.policy);
        assert(resumed?.id===needed,`The ${needed} goal lost focus after replanning: ${retry.policy}.`);
        assert(startSettlement(world,resumed,retry.source),"Resumed project rejected.");
      }
    }
    assert(world.community.completed===1,`${needed} did not finish.`);
    assert(world.evidence.deaths===0,`${needed} displaced care.`);
    development.push({needed,chosen:result.policy,inferenceMs:Math.round(result.timing.inferenceMs),seconds:Math.round(world.time),inventory:world.inventory,completed:world.community.completed});
  }
  if (backend === "webgpu") {
    assert(load.memory?.liveBytes > 0, "GPU allocation instrumentation did not observe the loaded weights.");
    const samples = [];
    const cycle = 32, total = cycle * 3;
    for (let i = 0; i < total; i++) {
      const shape = i % cycle, count = [2, 3, 5, 7][shape % 4],
        maxTokens = count === 7 ? 320 : 192;
      showProgress(`Laya GPU buffer check ${i + 1}/${total} · ${bufferCacheMode}`);
      const result = await callWorker(activeWorker, {
        kind: "infer", backend, maxTokens,
        options: Object.fromEntries(Object.entries(GOAL_OPTIONS).slice(0, count)),
        requiredContext: "Food 10/100. Hungry creatures need bananas. Keep everyone healthy.",
        contextParts: Array.from({length: shape * 8}, () => "Nearby trees."),
      });
      samples.push({ ms: result.timing.inferenceMs, memory: result.memory, count, tokens: result.timing.tokens });
    }
    const times = samples.map(s=>s.ms).sort((a,b)=>a-b);
    soak = { bufferCacheMode, samples: samples.length,
      p50Ms: times[Math.floor(times.length/2)], p95Ms: times[Math.floor(times.length*.95)],
      shapes: samples.slice(0, cycle).map(({count,tokens}) => ({count,tokens})),
      endOfFirstCycle: samples[cycle - 1].memory, endOfSecondCycle: samples[cycle * 2 - 1].memory,
      end: samples.at(-1).memory,
      scope: "Requested GPU buffers only; excludes driver/pipelines, WASM heap and JS heap." };
    assert(soak.end.liveBytes <= soak.endOfFirstCycle.liveBytes + 1048576,
      "Repeated GPU input shapes retained more than 1 MiB of extra buffers.");
  }
  assert(
    after.some((path) => path.endsWith(".onnx.data")),
    "Model weights were not cached.",
  );
  const report = {
    backend,
    initiallyCachedFiles: before.length,
    cachedFiles: after,
    loadMs: Math.round(load.loadMs),
    decision: answer.policy,
    distribution: answer.distribution,
    behavior,
    commands,
    construction,
    carePressure,
    developmentBudget,
    development,
    inferenceMs: Math.round(answer.timing.inferenceMs),
    ...(soak ? { loadMemory: load.memory, soak } : {}),
  };
  if (qualityFailures.length) {
    throw Object.assign(new Error(qualityFailures.join("; ")), {result: {...report, qualityFailures}});
  }
  return report;
}
async function speechSamples(file) {
  assert(file.size <= 4 * 1024 * 1024, "Choose an audio file smaller than 4 MB.");
  const audioContext = new OfflineAudioContext(1, 16000 * 15, 16000);
  const decoded = await audioContext.decodeAudioData(await file.arrayBuffer());
  const audio = decoded.getChannelData(0);
  assert(audio.length >= 4800 && audio.length <= 240000 && decoded.sampleRate === 16000,
    "Speech recording must be between 0.3 and 15 seconds.");
  assert(Math.sqrt(audio.reduce((n,s)=>n+s*s,0)/audio.length)>=.002,"The chosen recording is too quiet for the game's capture threshold.");
  return audio;
}
async function whisper(backend) {
  const file = $("speech-file").files[0];
  if (!file) throw new DOMException("Choose your own speech recording before running this check. No model was downloaded.", "NotSupportedError");
  const audio = await speechSamples(file);
  if (backend === "webgpu") await requireGpu(false);
  const cache = VOICE_MODEL.cache;
  const before = await cachedFiles(cache);
  activeWorker = new Worker(new URL("./voice/worker.js", import.meta.url), {
    type: "module",
  });
  await callWorker(activeWorker, {
    kind: "load",
    backend,
    allowDownload: true,
  });
  const answer = await callWorker(
    activeWorker,
    { kind: "transcribe", audio },
    120000,
  );
  assert(
    /little friends/i.test(answer.text) && /happy.*healthy/i.test(answer.text),
    `Unexpected transcript: ${answer.text}`,
  );
  const after = await cachedFiles(cache);
  assert(
    voiceBackend(backend).files.every((file) =>
      after.some((path) => isVoiceFile(path, file.name)),
    ),
    "Whisper weights were not cached.",
  );
  return {
    backend,
    model: VOICE_MODEL.id,
    revision: VOICE_MODEL.revision,
    initiallyCachedFiles: before.length,
    cachedFiles: after,
    transcript: answer.text,
    inferenceMs: Math.round(answer.elapsedMs),
  };
}
async function storage() {
  const name = `tripelkins-verification-${crypto.randomUUID()}`;
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("probe");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction("probe", "readwrite");
      tx.objectStore("probe").put(
        { saved: true, position: [12, 24], words: "Hello" },
        "state",
      );
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    const value = await new Promise((resolve, reject) => {
      const request = db.transaction("probe").objectStore("probe").get("state");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    assert(
      value.saved && value.position[1] === 24 && value.words === "Hello",
      "IndexedDB round trip did not match.",
    );
  } finally {
    db.close();
    indexedDB.deleteDatabase(name);
  }
  const cache = await caches.open(name);
  try {
    await cache.put(new URL("verification-probe", base), new Response("saved"));
    assert(
      (await (
        await cache.match(new URL("verification-probe", base))
      ).text()) === "saved",
      "CacheStorage round trip failed.",
    );
  } finally {
    await caches.delete(name);
  }
  return {
    indexedDB: "read/write passed",
    cacheStorage: "read/write passed",
    quota: await navigator.storage.estimate(),
    microphoneApi: !!navigator.mediaDevices?.getUserMedia,
    audioWorklet: !!window.AudioWorkletNode,
  };
}
async function assets() {
  assert(
    window.isSecureContext,
    "A secure context (HTTPS or localhost) is required.",
  );
  const response = await fetch(new URL("deployment-manifest.json", base), {
    cache: "no-store",
  });
  assert(response.ok, "Build manifest is missing. Use a production build.");
  const manifest = await response.json();
  for (const asset of manifest.assets) {
    if (cancelled) throw new Error("Stopped by user.");
    showProgress(`Checking ${asset.path}`);
    const result = await fetch(new URL(asset.path, base), {
      method: "HEAD",
      cache: "no-store",
    });
    assert(result.ok, `${asset.path}: HTTP ${result.status}`);
    if (asset.path.endsWith(".wasm"))
      assert(
        result.headers.get("content-type")?.includes("application/wasm"),
        `${asset.path}: incorrect WASM MIME type`,
      );
  }
  const module = await import("./voice/capture.worklet.js?url");
  const audio = new AudioContext();
  try {
    await audio.audioWorklet.addModule(module.default);
  } finally {
    await audio.close();
  }
  return {
    commit: manifest.commit,
    assetCount: manifest.assets.length,
    secureContext: true,
    crossOriginIsolated,
    audioWorklet: "loaded successfully",
    origin: location.origin,
  };
}
async function resumableDownload() {
  if (!navigator.locks) throw new DOMException("Web Locks are unavailable; resumable downloads need this browser feature.", "NotSupportedError");
  // The site compresses its WASM responses. Use an actual immutable model file
  // to exercise the same cross-origin byte ranges as model setup, without inference.
  const asset = { bytes: 53076992, sha256: "cfdf7c199378b07758c69f58935871cf517c97c29914328d4b11fcfbe50b7f8b" };
  const url = "https://huggingface.co/nvkudva/laya-web-q8/resolve/a1f49ac3c927b2e694a074af081d043adaa0fda1/v1/head_q8.onnx.data";
  const cacheName = `tripelkins-resume-check-${crypto.randomUUID()}`;
  const start = () => activeWorker = new Worker(new URL("./download-check.worker.js", import.meta.url), { type: "module" });
  try {
    showProgress("Downloading one Laya file; stopping after its first saved checkpoint…");
    const interrupted = await callWorker(start(), { url, cacheName, interrupt: true });
    assert(interrupted.interrupted, "The initial download did not stop at a checkpoint.");
    activeWorker.terminate();
    showProgress("New worker: resuming the saved file…");
    const resumed = await callWorker(start(), { url, cacheName });
    assert(resumed.ranges[0] === `bytes=${interrupted.saved}-`, "The new worker restarted instead of requesting the remaining bytes.");
    assert(resumed.bytes === asset.bytes && resumed.sha256 === asset.sha256, "Resumed bytes differ from the published file.");
    activeWorker.terminate();
    const cached = await callWorker(start(), { url, cacheName, cachedOnly: true });
    assert(cached.ranges.length === 0 && cached.sha256 === asset.sha256, "The completed file wasn't reusable without network access.");
    return { checkpointBytes: interrupted.saved, resumedRange: resumed.ranges[0], bytes: resumed.bytes,
      sha256: resumed.sha256, cachedWithoutNetwork: true, workers: 3 };
  } finally { await caches.delete(cacheName); }
}
async function colonyAudit(stone = false, spread = false) {
  await requireGpu();
  activeWorker = new Worker(new URL("./laya/worker.js", import.meta.url), { type:"module" });
  await callWorker(activeWorker,{kind:"load",backend:"webgpu",allowDownload:false});
  const infer = input => callWorker(activeWorker,{kind:"infer",backend:"webgpu",...input});
  let world;
  if (spread) world=groundFixture(300);
  else if (stone) {
    world=developmentWorld();
    const c=addCreature(world,25,25);c.fed=c.clean=c.amused=85;
    world.runtime.growth={held:true};
  }
  const seconds=spread?360:300, count=spread?300:25;
  const report=await auditColony({seconds,
    ...(world ? {world} : {}),
    chooseSchedule:(_w,s)=>infer({maxTokens:s.maxTokens,context:s.local,question:s.question,
      requiredContext:s.localParts[0],contextParts:s.localParts.slice(1),
      options:s.options}),
    chooseDevelopment:(_w,_choices,input)=>infer(input),
    onProgress: async sample=>{
      if(cancelled) throw new Error("Stopped by user.");
      showProgress(`${count} residents · ${sample.tick}/${seconds} simulated seconds · ${sample.crews.length} crews · ${sample.completedProjects} projects completed`);
      await new Promise(resolve=>setTimeout(resolve,0));
    },
  });
  if (stone || spread) {
    assert(world.progress.peakBlocks>=300,"The real Laya colony did not reach its stone milestone.");
    assert(world.memory.activity.quarry>0 && world.memory.activity.refine>0,"The milestone did not involve physical quarrying and refining.");
  }
  if(spread) assert(world.memory.activity.work>0,"The large colony did not continue into real workshop production.");
  const {reviews,projects,residents,...summary}=report;
  return {...summary,projectChoices:projects.map(p=>({tick:p.tick,selected:p.selected,started:p.started})),
    scheduleChoices:reviews.map(r=>({tick:r.tick,selected:r.selected,applied:r.applied,candidates:r.options.length,source:r.source})),
    firstOptions:reviews[0]?.options,firstModelTiming:reviews.find(r=>r.timing)?.timing,residents};
}
async function cachedVoice() {
  await requireGpu(false);
  const file=$("speech-file").files[0];
  let audio=new Float32Array(16000);
  if (file) audio=await speechSamples(file);
  const passes=[];
  for (let wake=0;wake<2;wake++) {
    activeWorker=new Worker(new URL("./voice/worker.js",import.meta.url),{type:"module"});
    await callWorker(activeWorker,{kind:"load",backend:"webgpu",allowDownload:false});
    const result=await callWorker(activeWorker,{kind:"transcribe",audio},120000);
    assert(typeof result.text==="string","Speech inference returned no transcript field.");
    if (file) assert(/little friends/i.test(result.text)&&/happy.*healthy/i.test(result.text),`Unexpected transcript: ${result.text}`);
    passes.push(result);
    activeWorker.terminate();activeWorker=null;
  }
  return {backend:"webgpu",downloadAllowed:false,freshWorkers:2,
    check:file?"Chosen phrase transcribed on both wakes":"Silence exercises processor and inference; speech accuracy not tested",passes};
}
async function run(kind, backend, bufferCacheMode) {
  if (running) return;
  running = true;
  cancelled = false;
  document
    .querySelectorAll("nav button")
    .forEach(
      (button) => (button.disabled = !["stop", "download"].includes(button.id)),
    );
  $("download").disabled = !results.length;
  try {
    if (["colony","stone","spread"].includes(kind)) await check(`${kind==="spread"?"300 spread residents":kind==="stone"?"Stone milestone":"25-resident colony"} · real cached Laya`,()=>colonyAudit(kind==="stone",kind==="spread"));
    if (kind === "voice-cached") await check("Whisper cached restart and inference",cachedVoice);
    if (kind === "all" || kind === "platform") {
      await check("Production assets & audio worklet", assets);
      await check("Browser storage", storage);
    }
    if (kind === "download") {
      await check("Interrupted download resumes in a new worker", resumableDownload);
    } else if (kind === "all") {
      for (const name of ["laya", "whisper"])
        for (const mode of ["webgpu", "wasm"])
          await check(`${name} ${mode}`, () =>
            (name === "laya" ? laya : whisper)(mode),
          );
    } else if (!["platform","colony","stone","spread","voice-cached"].includes(kind))
      await check(`${kind} ${backend}`, () =>
        (kind === "laya" ? laya : whisper)(backend, bufferCacheMode),
      );
  } finally {
    running = false;
    document
      .querySelectorAll("nav button")
      .forEach((button) => (button.disabled = button.id === "stop"));
    showProgress(
      `${cancelled ? "Stopped" : "Finished"}. ${results.filter((r) => r.status === "pass").length} passed, ${results.filter((r) => r.status === "fail").length} failed, ${results.filter((r) => r.status === "skip").length} skipped (see each reason).`,
    );
  }
}
$("run-all").onclick = () => run("all");
$("run-platform").onclick = () => run("platform");
$("run-download").onclick = () => run("download");
$("run-colony").onclick = () => run("colony");
$("run-stone").onclick = () => run("stone");
$("run-spread").onclick = () => run("spread");
$("run-voice-cached").onclick = () => run("voice-cached");
document
  .querySelectorAll("[data-model]")
  .forEach(
    (button) =>
      (button.onclick = () =>
        run(button.dataset.model, button.dataset.backend, button.dataset.bufferCache)),
  );
$("stop").onclick = () => {
  cancelled = true;
  cancelJob?.();
  activeWorker?.terminate();
};
$("download").onclick = () => {
  const url = URL.createObjectURL(
    new Blob(
      [
        JSON.stringify(
          { origin: location.origin, userAgent: navigator.userAgent, results },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    ),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "tripelkins-deployment-report.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
window.addEventListener("pagehide", () => {
  cancelled = true;
  activeWorker?.terminate();
});
