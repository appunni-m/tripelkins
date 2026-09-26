// Read-only Rust planning runs independently of the authoritative simulation.
// Every request owns a snapshot; this worker can never commit colony changes.
import init, {Engine} from '../../engine/pkg/tripelkins_engine.js';
import wasmUrl from '../../engine/pkg/tripelkins_engine_bg.wasm?url';
const ready=init({module_or_path:wasmUrl});
let tail=Promise.resolve();
self.onmessage=({data})=>{
  tail=tail.then(async()=>{
    await ready;
    let copy;
    try{
      copy=new Engine(data.snapshot);
      copy.dispatch('clock',JSON.stringify({iso:data.iso}));
      const result=JSON.parse(copy.dispatch(data.operation,JSON.stringify(data.input)));
      self.postMessage({id:data.id,generation:data.generation,result});
    }finally{copy?.free();}
  }).catch(error=>self.postMessage({id:data.id,generation:data.generation,error:error.message||String(error)}));
};
