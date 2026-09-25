import {spawnSync} from 'node:child_process';
for(const [command,...args] of [
  ['cargo','build','--release','--locked','--manifest-path','engine/Cargo.toml'],
  ['node','scripts/build-engine.mjs'],
  ['node','scripts/migration/contracts/audit.mjs'],
  ['node','scripts/migration/contracts/parity.mjs'],
]){
  const run=spawnSync(command,args,{stdio:'inherit',env:{...process.env,RUSTC_WRAPPER:''}});
  if(run.error)throw run.error;
  if(run.status!==0)process.exit(run.status||1);
}
