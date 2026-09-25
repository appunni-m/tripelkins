import {mkdtempSync,writeFileSync,readFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync,spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
const root=resolve(import.meta.dirname,'../..');
const oracle=mkdtempSync(join(tmpdir(),'tripelkins-state-oracle-'));
execFileSync('tar',['-xf','-','-C',oracle],{input:execFileSync('git',['archive','ae3350fd53414258ce7a9f94a0fe8315c7dafe29','src','package.json'],{cwd:root,maxBuffer:8e6})});
const module=async n=>import(pathToFileURL(join(oracle,'src/game',n+'.js')));
const [state,geometry,map,destruction,navigation,grid,fixtures]=await Promise.all(['state','geometry','map','destruction','navigation','navigation-grid','scale-fixture'].map(module));
const OriginalDate=Date;globalThis.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:['2000-01-01T00:00:00.000Z']));}};
let ids=[],idAt=0;Object.defineProperty(globalThis,'crypto',{value:{getRandomValues(a){a.fill(18492);return a;},randomUUID(){return ids[idAt++]??`missing-${idAt}`;}}});
const argv=process.env.TRIPELKINS_ENGINE_ARGV?JSON.parse(process.env.TRIPELKINS_ENGINE_ARGV):[join(root,'engine/target/release/tripelkins-engine')];
const child=spawn(argv[0],argv.slice(1),{cwd:root,stdio:['pipe','pipe','inherit']});const pending=[];createInterface({input:child.stdout}).on('line',line=>pending.shift()?.resolve(JSON.parse(line)));child.on('exit',code=>pending.splice(0).forEach(p=>p.reject(new Error(`Exit ${code}`))));
const target=(operation,input={})=>new Promise((resolve,reject)=>{pending.push({resolve,reject});child.stdin.write(JSON.stringify({operation,input})+'\n');});
const clone=x=>JSON.parse(JSON.stringify(x));
let passed=0,failed=0;const errors=[];
function diffs(a,b,path='$',out=[]){if(a===b)return out;if(typeof a==='number'&&typeof b==='number'){if(Math.abs(a-b)>1e-10+Math.abs(a)*1e-12)out.push({path,a,b});return out;}if(a&&b&&typeof a==='object'&&typeof b==='object'&&Array.isArray(a)===Array.isArray(b)){for(const k of new Set([...Object.keys(a),...Object.keys(b)]))diffs(a[k],b[k],path+'.'+k,out);}else out.push({path,a,b});return out;}
async function check(name,operation,input,reference){const targetInput=clone(input);let expected;try{expected={status:'ok',value:clone(await reference())};}catch(e){expected={status:'error',message:e.message};}const actual=await target(operation,targetInput);
 // Wall-clock diagnostics are host measurements, outside deterministic game state.
 for(const outcome of [expected,actual])if(outcome?.value?.runtime&&Object.hasOwn(outcome.value.runtime,'schedulerMs'))outcome.value.runtime.schedulerMs=0;
 const d=diffs(expected,actual);if(d.length){failed++;errors.push({name,operation,diffs:d.slice(0,12)});}else passed++;return actual.value;}
