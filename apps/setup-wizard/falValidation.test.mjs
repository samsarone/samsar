import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { validateFalCredential } from './falCredentialValidation.mjs';

test('packaged Fal validator rejects invalid credentials without generation', async () => {
  const result = await validateFalCredential('invalid-key', {
    fetchImpl: async (_url, options) => {
      assert.equal(options.method, 'GET');
      assert.equal(options.body, undefined);
      return new Response('{}', { status: 401 });
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'invalid');
});

test('setup backend validates direct/environment Fal keys and rejects forged validation before starting setup', { timeout: 15000 }, async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'samsar-fal-validation-'));
  const tokenPath = path.join(directory, 'bootstrap-token');
  await fs.writeFile(tokenPath, 'fixture-bootstrap-token', { mode: 0o600 });
  const preload = path.join(directory, 'fetch-fixture.mjs');
  await fs.writeFile(preload, `
    globalThis.fetch = async (url, options) => {
      if (!String(url).startsWith('https://queue.fal.run/') || options.method !== 'GET') {
        throw new Error('Unexpected provider request');
      }
      const good = options.headers.Authorization === 'Key fixture-valid-key';
      return new Response(JSON.stringify(good ? {status:'NOT_FOUND'} : {}), {status:good ? 404 : 401});
    };
  `);
  const portServer = net.createServer();
  portServer.listen(0, '127.0.0.1');
  await once(portServer, 'listening');
  const port = portServer.address().port;
  await new Promise((resolve) => portServer.close(resolve));
  const child = spawn(process.execPath, ['--import', preload, 'server.mjs'], {
    cwd: fileURLToPath(new URL('.', import.meta.url)),
    env: {
      ...process.env, PORT: String(port), SAMSAR_SETUP_ROOT_DIR: directory,
      SAMSAR_SETUP_BOOTSTRAP_TOKEN_FILE: tokenPath, FAL_API_KEY: 'fixture-valid-key',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode === null) { const closed = once(child, 'close'); child.kill(); await closed; }
    await fs.rm(directory, { recursive: true, force: true });
  });
  let output = '';
  await new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => { output += chunk; if (output.includes('setup wizard listening')) resolve(); });
    child.on('error', reject);
    child.on('exit', (code) => reject(new Error(`Fixture server exited: ${code}`)));
  });
  const post = async (route, payload, authenticated = true) => {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(authenticated ? {'x-samsar-setup-bootstrap-token':'fixture-bootstrap-token'} : {}) },
      body: JSON.stringify(payload),
    });
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await post('/api/setup/providers/fal/validate', {falApiKey:'fixture-valid-key'}, false)).status, 401);
  const rejected = await post('/api/setup/providers/fal/validate', {falApiKey:'fixture-invalid-key'});
  assert.equal(rejected.body.providers.fal.ok, false);
  const valid = await post('/api/setup/providers/fal/validate', {falApiKey:'fixture-valid-key'});
  assert.equal(valid.body.providers.fal.status, 'valid');
  const environment = await post('/api/setup/providers/environment/validate', {credentials:{falApiKey:'$FAL_API_KEY'}});
  assert.equal(environment.status, 200, JSON.stringify(environment.body));
  assert.equal(environment.body.providers.fal.validationMode, 'remote_queue_auth');
  assert.equal(environment.body.providers.fal.ok, true);
  const start = await post('/api/setup/start', {
    credentials: {falApiKey:'fixture-invalid-key'},
    deployment: {providers:{fal:{enabled:true,validation:{ok:true,status:'valid'}}}},
  });
  assert.equal(start.status, 400);
  assert.match(start.body.message, /Fal rejected/);
  await assert.rejects(fs.access(path.join(directory, 'runtime', 'config', 'samsar.config.json')), {code:'ENOENT'});
});
