import assert from 'node:assert/strict';
import {join} from 'node:path';
import {existsSync,readFileSync} from 'node:fs';
import {ROOT,discoverInventory} from './inventory.mjs';
import {loadManifest,loadInputs} from './schema.mjs';
const {manifest,registry}=loadManifest(join(ROOT,'tests/fixtures/manifest.json')),inputs=loadInputs(join(ROOT,'tests/fixtures/manifest.json'),manifest,registry),inventory=await discoverInventory();
const source=inventory.surfaces.flatMap(s=>s.operations.map(o=>`${s.id}.${o.id}`)).sort(),declared=[...registry.operations.keys()].sort();assert.deepEqual(declared,source,'Public inventory/manifest bijection');
const operationsWithCases=new Set(inputs.parity.flatMap(f=>f.input.cases.flatMap(c=>c.observations.map(id=>{const s=c.steps.find(s=>s.step_id===id);return `${s.surface}.${s.operation}`;}))));
const report={retainedPresentation:inventory.retainedPresentation,inventory:source.length,declared:declared.length,required:[...registry.operations].filter(([,o])=>o.parity.applicability==='required').length,withParity:operationsWithCases.size,unmapped:[...registry.operations].filter(([key,o])=>o.parity.applicability==='required'&&!operationsWithCases.has(key)).map(([key])=>key),unbound:[...registry.operations].filter(([,o])=>['unimplemented','partial'].includes(o.targets[0].support.status)).map(([key])=>key)};
for(const command of manifest.commands){if(command.argv[0]==='node')assert.ok(existsSync(join(ROOT,command.argv[1])),`Missing command ${command.id}`);}
console.log(JSON.stringify(report,null,2));if(report.unmapped.length||report.unbound.length)process.exitCode=1;
