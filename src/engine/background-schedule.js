// A single bounded request, independent of the model/context query queue.
// This worker calculates proposals; commit runs on the authoritative queue.
export class BackgroundSchedule {
  constructor({ enqueue, snapshot, commit, failed }) {
    Object.assign(this, { enqueue, snapshot, commit, failed });
    this.lastAt = -Infinity;
    this.epoch = 0;
    this.nextId = 0;
    this.worker = null;
    this.pending = null;
    this.disabled = false;
  }
  invalidate() { this.epoch++; this.lastAt = -Infinity; }
  request(time, generation) {
    if (this.disabled || this.pending || time - this.lastAt < 2) return;
    if (!this.worker) {
      let worker;
      try { worker = this.worker = new Worker(new URL('./query-worker.js', import.meta.url), { type:'module' }); }
      catch (error) { this.fail(error); return; }
      worker.onmessage = ({data}) => {
        const request = this.pending;
        if (worker !== this.worker || !request || data.id !== request.id || data.generation !== request.generation) return;
        clearTimeout(request.timer);
        // Keep the request outstanding until its commit has run. Otherwise a
        // tick ahead of the callback could replace it with another proposal.
        this.enqueue(() => {
          if (this.pending !== request) return;
          this.pending = null;
          if (data.error) { this.fail(new Error(data.error)); return; }
          if (request.epoch !== this.epoch || !this.commit(data.result, request.generation)) this.lastAt = -Infinity;
        });
      };
      worker.onerror = event => { if (worker === this.worker) this.fail(new Error(event.message || 'Background scheduling stopped.')); };
      worker.onmessageerror = () => { if (worker === this.worker) this.fail(new Error('The background schedule could not be read.')); };
    }
    const request = this.pending = { id:++this.nextId, generation, epoch:this.epoch };
    this.lastAt = time;
    request.timer = setTimeout(() => { if (this.pending === request) this.fail(new Error('Background scheduling timed out.')); }, 15000);
    try {
      this.worker.postMessage({id:request.id,generation,operation:'planning.backgroundSchedule',input:{},
        snapshot:this.snapshot(),iso:new Date().toISOString()});
    } catch (error) { this.fail(error); }
  }
  fail(error) {
    this.reset();
    this.disabled = true;
    this.failed(error);
  }
  reset() {
    clearTimeout(this.pending?.timer);
    this.pending = null;
    this.worker?.terminate(); this.worker = null;
    this.invalidate();
  }
}
