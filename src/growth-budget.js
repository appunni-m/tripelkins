import { LIMITS } from "./game/catalog.js";
// Runtime-only admission control. No existing creature is removed when load rises.
// GPU duty is this WebGL renderer's measured execution time, not device utilization.
export const GPU_GROWTH_TARGET = 0.5;
export class GrowthBudget {
  constructor() { this.world = null; }
  reset(w, now) {
    this.world = w;
    this.since = now;
    this.elapsed = this.cpu = this.frames = this.slow = 0;
    this.held = false;
    this.state = { limit: Math.max(96, w.creatures.length), held: false,
      target: GPU_GROWTH_TARGET, gpuDuty: null, cpuDuty: 0, source: "warming",
      reason: "Measuring room for growth", sampledAt: now };
  }
  update(w, { now, elapsed, cpuMs, rendered, gpu, paused }) {
    if (this.world !== w) this.reset(w, now);
    w.runtime ||= {};
    w.runtime.growth = this.state;
    if (paused) {
      this.since = now;
      this.elapsed = this.cpu = this.frames = this.slow = 0;
      return;
    }
    this.elapsed += Math.min(250, elapsed);
    this.cpu += cpuMs;
    this.frames += rendered ? 1 : 0;
    this.slow += elapsed > 75 ? Math.min(250, elapsed) : 0;
    if (now - this.since < 5000 || this.elapsed < 4000) return;
    const cpuDuty = this.cpu / this.elapsed;
    const measured = gpu?.samples >= 6 && now - gpu.lastSample < 3000;
    const gpuDuty = measured ? gpu.ms * this.frames / this.elapsed : null;
    const pressure = Math.max(cpuDuty / 0.45, (gpuDuty || 0) / GPU_GROWTH_TARGET,
      (this.slow / this.elapsed) / 0.2);
    const atMemoryLimit = w.creatures.length >= LIMITS.creatures;
    if (pressure >= 1 || atMemoryLimit) this.held = true;
    else if (pressure < 0.85) this.held = false;
    const reason = atMemoryLimit ? "Saved-world safety limit reached" : this.held
      ? gpuDuty >= GPU_GROWTH_TARGET ? "Rendering is at the growth budget" : "Keeping the game responsive"
      : "Room for more little lives";
    let limit = this.state.limit;
    if (this.held) limit = w.creatures.length;
    else if (w.creatures.length >= limit - 4)
      limit = Math.max(limit, w.creatures.length + Math.max(4, Math.min(16, Math.ceil(w.creatures.length * 0.025))));
    Object.assign(this.state, { limit:Math.min(LIMITS.creatures,limit), held: this.held, gpuDuty, cpuDuty,
      source: measured ? "gpu-timer" : "frame-time", reason, sampledAt: now });
    this.since = now;
    this.elapsed = this.cpu = this.frames = this.slow = 0;
  }
}

// Asynchronous, bounded WebGL2 queries. Never wait on the GPU or call gl.finish().
export class RenderGpuTimer {
  constructor(gl) {
    this.gl = gl;
    this.ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
    this.pending = [];
    this.frame = 0;
    this.stats = { samples: 0, ms: 0, lastSample: 0 };
  }
  begin() {
    const { gl, ext } = this;
    if (!ext || gl.isContextLost()) return;
    const now = performance.now();
    if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
      this.clear();
      this.stats = { samples: 0, ms: 0, lastSample: 0 };
      return;
    }
    while (this.pending.length) {
      const item = this.pending[0];
      if (!gl.getQueryParameter(item.query, gl.QUERY_RESULT_AVAILABLE)) {
        if (now - item.at > 3000) { gl.deleteQuery(item.query); this.pending.shift(); }
        else break;
        continue;
      }
      const ms = gl.getQueryParameter(item.query, gl.QUERY_RESULT) / 1e6;
      gl.deleteQuery(item.query);
      this.pending.shift();
      if (Number.isFinite(ms) && ms > 0 && ms < 1000) {
        this.stats.ms = this.stats.samples ? this.stats.ms * 0.9 + ms * 0.1 : ms;
        this.stats.samples++;
        this.stats.lastSample = now;
      }
    }
    if (++this.frame % 10 || this.pending.length >= 4) return;
    this.active = gl.createQuery();
    if (this.active) gl.beginQuery(ext.TIME_ELAPSED_EXT, this.active);
  }
  end() {
    if (!this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push({ query: this.active, at: performance.now() });
    this.active = null;
  }
  clear() {
    if (this.active) { this.gl.deleteQuery(this.active); this.active = null; }
    for (const { query } of this.pending) this.gl.deleteQuery(query);
    this.pending = [];
  }
}
