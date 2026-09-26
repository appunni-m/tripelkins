import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
export const SOURCE_REVISION='8f6767015037123a17c711bf55e73f860608598f';
export const ROOT=resolve(import.meta.dirname,'../../..');
// Public simulation/planning/state exports define the denominator. Presentation
// and disposable test workloads are separate consumers of these production APIs.
const excluded=new Set(['art.js','prologue.js','scenarios.js','scale-fixture.js','colony-audit.js','evaluation.js','command-evaluation.js','settlement-evaluation.js']);
export function sourceFiles(){return execFileSync('git',['ls-tree','-r','--name-only',SOURCE_REVISION,'src/game'],{cwd:ROOT,encoding:'utf8'}).trim().split('\n').filter(path=>path.endsWith('.js')&&!excluded.has(basename(path)));}
// These three exports are presentation only, retained in JavaScript by the
// user's explicit rendering boundary. Keep them visible in inventory output.
export const PRESENTATION_EXPORTS = new Set(['game.geometry.project', 'game.geometry.unproject', 'game.map.terrainChunk']);
let oracle;
export function oracleDirectory(){if(!oracle){oracle=mkdtempSync(join(tmpdir(),'tripelkins-contract-oracle-'));process.once('exit',()=>rmSync(oracle,{recursive:true,force:true}));execFileSync('tar',['-xf','-','-C',oracle],{input:execFileSync('git',['archive',SOURCE_REVISION,'src','package.json'],{cwd:ROOT,maxBuffer:8e6})});}return oracle;}
function splitParameters(value){const out=[];let begin=0,depth=0,quote=null;for(let i=0;i<value.length;i++){const ch=value[i];if(quote){if(ch==='\\'){i++;continue;}if(ch===quote)quote=null;continue;}if('"\'`'.includes(ch)){quote=ch;continue;}if('({['.includes(ch))depth++;if(')}]'.includes(ch))depth--;if(ch===','&&depth===0){out.push(value.slice(begin,i).trim());begin=i+1;}}if(value.slice(begin).trim())out.push(value.slice(begin).trim());return out;}
function declaration(fn){const source=Function.prototype.toString.call(fn);const start=source.indexOf('('),arrow=source.indexOf('=>');if(start<0 || (arrow>=0&&arrow<start)){const parameter=source.slice(0,arrow).replace(/^async\s+/, '').trim();return {signature:parameter+' =>',parameters:[parameter]};}let end=start,depth=0,quote=null;for(;end<source.length;end++){const ch=source[end];if(quote){if(ch==='\\'){end++;continue;}if(ch===quote)quote=null;continue;}if('"\'`'.includes(ch)){quote=ch;continue;}if(ch==='(')depth++;if(ch===')'&&--depth===0)break;}const params=source.slice(start+1,end);return {signature:source.slice(0,end+1).replace(/\s+/g,' ').trim(),parameters:splitParameters(params)};}
export async function discoverInventory(){const surfaces=[];for(const path of sourceFiles()){const module=await import(pathToFileURL(join(oracleDirectory(),path)));const id=`game.${basename(path,'.js')}`;const operations=Object.entries(module).filter(([name])=>!PRESENTATION_EXPORTS.has(`${id}.${name}`)).map(([id,value])=>({id,kind:typeof value==='function'?'function':'constant',...(typeof value==='function'?declaration(value):{signature:id,parameters:[]})}));surfaces.push({id,source_path:path,storage_slug:basename(path,'.js'),operations});}return {authority:'scripts/migration/contracts/inventory.mjs#sourceFiles',revision:SOURCE_REVISION,retainedPresentation:[...PRESENTATION_EXPORTS],surfaces};}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPathSafe(import.meta.url)){const inventory=await discoverInventory();console.log(JSON.stringify(inventory,null,2));}
function fileURLToPathSafe(url){return new URL(url).pathname;}
