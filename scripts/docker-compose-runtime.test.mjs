import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  ALL_RUNTIME_COMPOSE_PROFILES,
  getRuntimeComposeProfiles,
  startRuntimeServices,
} from './docker-compose-runtime.mjs';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function cliFixture(t, failure, action = 'up', flags = []) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-compose-recovery-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const relative of ['scripts', 'apps/setup-wizard', 'deploy/compose', 'runtime/config', 'bin']) {
    fs.mkdirSync(path.join(directory, relative), { recursive: true });
  }
  for (const relative of ['scripts/docker-compose-runtime.mjs', 'scripts/docker-maintenance.mjs', 'apps/setup-wizard/genblazeCompose.mjs', 'apps/setup-wizard/composeRecovery.mjs']) {
    fs.copyFileSync(path.join(sourceRoot, relative), path.join(directory, relative));
  }
  fs.writeFileSync(path.join(directory, 'runtime/config/samsar.config.json'), JSON.stringify({
    services: { workers: false, localMongo: false, minio: false, mediaGateway: false, logger: false },
  }));
  const eventsPath = path.join(directory, 'events.jsonl');
  const errorMessage = failure === 'conflict'
    ? `Conflict. The container name "/samsar-processor-1" is already in use by container "${'a'.repeat(64)}".`
    : 'ports are not available: listen tcp4 127.0.0.1:27017: bind: address already in use';
  fs.writeFileSync(path.join(directory, 'bin/docker'), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(eventsPath)}, JSON.stringify(args) + '\\n');
