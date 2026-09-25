// Live, input-only differential checks. The reference comes from the pinned git
// object, never from Rust results or stored expected outputs.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
const revision='ae3350fd53414258ce7a9f94a0fe8315c7dafe29';
const root=resolve(import.meta.dirname,'../..');
const oracle=mkdtempSync(join(tmpdir(),'tripelkins-oracle-'));
execFileSync('tar',['-xf','-','-C',oracle],{input:execFileSync('git',['archive',revision,'src','package.json'],{cwd:root,maxBuffer:8e6})});
const map=await import(pathToFileURL(join(oracle,'src/game/map.js')));
const geometry=await import(pathToFileURL(join(oracle,'src/game/geometry.js')));
const navigation=await import(pathToFileURL(join(oracle,'src/game/navigation.js')));
const discovery=await import(pathToFileURL(join(oracle,'src/game/discovery.js')));
const cases=JSON.parse(readFileSync(join(root,'tests/deprecated/migration-diagnostics/spatial.json')));
if(cases.schema!=='tripelkins/spatial-parity@1' || Object.keys(cases).sort().join()!=='cases,schema')throw new Error('Unsupported parity input');
const argv=process.env.TRIPELKINS_ENGINE_ARGV?JSON.parse(process.env.TRIPELKINS_ENGINE_ARGV):[join(root,'engine/target/release/tripelkins-engine')];
const child=spawn(argv[0],argv.slice(1),{stdio:['pipe','pipe','inherit']});
const pending=[];createInterface({input:child.stdout}).on('line',line=>pending.shift()?.resolve(JSON.parse(line)));
child.on('exit',code=>{if(pending.length)pending.splice(0).forEach(p=>p.reject(new Error(`Target exited: ${code}`)));});
const target=(operation,input)=>new Promise((resolve,reject)=>{pending.push({resolve,reject});child.stdin.write(JSON.stringify({operation,input})+'\n');});
function reference(w,op,input){switch(op){
 case 'terrain.hash':return map.hash(input.seed,input.x,input.y,input.salt);
 case 'terrain.chunkObjects':return map.chunkObjects(w,input.cx,input.cy);
 case 'terrain.isGround':return map.isGround(w,input.x,input.y);
 case 'terrain.isWater':return map.isWater(w,input.x,input.y);
 case 'terrain.biome':return map.biome(w,input.x,input.y);
 case 'terrain.riverLeft':return map.riverLeft(w,input.y);
 case 'terrain.naturalObjects':return map.naturalObjects(w,input.min.x,input.min.y,input.max.x,input.max.y);
 case 'terrain.nearbyObjects':return map.nearbyObjects(w,input.x,input.y,input.radius);
 case 'terrain.clearNatural':return map.clearNatural(w,input);
 case 'terrain.normalize':return map.normalizeMap(input.map,input.required);
 case 'geometry.clearPosition':return geometry.clearPosition(w,input.point,input.radius,input.ignore);
 case 'geometry.canPlace':return geometry.canPlace(w,input.type,input.point,input.ignore,{ignoreCreatures:input.ignoreCreatures});
 case 'geometry.serviceSlots':return geometry.serviceSlots(w,input.object,input.from);
 case 'geometry.freePosition':return geometry.freePosition(w,input.point,input.others,input.radius);
 case 'geometry.sweptMove':{const point={...input.point};const moved=geometry.sweptMove(w,point,input.dx,input.dy);return {point,moved};}
 case 'navigation.waypoint':return navigation.waypoint(w,input.from,input.to);
 case 'navigation.routeCost':return navigation.routeCost(w,input.from,input.to);
 case 'discovery.reveal':return discovery.reveal(w,input.point,input.radius);
 case 'discovery.isExplored':return discovery.isExplored(w,input);
 case 'discovery.summary':return discovery.discoverySummary(w);
 case 'snapshot':return w;
 default:throw new Error(`Missing oracle endpoint ${op}`);
}}
function compare(a,b,path='$',diffs=[]){
 if(typeof a==='number'&&typeof b==='number') {if(Math.abs(a-b)>1e-10+Math.abs(a)*1e-12)diffs.push({path,source:a,target:b});return diffs;}
 if(a===b)return diffs;
 if(a&&b&&typeof a==='object'&&typeof b==='object'&&Array.isArray(a)===Array.isArray(b)){
  const keys=[...new Set([...Object.keys(a),...Object.keys(b)])].sort();for(const k of keys)compare(a[k],b[k],`${path}.${k}`,diffs);return diffs;
 }diffs.push({path,source:a,target:b});return diffs;
}
const output=[];
try{for(const c of cases.cases){
 if(Object.keys(c).sort().join()!=='id,steps,world')throw new Error('Unknown case fields');
 const w=structuredClone(c.world);const loaded=await target('load',w);if(loaded.status!=='ok')throw new Error(loaded.message);
 for(const step of c.steps){
  if(Object.keys(step).sort().join()!=='input,operation')throw new Error('Unknown step fields');
  let source;try{source={status:'ok',value:JSON.parse(JSON.stringify(reference(w,step.operation,step.input)))}}catch(e){source={status:'error',message:e.message};}
  const result=await target(step.operation,step.input);const diffs=compare(source,result);
  output.push({case:c.id,operation:step.operation,status:diffs.length?'fail':'pass',diffs:diffs.slice(0,8)});
 }
}}finally{child.stdin.end();}
const report={reference:revision,targetSourceSHA256:createHash('sha256').update(execFileSync('git',['diff','--','engine'])).digest('hex'),passed:output.filter(r=>r.status==='pass').length,failed:output.filter(r=>r.status==='fail').length,results:output};
mkdirSync(join(root,'artifacts/migration'),{recursive:true});writeFileSync(join(root,'artifacts/migration/spatial-parity.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({passed:report.passed,failed:report.failed,failures:output.filter(r=>r.status==='fail').slice(0,10)},null,2));
if(report.failed)process.exitCode=1;
