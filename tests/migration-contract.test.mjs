import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {loadManifest,loadInputs,validateManifest,validateInput} from '../scripts/migration/contracts/schema.mjs';
import {discoverInventory,ROOT} from '../scripts/migration/contracts/inventory.mjs';

const path=join(ROOT,'tests/fixtures/manifest.json');
const {manifest,registry}=loadManifest(path);
const inputs=loadInputs(path,manifest,registry);
const copy=value=>structuredClone(value);

test('manifest represents every engine endpoint and explicitly inventories retained rendering',async()=>{
  const inventory=await discoverInventory();
  assert.deepEqual([...registry.operations.keys()].sort(),inventory.surfaces.flatMap(s=>s.operations.map(o=>`${s.id}.${o.id}`)).sort());
  assert.deepEqual(inventory.retainedPresentation.sort(),['game.geometry.project','game.geometry.unproject','game.map.terrainChunk']);
  assert.ok([...registry.operations.values()].every(o=>o.classification==='endpoint'&&o.requirements.length));
});
test('manifest rejects unknown fields and unversioned interfaces',()=>{
  const m=copy(manifest);m.results={};assert.throws(()=>validateManifest(m));
  delete m.results;m.schema='migration-parity/manifest@1';assert.throws(()=>validateManifest(m));
});
test('observable endpoints require semantic requirements',()=>{
  const m=copy(manifest);m.surfaces[0].operations[0].requirements=[];assert.throws(()=>validateManifest(m),/semantic requirements/);
});
test('parity inputs cannot carry expected results',()=>{
  const p=copy(inputs.parity[0].input);p.cases[0].expected={ok:true};assert.throws(()=>validateInput(p,'parity',registry));
});
test('public argument and observation names are checked',()=>{
  const p=copy(inputs.parity[0].input);p.cases[0].steps[0].arguments.undeclared={kind:'literal',value:1};assert.throws(()=>validateInput(p,'parity',registry));
  delete p.cases[0].steps[0].arguments.undeclared;p.cases[0].observations=['missing'];assert.throws(()=>validateInput(p,'parity',registry));
});
test('coverage plans cannot claim undeclared implementation components',()=>{
  const p=copy(inputs.coverage[0].input);p.plans[0].component_ids=['identity-native-code'];assert.throws(()=>validateInput(p,'coverage',registry),/outside covered operation/);
});
test('coverage plans contain selections, never measured outcomes',()=>{
  const p=copy(inputs.coverage[0].input);p.plans[0].covered=100;assert.throws(()=>validateInput(p,'coverage',registry));
});
test('behavioral benchmarks always require a correctness gate',()=>{
  const p=copy(inputs.benchmark[0].input);p.workloads[0].measurement.correctness_gate='not_applicable';assert.throws(()=>validateInput(p,'benchmark',registry));
});
test('stimulus assets stay inside the fixture asset root',()=>{
  const p=copy(inputs.parity[0].input),a=p.cases.flatMap(c=>c.assets).find(a=>a.kind==='ref');
  a.path='../outside.json';assert.throws(()=>validateInput(p,'parity',registry));
});
test('production Rust and worker sources do not access oracle or fixture files',()=>{
  for(const dir of ['engine/src','src/engine'])for(const name of readdirSync(join(ROOT,dir))){
    if(!/\.(rs|js)$/.test(name))continue;
    const text=readFileSync(join(ROOT,dir,name),'utf8');
    assert.doesNotMatch(text,/tests\/fixtures|contract-oracle|oracleDirectory|case_id|workload_id/,`${dir}/${name}`);
  }
});
