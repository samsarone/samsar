import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { startRuntimeServices } from './docker-compose-runtime.mjs';

const read = relative => fs.readFileSync(new URL('../' + relative, import.meta.url), 'utf8');
test('only the assistant target packages a local index using the existing Node runtime', () => {
  const docker = read('Dockerfile'), compose = read('deploy/compose/docker-compose.yml');
  assert.match(docker, /RUN --network=none if \[ "\$SERVICE_PATH" = "services\/assistant-query-processor" \]/);
  assert.match(docker, /node knowledge\/index.mjs build && node knowledge\/verify_artifact.mjs/);
  assert.doesNotMatch(docker, /FROM python|pip install|huggingface/);
  assert.match(docker, /FROM runtime AS assistant-runtime/);
  assert.match(docker, /FROM runtime AS application\s*$/);
  assert.equal((compose.match(/target: assistant-runtime/g) || []).length, 1);
  assert.doesNotMatch(compose, /^  assistant-knowledge:/m);
  const block = compose.split('\n  assistant-query-processor:')[1]?.split(/\n  [a-z]/)[0];
  assert.match(block, /target: assistant-runtime/);
});
test('an index build failure stops deployment before any container mutation', async () => {
  const calls = [];
  await assert.rejects(startRuntimeServices(['core', 'workers'], { runCompose: async (profiles, args) => {
    calls.push(args); if (args[0] === 'build') throw new Error('invalid corpus');
  } }), /invalid corpus/);
  assert.deepEqual(calls, [['build', 'assistant-query-processor']]);
});
test('wizard deploy and update prebuild the assistant image', () => {
  const wizard = read('apps/setup-wizard/server.mjs');
  assert.equal((wizard.match(/nonGenBlazeProfileArgs, 'build', 'assistant-query-processor'/g) || []).length, 2);
});
