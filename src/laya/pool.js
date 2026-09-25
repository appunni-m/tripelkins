// Each slot owns one single-thread WASM or WebGPU model. Extra slots only read
// the shared download cache and are opened when independent work overlaps.
export class LayaPool {
  constructor({ onChange, onFailure, onProgress }) {
    Object.assign(this, { onChange, onFailure, onProgress });
    this.slots = [];
    this.limit = 1;
    this.nextId = 1;
  }
  configure(limit) { this.limit = limit; this.prune(); }
  report() { this.onChange(this.slots.length, this.slots.filter(s => s.ready).length); }
  prune() {
    while (this.slots.length > this.limit) {
      // Keep the last usable copy while other copies are still initializing.
      const ready = this.slots.filter(s => s.ready).length;
      const idle = this.slots.findLast(s => !s.job && (!s.ready || ready > 1));
      if (!idle) break;
      this.remove(idle);
    }
    this.report();
  }
  remove(slot) {
    slot.worker.terminate();
    this.slots = this.slots.filter(s => s !== slot);
  }
  finish(slot, error, result, failed = false) {
    const job = slot.job;
    if (!job) return;
    clearTimeout(job.timer);
    slot.job = null;
    if (!error) slot.ready = true;
    if (failed || (error && !slot.ready)) {
      this.remove(slot);
      this.onFailure(error, this.slots.some(s => s.ready));
    }
    this.prune();
    if (error) job.reject(error);
    else job.resolve(result);
  }
  create() {
    const slot = { ready: false, job: null, worker: new Worker(new URL("./worker.js", import.meta.url), { type: "module" }) };
    slot.worker.onmessage = ({ data }) => {
      if (!slot.job || data.requestId !== slot.job.id) return;
      if (data.type === "progress") {
        // A slow connection can stay active for longer than five minutes.
        // Time out stalled loading, not a download that is still advancing.
        if (slot.job.loading) {
          clearTimeout(slot.job.timer);
          slot.job.timer = setTimeout(slot.job.timeout, 300000);
        }
        slot.job.onProgress?.(data);
        this.onProgress(data);
        return;
      }
      this.finish(slot, data.type === "error" ? new Error(data.error) : null, data.result);
    };
    slot.worker.onerror = event => this.finish(slot, new Error(event.message || "Local model worker stopped."), null, true);
    this.slots.push(slot);
    this.report();
    return slot;
  }
  call(kind, data, onProgress) {
    let slot = this.slots.find(s => !s.job);
    if (!slot && this.slots.length < this.limit) {
      try { slot = this.create(); }
      catch (error) {
        this.onFailure(error, this.slots.some(s => s.ready));
        return Promise.reject(error);
      }
    }
    if (!slot) return Promise.reject(new Error("All local workers are occupied."));
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timeout = () => this.finish(slot, new Error("Laya took too long. Retry in Options to resume any saved download. The colony's instincts are still running."), null, true);
      const timer = setTimeout(timeout,
        slot.ready && kind !== "load" ? 45000 : 300000);
      slot.job = { id, resolve, reject, timer, timeout, loading: !slot.ready || kind === "load", onProgress };
      try { slot.worker.postMessage({ requestId: id, kind, ...data }); }
      catch (error) { this.finish(slot, error, null, true); }
    });
  }
  clear(reason) {
    for (const slot of [...this.slots]) {
      if (slot.job) { clearTimeout(slot.job.timer); slot.job.reject(new Error(reason)); slot.job = null; }
      this.remove(slot);
    }
    this.report();
  }
}
