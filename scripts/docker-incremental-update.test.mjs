import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canReuseMongoBootstrap, getIncrementalServiceGroups, getRuntimeContentOverride, updateRuntimeServices } from './docker-compose-runtime.mjs';

const hash = 'a'.repeat(64);
const services = {
  'mongo-auth-bootstrap': {},
  mongo: { depends_on: { 'mongo-auth-bootstrap': {} } },
  processor: { depends_on: { mongo: {} } },
  client: {},
  'media-gateway': {},
  'media-tunnel-controller': { depends_on: { 'media-gateway': {} } },
  'reverse-proxy': { depends_on: { processor: {}, client: {} } },
  genblaze: {},
};

function fixture({ bootstrap = `exited 0 ${hash}`, ids = 'bootstrap-id', buildFails = false } = {}) {
  const calls = [];
  return {
    calls,
    runCompose: async (profiles, args) => {
      calls.push({ profiles, args });
      if (buildFails && args[0] === 'build') throw new Error('build failed');
    },
    captureCompose: async (_profiles, args) => {
      if (args[0] === 'ps') return ids;
      if (args.includes('--hash')) return `mongo-auth-bootstrap ${hash}\n`;
      return JSON.stringify({ services });
    },
    inspectBootstrap: async id => {
      assert.equal(id, 'bootstrap-id');
      return bootstrap;
    },
  };
}

test('incremental update keeps unchanged MongoDB and never forces service recreation', async () => {
  const f = fixture();
  const profiles = ['core', 'local-mongo', 'local-media', 'genblaze', 'reverse-proxy'];
  await updateRuntimeServices(profiles, f);
  assert.deepEqual(f.calls[0], { profiles, args: ['build'] });
  assert.ok(f.calls.every(({ args }) => !args.includes('--force-recreate') && !['stop', 'rm', 'down'].includes(args[0])));
  const ups = f.calls.filter(({ args }) => args[0] === 'up');
  assert.ok(ups.every(({ args }) => args.includes('--no-build') && args.includes('--no-deps') && args.includes('--wait')));
  assert.ok(ups.every(({ args }) => !args.includes('mongo-auth-bootstrap')));
  assert.ok(ups.findIndex(({ args }) => args.includes('mongo')) < ups.findIndex(({ args }) => args.includes('processor')));
  assert.ok(ups.findIndex(({ args }) => args.includes('processor')) < ups.findIndex(({ args }) => args.includes('reverse-proxy')));
  assert.equal(ups.at(-1).args.at(-1), 'genblaze');
  assert.deepEqual(f.calls.at(-1).args, ['exec', '-T', 'reverse-proxy', 'sh', '-ec', 'nginx -t && nginx -s reload']);
});

for (const [name, options] of [
  ['changed credentials', { bootstrap: `exited 0 ${'b'.repeat(64)}` }],
  ['failed bootstrap', { bootstrap: `exited 1 ${hash}` }],
  ['missing bootstrap', { ids: '' }],
]) {
  test(`${name} reruns offline authentication before MongoDB and dependent services start`, async () => {
    const f = fixture(options);
    await updateRuntimeServices(['core', 'local-mongo', 'genblaze'], f);
    const args = f.calls.map(call => call.args);
    const stop = args.findIndex(call => call[0] === 'stop' && call[1] === 'mongo');
    const bootstrap = args.findIndex(call => call[0] === 'up' && call.includes('mongo-auth-bootstrap'));
    const mongo = args.findIndex(call => call[0] === 'up' && call.includes('mongo'));
    assert.ok(stop > 0 && bootstrap > stop && mongo > bootstrap);
    assert.ok(args.filter(call => call.includes('--force-recreate')).every(call => call.includes('mongo-auth-bootstrap')));
  });
}

test('build failure leaves every running service untouched', async () => {
  const f = fixture({ buildFails: true });
  await assert.rejects(updateRuntimeServices(['core', 'local-mongo'], f), /build failed/);
  assert.deepEqual(f.calls, [{ profiles: ['core', 'local-mongo'], args: ['build'] }]);
});

test('unreadable bootstrap configuration stops the update rather than guessing', async () => {
  await assert.rejects(canReuseMongoBootstrap({
    captureCompose: async (_profiles, args) => args[0] === 'ps' ? 'bootstrap-id' : 'invalid',
    inspectBootstrap: async () => { throw new Error('must not inspect'); },
  }), /configuration hash/);
});

test('an infrastructure failure prevents dependent containers from being updated', async () => {
  const f = fixture();
  const original = f.runCompose;
  f.runCompose = async (profiles, args) => {
    await original(profiles, args);
    if (args[0] === 'up' && args.includes('mongo')) throw new Error('mongo not healthy');
  };
  await assert.rejects(updateRuntimeServices(['core', 'local-mongo', 'genblaze'], f), /mongo not healthy/);
  assert.equal(f.calls.some(({ args }) => args[0] === 'up' && args.includes('processor')), false);
});

test('dependency planning rejects cycles and tolerates disabled optional dependencies', () => {
  assert.throws(() => getIncrementalServiceGroups({ a: { depends_on: { b: {} } }, b: { depends_on: { a: {} } } }), /cyclic/);
  assert.deepEqual(getIncrementalServiceGroups({ processor: { depends_on: { mongo: { required: false } } } }), [['processor']]);
});

test('mounted config hashes stay stable and change only the affected service', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-config-content-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const catalog = path.join(root, 'runtime/config/genblaze-model-catalog.json');
  const bootstrap = path.join(root, 'deploy/compose/mongo/bootstrap-auth.sh');
  for (const file of [catalog, bootstrap]) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'initial content');
  }
  const before = getRuntimeContentOverride(root);
  fs.utimesSync(catalog, new Date(), new Date());
  assert.deepEqual(getRuntimeContentOverride(root), before);
  fs.writeFileSync(catalog, 'changed model mappings');
  const after = getRuntimeContentOverride(root);
  assert.notDeepEqual(after.services.genblaze, before.services.genblaze);
  assert.deepEqual(after.services['mongo-auth-bootstrap'], before.services['mongo-auth-bootstrap']);
  assert.equal(after.services.processor, undefined);
});
