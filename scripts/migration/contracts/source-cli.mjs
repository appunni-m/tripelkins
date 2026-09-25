// Disposable reference process. Receives only input stimuli on stdin and emits
// live public observations; it has no target output or expected result input.
import {join} from 'node:path';
import {ROOT} from './inventory.mjs';
import {loadManifest} from './schema.mjs';
import {runSourceInProcess} from './runner.mjs';

let input='';
for await(const chunk of process.stdin)input+=chunk;
const {registry}=loadManifest(join(ROOT,'tests/fixtures/manifest.json'));
const measurements=[];
const result=await runSourceInProcess(JSON.parse(input),registry,measurements);
process.stdout.write(JSON.stringify({result,measurements})+'\n');
