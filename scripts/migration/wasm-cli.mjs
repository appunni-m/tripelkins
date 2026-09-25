// The target adapter executes the shipped WASM, without importing the JS game.
import {readFileSync} from 'node:fs';
import {performance as measurementClock} from 'node:perf_hooks';
import {createInterface} from 'node:readline';
import init,{Engine} from '../../engine/pkg/tripelkins_engine.js';
await init({module_or_path:readFileSync(new URL('../../engine/pkg/tripelkins_engine_bg.wasm',import.meta.url))});
let engine;
for await(const line of createInterface({input:process.stdin})){
  try{
    const {operation,input}=JSON.parse(line);
    let value;
    if(operation==='load'){engine?.free();engine=new Engine(JSON.stringify(input));value=true;}
    else{if(!engine)throw new Error('Load a world first');if(operation==='__measure'){const args=JSON.stringify(input.input),start=measurementClock.now(),result=engine.dispatch(input.operation,args),elapsedMs=measurementClock.now()-start;value={value:JSON.parse(result),elapsedMs};}else value=JSON.parse(engine.dispatch(operation,JSON.stringify(input)));}
    process.stdout.write(JSON.stringify({status:'ok',value})+'\n');
  }catch(error){process.stdout.write(JSON.stringify({status:'error',message:error?.message||String(error)})+'\n');}
}
engine?.free();
