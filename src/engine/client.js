// The browser owns presentation. All authoritative commands are serialized by
// the worker; neither a stale reply nor a restored world can replace newer state.
export class EngineClient {
  constructor({ onState = () => {}, onHealth = () => {}, onFailure = () => {} } = {}) {
    this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    this.world = null;
    this.generation = 0;
    this.nextId = 1;
    this.pending = new Map();
    this.onState = onState;
    this.onHealth = onHealth;
    this.onFailure = onFailure;
    this.failed = null;
    this.presentationKey = '';
    this.views=null;
    this.presentationInFlight=false;
    this.latestPresentation=null;
    this.disposed=false;
    this.worker.onmessage = ({ data }) => {
      if(this.failed || this.disposed)return;
      if (data.generation !== this.generation) return;
      if(data.protocol!==1){this.fail(new Error('The colony engine protocol is incompatible. Reload this page.'));return;}
      if (data.kind === 'failure') { this.fail(new Error(data.error)); return; }
      if(data.kind==='presentationAck'){this.presentationInFlight=false;this.flushPresentation();return;}
      if(data.views)this.views=data.views;
      if (data.health) this.onHealth(data.health);
      if (data.state) this.accept(data.state, data.uiPatch);
      if (data.kind === 'frame') {
        // At most one outstanding frame. Slow rendering replaces presentation
        // with the next current snapshot, never a growing queue of old worlds.
        this.worker.postMessage({ protocol:1,kind:'ack',generation:this.generation });
        return;
      }
      const job = this.pending.get(data.id);
      if (!job) return;
      this.pending.delete(data.id);
      clearTimeout(job.timer);
      if (data.error) job.reject(new Error(data.error));
      else job.resolve(data.result);
    };
    this.worker.onerror = event => this.fail(new Error(event.message || 'The colony engine stopped. Reload to recover the last saved world.'));
    this.worker.onmessageerror = () => this.fail(new Error('The colony engine returned an unreadable message.'));
  }
  accept(snapshot, uiPatch) {
    if (!this.world) this.world = snapshot;
    else {
      const ui=this.world.ui, settings=this.world.settings;
      // Keep the identity of this world stable while ticks arrive. Restoring
      // explicitly creates a new identity, invalidating in-flight conversations.
      for(const key of Object.keys(this.world)) if(!(key in snapshot))delete this.world[key];
      Object.assign(this.world,snapshot,{ui,settings});
      if(uiPatch)Object.assign(ui,uiPatch);
    }
    this.onState(this.world);
  }
  fail(error) {
    if (this.failed) return;
    this.failed=error;
    this.worker.terminate();
    for(const job of this.pending.values()){clearTimeout(job.timer);job.reject(error);}
    this.pending.clear();if(!this.disposed)this.onFailure(error);
  }
  send(kind, payload = {}, timeoutMs = 120000) {
    if(this.failed)return Promise.reject(this.failed);
    if(this.pending.size>=64)return Promise.reject(new Error('The colony is catching up. Please try again shortly.'));
    const id=this.nextId++, generation=this.generation;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{
        const error=new Error(kind==='storage'&&payload.operation==='replace'
          ? 'Restoring the saved world took too long to confirm. Reload to see which saved world was committed.'
          : `The colony engine timed out during ${kind}. Reload to recover the latest saved world.`);
        if(kind==='command'||kind==='storage'||kind==='adoptGeneration')this.fail(error);
        else{this.pending.delete(id);reject(error);}
      },timeoutMs);
      this.pending.set(id,{resolve,reject,timer});
      try{this.worker.postMessage({protocol:1,kind,id,generation,...payload});}
      catch(error){clearTimeout(timer);this.pending.delete(id);reject(error);}
    });
  }
  async initialize(options) { await this.send('initialize',options);return this.world; }
  updatePresentation({ paused, ui, settings, intelligenceAvailable, growth }) {
    if(!this.world || this.failed)return;
    const value={paused,ui,settings,intelligenceAvailable,growth};
    const key=JSON.stringify(value);
    if(key===this.presentationKey)return;
    this.presentationKey=key;
    this.latestPresentation=structuredClone(value);
    this.flushPresentation();
  }
  flushPresentation(){
    if(this.presentationInFlight || !this.latestPresentation || this.failed)return;
    this.presentationInFlight=true;
    this.worker.postMessage({protocol:1,kind:'presentation',generation:this.generation,...this.latestPresentation});
    this.latestPresentation=null;
  }
  query(operation,input={}, {snapshot}={}) {return this.send('query',{operation,input,snapshot});}
  command(operation,input={}) {
    return this.send('command',{operation,input,ui:this.world.ui,settings:this.world.settings});
  }
  storage(operation,input={}) {return this.send('storage',{operation,input,ui:this.world?.ui,settings:this.world?.settings});}
  async replace(next,source=next,origin=null) {
    // The old worker retains the world until the storage transaction succeeds.
    const result=await this.storage('replace',{next,source,origin});
    for(const job of this.pending.values()){clearTimeout(job.timer);job.reject(new Error('A different saved world was opened.'));}
    this.pending.clear();this.generation++;
    this.world=result;this.presentationKey='';this.presentationInFlight=false;this.latestPresentation=null;this.views=null;
    await this.send('adoptGeneration');
    this.onState(this.world);return this.world;
  }
  dispose() {this.disposed=true;this.fail(new Error('The colony view closed.'));this.worker.terminate();}
}