async function load(w){await target('load',w);}
let w=fixtures.groundFixture(25);await load(w);
const call=(surface,operation,args,reference)=>check(`${surface}.${operation}`,'contract.call',{surface:'game.'+surface,operation,arguments:args},reference);
for(const type of [...Object.keys(geometry.ASSETS),'missing'])await call('geometry','footprint',{o:{type}},()=>geometry.footprint({type}));
for(const o of [{type:'bridge',x:42,y:25,stock:0},{type:'bridge',x:42,y:25,stock:24},{type:'bridge',x:10,y:10,stock:7,bridge:{a:{x:0,y:0},b:{x:10,y:10},width:3,required:35,delivered:{wood:10,bones:2},complete:true}},{type:'bridge',x:1,y:1,stock:0,bridge:{a:{x:1,y:1},b:{x:1,y:1},width:2.4,complete:true}}]){
 await call('geometry','bridgeGeometry',{o},()=>geometry.bridgeGeometry(o));
 for(const p of [{x:0,y:0},{x:42,y:25},{x:10,y:10}])await call('geometry','bridgePoint',{o,p},()=>geometry.bridgePoint(o,p));
}
const bridge={id:'o900',type:'bridge',x:42,y:25,stock:24};w.objects.push(bridge);w.progress.bridge=true;w.navRevision++;await load(w);
for(const [x,y] of [[-3,24],[24,24],[39,25],[42,25],[42,26],[44,26],[49,27],[24,60],[-20,-20],[1e9-4,0]]){
 for(const radius of [undefined,0,0.28,0.7]){
  const args={p:{x,y},...(radius===undefined?{}:{radius})};await call('geometry','bridgeAt',args,()=>geometry.bridgeAt(w,{x,y},radius)??null);
  await call('geometry','walkableSurface',{x,y,...(radius===undefined?{}:{radius})},()=>geometry.walkableSurface(w,x,y,radius));
 }
 await call('geometry','nearbyObstacles',{x,y},()=>geometry.nearbyObstacles(w,x,y));
}
for(const type of ['tree','rock','factory','bridge','missing'])for(const x of [0,0.3,0.5,0.75,1,2]){
 const o={type,x:0,y:0};await call('geometry','hitsFootprint',{x,y:0.3,r:0.28,o},()=>geometry.hitsFootprint(x,0.3,0.28,o));
}
for(const [cx,cy]of [[-2,-2],[4,4],[-1,0],[1,0]])for(const o of map.chunkObjects(w,cx,cy)){
 const x=Math.floor(o.x),y=Math.floor(o.y);await call('map','naturalBlocked',{x,y},()=>map.naturalBlocked(w,x,y));
}
for(const [x,y]of [[0,0],[42,25],[50,30],[1e9,0]])await call('destruction','meteorTargetError',{x,y},()=>destruction.meteorTargetError(w,x,y));
const obstacles=w.objects;
for(const [a,b]of [[{x:24,y:24},{x:25,y:25}],[{x:24,y:24},{x:60,y:24}],[{x:-20,y:-20},{x:20,y:20}],[{x:42,y:25},{x:49,y:25}]]){
 await call('navigation','lineClear',{a,b,objects:obstacles},()=>navigation.lineClear(w,a,b,obstacles));
 const operation={surface:'game.navigation',operation:'routeCost',arguments:{c:a,p:b}};
 await call('navigation','withRouteCosts',{operation},()=>navigation.withRouteCosts(w,()=>navigation.routeCost(w,a,b)));
 await call('navigation','navigationMemory',{},()=>navigation.navigationMemory(w));
}
for(const [width,left,top]of [[1,0,0],[8,27,27],[8,-3,-3],[35,0,0],[40,55,27]]){
 const tiles=[],inputGrid=Array.from({length:width*width+3},()=>19);
 await call('navigation-grid','copyOccupancy',{tiles,grid:inputGrid,width,left,top},()=>{
  const tiles=new Map(),result=new Uint8Array(inputGrid);grid.copyOccupancy(w,tiles,result,width,left,top);return {grid:[...result],tiles:[...tiles].map(([k,v])=>[k,[...v]])};
 });
}
await check('new-world query preserves cached active world','state.createWorld',{empty:false,seed:18492},()=>state.createWorld());
await call('navigation','navigationMemory',{},()=>navigation.navigationMemory(w));
await check('migration query preserves cached active world','state.migrateWorld',{raw:w},()=>state.migrateWorld(w));
await call('navigation','navigationMemory',{},()=>navigation.navigationMemory(w));
await check('active world after cached queries','snapshot',{},()=>w);
child.stdin.end();mkdirSync(join(root,'artifacts/migration'),{recursive:true});writeFileSync(join(root,'artifacts/migration/spatial-contract-parity.json'),JSON.stringify({passed,failed,errors},null,2));console.log(JSON.stringify({passed,failed,errors:errors.slice(0,15)},null,2));if(failed)process.exitCode=1;
