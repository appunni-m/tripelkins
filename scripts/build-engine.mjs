import {createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {resolve,relative,join} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'..');
const files=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(dir,e.name)):[join(dir,e.name)]).sort();
const inputs=[...files(join(root,'engine/src')),...files(join(root,'engine/data')),join(root,'engine/Cargo.toml'),join(root,'engine/Cargo.lock'),join(root,'rust-toolchain.toml'),import.meta.filename];
const hash=createHash('sha256');
for(const file of inputs)hash.update(relative(root,file)).update('\0').update(readFileSync(file));
const digest=hash.digest('hex'), stamp=join(root,'engine/pkg/.source-hash');
const products=['tripelkins_engine.js','tripelkins_engine_bg.wasm'];
if(products.every(file=>existsSync(join(root,'engine/pkg',file)))&&existsSync(stamp)&&readFileSync(stamp,'utf8')===digest)process.exit(0);
const result=spawnSync('wasm-pack',['build','engine','--target','web','--release','--no-typescript','--no-opt','--locked'],{cwd:root,stdio:'inherit',env:{...process.env,RUSTC_WRAPPER:''}});
if(result.error){console.error('Install wasm-pack 0.15.0 and the Rust toolchain listed in rust-toolchain.toml.');throw result.error;}
if(result.status!==0)process.exit(result.status||1);
writeFileSync(stamp,digest);
