import captureUrl from "./voice/capture.worklet.js?url";
import { VOICE_MODEL, VOICE_CACHES } from "./voice/model.js";

export const voiceStatus = {
  phase: "idle",
  ready: false,
  needsDownload: false,
  setupError: null,
  backend: "",
  level: 0,
  seconds: 0,
  message: `Enable ${VOICE_MODEL.name} once, then record a short message in English.`,
};
let worker,
  pending,
  jobId = 0,
  generation = 0,
  idleTimer,
  loading;
let preferredBackend;
export function configureVoiceBackend(backend) {
  const next = ["webgpu", "wasm"].includes(backend) ? backend : undefined;
  if (preferredBackend !== next && worker) releaseWorker("Voice preferences changed.");
  preferredBackend = next;
}
let stream, context, source, microphone, silence, recordingTimer;
let changed = () => {},
  transcript = () => {};
export function connectVoice(onChange, onTranscript) {
  changed = onChange;
  transcript = onTranscript;
}
function update(values) {
  Object.assign(voiceStatus, values);
  changed();
}
function stopCapture() {
  clearTimeout(recordingTimer);
  stream?.getTracks().forEach((track) => track.stop());
  microphone?.disconnect();
  source?.disconnect();
  silence?.disconnect();
  context?.close().catch(() => {});
  stream = context = source = microphone = silence = null;
}
function releaseWorker(
  reason = "Voice operation cancelled.",
  keepLoad = false,
) {
  if (loading && !keepLoad) loading.cancelled = true;
  clearTimeout(idleTimer);
  if (pending) {
    clearTimeout(pending.timer);
    pending.reject(new Error(reason));
    pending = null;
  }
  worker?.terminate();
  worker = null;
  voiceStatus.ready = false;
}
function idle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!["ready", "idle", "error"].includes(voiceStatus.phase)) return;
    releaseWorker();
    update({
      phase: "idle",
      message: "Hold Space to talk. The cached model will wake automatically.",
    });
  }, 90000);
}
function call(kind, data = {}, transfer = []) {
  if (pending) return Promise.reject(new Error("Voice is already busy."));
  clearTimeout(idleTimer);
  if (!worker) {
    worker = new Worker(new URL("./voice/worker.js", import.meta.url), {
      type: "module",
    });
    worker.onmessage = ({ data: result }) => {
      if (!pending || result.id !== pending.id) return;
      if (result.type === "progress") {
        if (pending.kind === "load") {
          clearTimeout(pending.timer);
          pending.timer = setTimeout(pending.timeout, 300000);
        }
        update({
          message: result.message || `Loading ${VOICE_MODEL.name} · ${result.file} · ${Math.round(result.progress || 0)}%`,
        });
        return;
      }
      const job = pending;
      pending = null;
      clearTimeout(job.timer);
      result.type === "error"
        ? job.reject(new Error(result.error))
        : job.resolve(result.result);
    };
    worker.onerror = (event) =>
      releaseWorker(event.message || "The voice worker stopped.");
  }
  return new Promise((resolve, reject) => {
    const id = ++jobId;
    const timeout = () => releaseWorker(kind === "load"
      ? "Voice setup stopped. Retry in Options to resume any saved download."
      : "Whisper took too long. Try a shorter recording.");
    const timer = setTimeout(
      timeout,
      kind === "load" ? 300000 : 90000,
    );
    pending = { id, kind, timer, timeout, resolve, reject };
    worker.postMessage({ id, kind, ...data }, transfer);
  });
}
export async function resolveVoiceBackend() {
  const adapter = await navigator.gpu?.requestAdapter?.().catch(() => null);
  if (!adapter) throw new Error("GPU speech recognition is unavailable. You can type with T, or explicitly choose CPU voice compatibility in Advanced options.");
  return "webgpu";
}
export function prepareVoice({
  background = false,
  allowDownload = false,
  backend: requestedBackend,
} = {}) {
  if (voiceStatus.ready && (!requestedBackend || requestedBackend === voiceStatus.backend)) return Promise.resolve(true);
  if (voiceStatus.ready) releaseWorker("Voice runtime changed.");
  if (loading && allowDownload && !loading.allowDownload)
    releaseWorker("Opening voice setup.");
  if (loading && !loading.cancelled) return loading.promise;
  const job = { cancelled: false, allowDownload };
  loading = job;
  job.promise = (async () => {
    update({
      ...(!background ||
      !["requesting", "recording", "transcribing"].includes(voiceStatus.phase)
        ? { phase: "loading" }
        : {}),
      setupError: null,
      message: `Preparing ${VOICE_MODEL.name}…`,
    });
    try {
      const backend =
        requestedBackend || preferredBackend || (await resolveVoiceBackend());
      if (job.cancelled) return false;
      await call("load", { backend, allowDownload });
      if (job.cancelled) return false;
      preferredBackend = backend;
      const active = ["requesting", "recording", "transcribing"].includes(
        voiceStatus.phase,
      );
      update({
        ready: true,
        needsDownload: false,
        backend,
        ...(active ? {} : { phase: "ready" }),
        message: "Hold Space or the microphone to talk. Release to send.",
      });
      if (!active) idle();
      return true;
    } catch (error) {
      if (job.cancelled) return false;
      releaseWorker();
      voiceStatus.needsDownload = /files are missing/i.test(error.message);
      voiceStatus.setupError = error.message;
      if (
        !["requesting", "recording", "transcribing"].includes(voiceStatus.phase)
      )
        update({ phase: "error", message: error.message });
      return false;
    } finally {
      if (loading === job) loading = null;
    }
  })();
  return job.promise;
}
async function acceptAudio(data, current) {
  if (current !== generation || voiceStatus.phase !== "recording") return;
  const nativeRate = data.sampleRate;
  stopCapture();
  update({
    phase: "transcribing",
    level: 0,
    message: "Listening back on your device…",
  });
  try {
    let audio = data.audio.slice(0, data.length);
    let energy = 0;
    for (const sample of audio) energy += sample * sample;
    if (
      audio.length < nativeRate * 0.3 ||
      Math.sqrt(energy / audio.length) < 0.002
    )
      throw new Error(
        "That was too quiet or too short. Move closer and try again.",
      );
    if (nativeRate !== 16000) {
      const offline = new OfflineAudioContext(
        1,
        Math.min(240000, Math.ceil((audio.length * 16000) / nativeRate)),
        16000,
      );
      const buffer = offline.createBuffer(1, audio.length, nativeRate);
      buffer.copyToChannel(audio, 0);
      const input = offline.createBufferSource();
      input.buffer = buffer;
      input.connect(offline.destination);
      input.start();
      audio = (await offline.startRendering()).getChannelData(0);
    }
    if (current !== generation) return;
    if (!voiceStatus.ready && !(await prepareVoice({ background: true })))
      throw new Error(
        voiceStatus.setupError || voiceStatus.message || "Voice could not wake up. Please try again.",
      );
    if (current !== generation) return;
    let result;
    try {
      result = await call("transcribe", { audio }, [audio.buffer]);
    } catch (error) {
      if (current !== generation) return;
      releaseWorker();
      throw error;
    }
    if (current !== generation) return;
    update({
      phase: "ready",
      message: result.text
        ? `Heard you in ${(result.elapsedMs / 1000).toFixed(1)}s.`
        : "No words were heard. Try again.",
    });
    if (result.text) transcript(result.text);
    idle();
  } catch (error) {
    if (current !== generation) return;
    update({
      phase: "error",
      message: error.message,
      needsDownload: /files are missing/i.test(error.message),
    });
    idle();
  }
}
export async function recordVoice() {
  if (!["idle", "ready", "error", "loading"].includes(voiceStatus.phase))
    return;
  const current = ++generation;
  clearTimeout(idleTimer);
  update({
    phase: "requesting",
    seconds: 0,
    message: "Allow microphone access to speak to the colony.",
  });
  try {
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode)
      throw new Error(
        "Voice needs HTTPS or localhost and a browser with microphone support. You can still type below.",
      );
    // Resume in the click gesture, before awaiting the permission prompt.
    context = new AudioContext();
    const activeContext = context;
    const resumed = activeContext.resume().then(
      () => null,
      (error) => error,
    );
    recordingTimer = setTimeout(
      () => cancelVoice("Microphone setup timed out. Please try again."),
      30000,
    );
    prepareVoice({ background: true });
    const acquired = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    if (current !== generation) {
      acquired.getTracks().forEach((t) => t.stop());
      return;
    }
    stream = acquired;
    acquired.getAudioTracks().forEach((track) => {
      track.onended = () => {
        if (current === generation)
          cancelVoice(
            "Microphone disconnected. Your typed message is still here.",
          );
      };
    });
    await activeContext.audioWorklet.addModule(captureUrl);
    if (current !== generation) return;
    const resumeError = await resumed;
    if (resumeError) throw resumeError;
    if (current !== generation) return;
    source = activeContext.createMediaStreamSource(stream);
    microphone = new AudioWorkletNode(activeContext, "colony-microphone");
    silence = activeContext.createGain();
    silence.gain.value = 0;
    source
      .connect(microphone)
      .connect(silence)
      .connect(activeContext.destination);
    microphone.port.onmessage = ({ data }) => {
      if (current !== generation) return;
      if (data.type === "audio") acceptAudio(data, current);
      else update({ level: data.level, seconds: data.seconds });
    };
    update({
      phase: "recording",
      message: "Listening… release to send · 15 seconds maximum.",
    });
    // Wall-clock cutoff also releases the mic if the browser suspends audio.
    clearTimeout(recordingTimer);
    recordingTimer = setTimeout(
      () => cancelVoice("Recording timed out. Please try again."),
      17000,
    );
  } catch (error) {
    if (current !== generation) return;
    stopCapture();
    update({
      phase: "error",
      message:
        error.name === "NotAllowedError"
          ? "Microphone access was declined. Allow it in your browser or type your message below."
          : error.message,
    });
    idle();
  }
}
export function finishVoice() {
  if (voiceStatus.phase === "recording") microphone?.port.postMessage("stop");
  else if (voiceStatus.phase === "requesting")
    cancelVoice("Hold for a little longer once microphone access is allowed.");
}
export function cancelVoice(message) {
  generation++;
  stopCapture();
  if (pending?.kind === "transcribe") releaseWorker();
  update({
    phase: voiceStatus.ready ? "ready" : "idle",
    level: 0,
    seconds: 0,
    message:
      message ||
      (voiceStatus.ready
        ? "Ready when you are."
        : "Hold Space to talk, or type with T."),
  });
  idle();
}
export async function clearVoiceCache() {
  cancelVoice();
  releaseWorker();
  if (typeof caches !== "undefined")
    for (const name of VOICE_CACHES) await caches.delete(name);
  update({
    phase: "idle",
    message: "Whisper’s downloaded files were removed.",
  });
}
export function disposeVoice() {
  cancelVoice();
  releaseWorker();
  voiceStatus.setupError = null;
  voiceStatus.needsDownload = false;
}
