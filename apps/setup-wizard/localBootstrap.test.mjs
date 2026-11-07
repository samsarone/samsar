import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { scryptSync } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const token = 'fixture-local-bootstrap-token';

async function startFixture(t, environment = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'samsar-local-bootstrap-'));
  const tokenPath = path.join(directory, 'bootstrap-token');
  await fs.writeFile(tokenPath, token, { mode: 0o600 });
  // Install-status must inspect only the fixture, never the developer's stack.
  const bin = path.join(directory, 'bin');
  await fs.mkdir(bin);
  await fs.writeFile(path.join(bin, 'docker'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  const reservation = net.createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: fileURLToPath(new URL('.', import.meta.url)),
    env: {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      PORT: String(port),
      SAMSAR_SETUP_ROOT_DIR: directory,
      SAMSAR_SETUP_BOOTSTRAP_TOKEN_FILE: tokenPath,
      SAMSAR_SETUP_BIND_ADDR: '127.0.0.1',
      SAMSAR_SETUP_REMOTE_INSTALL: '0',
      SAMSAR_SETUP_CLOUD_ENVIRONMENT: '',
      ...environment,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode === null) {
      const closed = once(child, 'close');
      child.kill();
      await closed;
    }
    await fs.rm(directory, { recursive: true, force: true });
  });
  let output = '';
  child.stderr.on('data', (chunk) => { output += chunk; });
  await new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.includes('setup wizard listening')) resolve();
    });
    child.on('error', reject);
    child.on('exit', (code) => reject(new Error(`Fixture exited (${code}): ${output}`)));
  });
  // Raw HTTP lets the tests exercise forged Host and Fetch Metadata headers;
  // browser-compatible fetch implementations may override those headers.
  const request = (route, options = {}) => new Promise((resolve, reject) => {
    const outgoing = http.request(`http://127.0.0.1:${port}${route}`, options, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: new Headers(response.headers),
        json: async () => JSON.parse(body),
      }));
      response.on('error', reject);
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
  return { directory, request, origin: `http://127.0.0.1:${port}` };
}

test('fresh loopback setup issues browser access but keeps operations authenticated', { timeout: 15000 }, async (t) => {
  const { directory, request, origin } = await startFixture(t);
  const status = await (await request('/api/setup/install-status')).json();
  assert.equal(status.hasRuntimeConfig, false);
  assert.equal(status.setupAuthenticated, false);
  assert.equal(status.setupLocalBootstrapAvailable, true);
  const bootstrap = await request('/api/setup/auth/bootstrap', {
    headers: { Origin: origin, 'Sec-Fetch-Site': 'same-origin' },
  });
  assert.equal(bootstrap.status, 200);
  assert.match(bootstrap.headers.get('cache-control'), /no-store/);
  assert.equal(bootstrap.headers.get('access-control-allow-origin'), null);
  assert.deepEqual(await bootstrap.json(), { ok: true, bootstrapToken: token });

  for (const candidate of ['', 'stale-token', token]) {
    const response = await request('/api/setup/auth/check', {
      method: 'POST', headers: { 'x-samsar-setup-bootstrap-token': candidate },
    });
    assert.equal(response.status, candidate === token ? 200 : 401);
  }
  const authenticated = await (await request('/api/setup/install-status', {
    headers: { 'x-samsar-setup-bootstrap-token': token },
  })).json();
  assert.equal(authenticated.setupAuthenticated, true);
  await assert.rejects(fs.access(path.join(directory, 'runtime')), { code: 'ENOENT' });
});

test('local bootstrap rejects cross-origin requests and non-loopback hosts', { timeout: 15000 }, async (t) => {
  const { request, origin } = await startFixture(t);
  for (const headers of [
    { Host: 'attacker.example' },
    { Host: '127.0.0.1.attacker.example' },
    { Host: 'localhost@attacker.example' },
    { Host: 'localhost/path' },
    { Origin: 'http://localhost:3000' },
    { Origin: 'https://attacker.example' },
    { Origin: 'null' },
    { 'Sec-Fetch-Site': 'cross-site' },
    { 'Sec-Fetch-Site': 'same-site', Origin: origin },
  ]) {
    const response = await request('/api/setup/auth/bootstrap', { headers });
    assert.equal(response.status, 403, JSON.stringify(headers));
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.equal((await response.json()).bootstrapToken, undefined);
    const status = await (await request('/api/setup/install-status', { headers })).json();
    assert.equal(status.setupLocalBootstrapAvailable, false, JSON.stringify(headers));
  }
  const preflight = await request('/api/setup/auth/bootstrap', {
    method: 'OPTIONS', headers: { Origin: 'http://localhost:3000' },
  });
  assert.equal(preflight.headers.get('access-control-allow-origin'), null);
});

test('remote, public and unspecified bindings keep authenticated launch links', { timeout: 15000 }, async (t) => {
  for (const environment of [
    { SAMSAR_SETUP_BIND_ADDR: '0.0.0.0' },
    { SAMSAR_SETUP_BIND_ADDR: '' },
    { SAMSAR_SETUP_REMOTE_INSTALL: '1' },
    { SAMSAR_SETUP_CLOUD_ENVIRONMENT: 'Azure' },
  ]) {
    await t.test(JSON.stringify(environment), async (subtest) => {
      const { request } = await startFixture(subtest, environment);
      const status = await (await request('/api/setup/install-status')).json();
      assert.equal(status.setupLocalBootstrapAvailable, false);
      assert.equal((await request('/api/setup/auth/bootstrap')).status, 403);
      assert.equal((await request('/api/setup/auth/check', {
        method: 'POST', headers: { 'x-samsar-setup-bootstrap-token': token },
      })).status, 200);
    });
  }
});

test('saved admin passwords disable local bootstrap without allowing token downgrade', { timeout: 15000 }, async (t) => {
  const { directory, request } = await startFixture(t);
  const password = 'fixture-admin-password';
  const salt = 'fixture-salt';
  const hash = `scrypt-v1:${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
  const configDirectory = path.join(directory, 'runtime', 'config');
  const secretsDirectory = path.join(directory, 'runtime', 'secrets');
  await fs.mkdir(configDirectory, { recursive: true });
  await fs.mkdir(secretsDirectory, { recursive: true });
  const configPath = path.join(configDirectory, 'samsar.config.json');
  await fs.writeFile(configPath, JSON.stringify({ security: { setupWizardPasswordHash: hash } }));
  for (const storage of ['config', 'persisted password']) {
    if (storage === 'persisted password') {
      await fs.writeFile(path.join(secretsDirectory, 'setup-auth.hash'), hash);
      await fs.rm(configPath);
    }
    const status = await (await request('/api/setup/install-status')).json();
    assert.equal(status.setupAuthRequired, true, storage);
    assert.equal(status.setupLocalBootstrapAvailable, false, storage);
    assert.equal((await request('/api/setup/auth/bootstrap')).status, 403, storage);
    assert.equal((await request('/api/setup/auth/check', {
      method: 'POST', headers: { 'x-samsar-setup-bootstrap-token': token },
    })).status, 401, storage);
    assert.equal((await request('/api/setup/auth/check', {
      method: 'POST', headers: { 'x-samsar-setup-admin-password': password },
    })).status, 200, storage);
  }
});