if (args[0] === 'inspect') {
  console.log(JSON.stringify({
    'com.docker.compose.project': 'samsar',
    'com.docker.compose.service': 'processor',
    'com.docker.compose.project.working_dir': ${JSON.stringify(path.join(directory, 'deploy', 'compose'))},
  }));
} else if (args.includes('config')) {
  console.log(args.includes('--format') ? JSON.stringify({ services: { processor: {}, client: {} } }) : 'processor\\nclient');
} else if (args.includes('stop') && ${failure === 'stop'}) {
  process.exit(37);
} else if (args.includes('up')) {
  const marker = ${JSON.stringify(path.join(directory, 'attempted'))};
  if (${Boolean(failure)} && !fs.existsSync(marker)) {
    fs.writeFileSync(marker, 'yes');
    console.error(${JSON.stringify(errorMessage)});
    process.exit(37);
  }
}
`, { mode: 0o755 });
  const result = spawnSync(process.execPath, ['scripts/docker-compose-runtime.mjs', action, ...flags], {
    cwd: directory, encoding: 'utf8', timeout: 15000,
    env: { ...process.env, PATH: `${path.join(directory, 'bin')}${path.delimiter}${process.env.PATH}` },
  });
  assert.ifError(result.error);
  return {
    ...result,
    directory,
    events: fs.readFileSync(eventsPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line)),
  };
}

test('the incremental CLI builds cached images and starts services without force-recreate', {
  skip: process.platform === 'win32',
}, t => {
  const result = cliFixture(t, null, 'update');
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.events[0].includes('build'));
  const up = result.events.find(args => args.includes('up'));
  assert.ok(up.includes('--no-build') && up.includes('--no-deps'));
  assert.ok(!up.includes('--force-recreate'));
  assert.deepEqual(up.slice(-2), ['processor', 'client']);
});

test('maintenance stops consumers before building and applies the idle override to startup', {
  skip: process.platform === 'win32',
}, t => {
  const result = cliFixture(t, null, 'update', ['--no-jobs']);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.events[0].includes('stop'));
  assert.ok(result.events[0].includes('processor') && result.events[0].includes('task-processor'));
  assert.ok(result.events.findIndex(args => args.includes('build')) > 0);
  const overridePath = path.join(fs.realpathSync(result.directory), 'runtime/config/compose.jobs-disabled.json');
  const override = JSON.parse(fs.readFileSync(overridePath, 'utf8'));
  assert.equal(override.services.processor.environment.SAMSAR_BACKGROUND_JOBS_ENABLED, 'false');
  assert.equal(override.services['task-processor'].restart, 'no');
  for (const args of result.events.filter(args => args.includes('build') || args.includes('up'))) {
    assert.ok(args.includes(overridePath), JSON.stringify(args));
  }
});

test('a maintenance stop failure prevents image builds and container startup', {
  skip: process.platform === 'win32',
}, t => {
  const result = cliFixture(t, 'stop', 'update', ['--no-jobs']);
  assert.equal(result.status, 37, result.stderr);
  assert.equal(result.events.length, 1);
  assert.ok(result.events[0].includes('stop'));
});

test('F2P: the real CLI recovers a stale container from the nested Compose directory', {
  skip: process.platform === 'win32',
}, (t) => {
  const result = cliFixture(t, 'conflict');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.events.find((args) => args[0] === 'rm'), ['rm', '--force', 'a'.repeat(64)]);
  const starts = result.events.filter((args) => args.includes('up'));
  assert.equal(starts.length, 2);
  assert.ok(starts[0].includes('--build'));
  assert.ok(starts[1].includes('--no-build'));
  assert.ok(starts[1].includes('--force-recreate'));
});

test('the real CLI preserves the exit code of an unrelated Docker failure', {
  skip: process.platform === 'win32',
}, (t) => {
  const result = cliFixture(t, 'port');
  assert.equal(result.status, 37);
  assert.equal(result.events.filter((args) => args.includes('up')).length, 1);
  assert.ok(!result.events.some((args) => args[0] === 'inspect' || args[0] === 'rm'));
});

test('enables the GenBlaze profile only for an enabled GMICloud service', () => {
  const disabled = getRuntimeComposeProfiles({
    providers: { gmicloud: { enabled: false } },
    services: { genblaze: false },
  });
  assert.equal(disabled.includes('genblaze'), false);

  const enabled = getRuntimeComposeProfiles({
    providers: { gmicloud: { enabled: true } },
    services: { genblaze: true },
  });
  assert.equal(enabled.includes('genblaze'), true);
});

test('restart builds all enabled profiles before stopping or recreating services', async () => {
  const calls = [];
  const profiles = ['core', 'workers', 'local-mongo', 'logger'];
  await startRuntimeServices(profiles, {
    restart: true,
    runCompose: (selectedProfiles, args) => calls.push({ profiles: selectedProfiles, args }),
  });
  assert.deepEqual(calls[0], { profiles, args: ['build'] });
  const stopIndex = calls.findIndex(({ args }) => args[0] === 'stop');
  const up = calls.find(({ args }) => args[0] === 'up' && args.includes('--wait'));
  assert.ok(stopIndex > 0);
  assert.deepEqual(up.profiles, profiles);
  assert.ok(up.args.includes('--force-recreate'));
  assert.ok(up.args.includes('--no-build'));
  assert.ok(calls.every(({ args }) => !args.includes('down') && !args.includes('-v')));
});

test('failed restart builds leave existing containers untouched', async () => {
  const calls = [];
  await assert.rejects(() => startRuntimeServices(['core', 'workers', 'local-mongo'], {
    restart: true,
    runCompose: (_profiles, args) => {
      calls.push(args);
      throw new Error('image build failed');
    },
  }), /image build failed/);
  assert.deepEqual(calls, [['build']]);
});

test('restart recreates enabled GenBlaze and reverse proxy without rebuilding after startup', async () => {
  const calls = [];
  await startRuntimeServices(['core', 'workers', 'genblaze', 'reverse-proxy'], {
    restart: true,
    runCompose: (profiles, args) => calls.push({ profiles, args }),
  });
  assert.equal(calls[0].args[0], 'build');
  const ups = calls.filter(({ args }) => args[0] === 'up');
  assert.equal(ups.length, 3);
  for (const { args } of ups) {
    assert.ok(args.includes('--force-recreate'));
    assert.ok(!args.includes('--build'));
  }
  assert.ok(!ups[0].profiles.includes('genblaze'));
  assert.deepEqual(ups.at(-1).profiles, ['genblaze']);
  assert.equal(ups.at(-1).args.at(-1), 'genblaze');
});

test('ordinary startup builds and recreates containers while preserving volumes', async () => {
  const calls = [];
  await startRuntimeServices(['core'], {
    runCompose: (_profiles, args) => calls.push(args),
  });
  const up = calls.find((args) => args[0] === 'up');
  assert.ok(up.includes('--build'));
  assert.ok(up.includes('--force-recreate'));
  assert.ok(up.includes('--remove-orphans'));
  assert.ok(!calls.some((args) => args[0] === 'stop'));
});

test('asynchronous image build failures stop before any container mutation', async () => {
  const calls = [];
  await assert.rejects(startRuntimeServices(['core', 'local-mongo'], {
    restart: true,
    runCompose: async (_profiles, args) => {
      calls.push(args);
      await Promise.resolve();
      throw new Error('image build failed asynchronously');
    },
  }), /image build failed asynchronously/);
  assert.deepEqual(calls, [['build']]);
});

test('includes GenBlaze in all-profile cleanup without enabling it by default', () => {
  assert.equal(ALL_RUNTIME_COMPOSE_PROFILES.includes('genblaze'), true);
  assert.equal(getRuntimeComposeProfiles({}).includes('genblaze'), false);
});

test('runtime profile selection rejects a stale or missing rendered GMI catalog', () => {
  const fingerprint = 'a'.repeat(64);
  const config = {
    providers: { gmicloud: { enabled: true, credentialFingerprint: fingerprint } },
    services: { genblaze: true },
  };

  assert.equal(getRuntimeComposeProfiles(config, {
    genBlazeCatalog: {
      version: 1,
      provider: 'gmicloud',
      credentialFingerprint: fingerprint,
      models: {},
    },
  }).includes('genblaze'), true);
  assert.equal(getRuntimeComposeProfiles(config, {
    genBlazeCatalog: {
      version: 1,
      provider: 'gmicloud',
      credentialFingerprint: 'b'.repeat(64),
      models: {},
    },
  }).includes('genblaze'), false);
  assert.equal(getRuntimeComposeProfiles(config, { genBlazeCatalog: null }).includes('genblaze'), false);
});
