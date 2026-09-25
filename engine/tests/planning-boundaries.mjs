// Worker-boundary regressions: JS uses one Number type; JSON may spell the same
// value as 1 or 1.0. These checks exercise the live engine through its public API.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createInterface} from 'node:readline';

const root = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const argv = process.env.TRIPELKINS_ENGINE_ARGV
  ? JSON.parse(process.env.TRIPELKINS_ENGINE_ARGV)
  : [`${root}/engine/target/release/tripelkins-engine`];
const child = spawn(argv[0], argv.slice(1), {cwd: root, stdio: ['pipe', 'pipe', 'inherit']});
const pending = [];
createInterface({input: child.stdout}).on('line', line => pending.shift()(JSON.parse(line)));
const request = (operation, input = {}, raw = null) => new Promise(resolve => {
  pending.push(resolve);
  child.stdin.write(raw ?? `${JSON.stringify({operation, input})}\n`);
});
const call = async (operation, input = {}) => {
  const result = await request(operation, input);
  assert.equal(result.status, 'ok', `${operation}: ${result.message}`);
  return result.value;
};
let passed = 0;
try {
  const world = JSON.parse(readFileSync(`${root}/tests/fixtures/assets/457dabdf1ed298aecaf68a0051fb434f5b3ad6400e40c2daac804190cd2615ef.json`, 'utf8'));
  world.creatures = world.creatures.slice(0, 25);
  world.population = 25;
  await call('load', world);
  await call('community.setIndependence', {accepted: true});
  const current = await call('snapshot');
  const revision = current.commandRevision;
  const plan = await call('planning.makePlan', {policy: 'balanced'});
  assert.equal(await call('planning.applyPlan', {plan}), true);
  passed++;
  await call('planning.selectPlan', {policy: plan.id, source: 'Laya', initial: [plan], expectedCommandRevision: revision});
  passed++;
  const before = await call('snapshot');
  const stale = await request('planning.selectPlan', {policy: plan.id, source: 'Laya', initial: [plan], expectedCommandRevision: revision + 1});
  assert.deepEqual(stale, {status: 'error', message: 'The colony changed while planning.'});
  assert.deepEqual(await call('snapshot'), before, 'Stale selection must not mutate decisions or any world field');
  passed++;
  await call('planning.selectPlan', {policy: plan.id, source: 'Laya', initial: [plan]});
  passed++;
  assert.equal(await call('planning.commitDecision', {result: {revision, plan, source: 'Laya', policy: plan.id}}), true);
  passed++;
  assert.equal(await call('settlement.commitDecision', {result: {revision, choice: null, source: 'Laya'}}), true);
  passed++;

  // Rehydrating a derived plan must not manufacture an extra revision because
  // Rust emitted 1.0 and the browser JSON roundtrip wrote 1.
  await call('development.update');
  const saved = await call('snapshot');
  await call('load', saved);
  await call('development.update');
  assert.equal((await call('snapshot')).revision, saved.revision);
  passed++;

  const projects = [{id: 1, type: 'bath', crew: [], x: 20, y: 20}, {id: 2, type: 'orchard', crew: [], x: 24, y: 24}];
  const projectWorld = structuredClone(world);
  projectWorld.community.project = projects[0];
  projectWorld.community.projects = [projects[1]];
  await call('load', projectWorld);
  const expected = await call('development.projectRequirements', {project: projects[1]});
  const decimalInput = JSON.stringify({operation: 'load', input: projectWorld}).replaceAll('"id":1,', '"id":1.0,').replaceAll('"id":2,', '"id":2.0,');
  assert.equal((await request('load', {}, `${decimalInput}\n`)).status, 'ok');
  assert.deepEqual(await call('development.projectRequirements', {project: projects[1]}), expected);
  passed++;
  await call('contract.call', {surface: 'game.work-projects', operation: 'removeWorkProject', arguments: {id: 2}});
  assert.equal((await call('snapshot')).community.projects.length, 0);
  passed++;

  // Clearance requests also have numeric IDs. A saved ready request must still
  // match the model's chosen request after the reply crosses JSON boundaries.
  const accessWorld = structuredClone(world);
  accessWorld.creatures.forEach(c => { c.task = 'idle'; c.target = null; c.job = null; });
  const worker = accessWorld.creatures[0];
  const tree = {id: 'wire-tree', type: 'tree', x: worker.x + 4, y: worker.y, stock: 12};
  accessWorld.objects.push(tree);
  accessWorld.community.access = [{id: 2, target: 'wire-mine', unit: worker.id,
    point: {x: tree.x + 4, y: tree.y}, task: 'mine', project: null,
    label: 'mine', status: 'ready', blocker: tree.id, crew: [], reason: 'Remove the tree at the mine entrance',
    created: accessWorld.time, lastSeen: accessWorld.time, checked: accessWorld.time}];
  const choice = {id: 'clearance', request: 2, blocker: tree.id};
  await call('load', accessWorld);
  assert.ok(await call('settlement.currentChoice', {choice}), 'The integer-ID clearance scenario must be reachable');
  const accessInput = JSON.stringify({operation: 'load', input: accessWorld}).replaceAll('"id":2,', '"id":2.0,');
  assert.equal((await request('load', {}, `${accessInput}\n`)).status, 'ok');
  assert.ok(await call('settlement.currentChoice', {choice}));
  passed++;
  assert.equal(await call('access.start', {choice, source: 'Laya'}), true);
  passed++;

  // The worker records useful policy decisions, goal reviews and presentation
  // summaries after a command. Exercise those production commit boundaries.
  await call('load', world);
  const objective=await call('goals.add',{spec:{kind:'wood',target:800},command:'Save a wood reserve',source:'Laya'});
  for(const [index,policy] of ['balanced','care','expand','build','industry','mine','balanced','care','expand','balanced'].entries()){
    const now=await call('snapshot'),plan=await call('planning.makePlan',{policy});
    const result={revision:now.commandRevision,plan,policy,source:index%2?'Jev':'Laya',goalId:objective.id,
      ...(index%2?{note:'Keep real materials ready for the colony.'}:{})};
    assert.equal(await call('planning.commitDecision',{result}),true);
    const saved=await call('snapshot'),goal=saved.memory.goals.find(g=>g.id===objective.id);
    assert.equal(goal.reviews.length,Math.min(index+1,8));
    assert.equal(goal.reviews.at(-1).policy,policy);
    assert.equal(saved.memory.lastPlan.goalId,objective.id);
    assert.ok((await call('planning.ui')).goalStates[objective.id]);
    passed++;
  }
  const beforeStale=await call('snapshot');
  assert.equal(await call('planning.commitDecision',{result:{revision:-1,plan:{}}}),false);
  assert.deepEqual(await call('snapshot'),beforeStale);
  passed++;
  assert.equal(await call('settlement.commitDecision',{result:{revision:-1,choice:null,source:'Laya'}}),false);
  assert.deepEqual(await call('snapshot'),beforeStale);
  passed++;
  assert.equal(await call('planning.reschedule'),true);
  passed++;
  console.log(JSON.stringify({suite: 'planning-worker-boundaries', passed, failed: 0}));
} finally {
  child.stdin.end();
}
