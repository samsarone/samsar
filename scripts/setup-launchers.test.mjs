import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptsDir, '..');

const read = (relativePath) => fs.readFileSync(path.join(rootDir, relativePath), 'utf8');

test('the Unix launcher is executable and does not require npm', () => {
  const launcherPath = path.join(rootDir, 'setup.sh');
  const launcher = read('setup.sh');
  const mode = fs.statSync(launcherPath).mode & 0o777;

  assert.ok(mode & 0o100, 'setup.sh must be executable by its owner');
  assert.match(launcher, /scripts\/setup-wizard-docker\.sh/);
  assert.doesNotMatch(launcher, /\bnpm\b|\bnode\b|\byarn\b/);
  assert.match(read('scripts/setup-wizard-docker.sh'), /Usage: \.\/setup\.sh/);
});

test('the host bootstrap installs Docker without installing Node tooling', () => {
  const launcher = read('scripts/setup-wizard-docker.sh');
  const bootstrap = launcher.match(/bootstrap_host\(\) \{([\s\S]*?)\n\}/)?.[1] || '';

  assert.match(bootstrap, /install_docker_engine/);
  assert.match(bootstrap, /start_docker_service/);
  assert.doesNotMatch(launcher, /install_nodejs|nodesource|install_yarn_if_needed/);
  assert.match(launcher, /docker-ce docker-ce-cli containerd\.io docker-buildx-plugin docker-compose-plugin/);
});

test('remote setup also uses the npm-free launcher', () => {
  const remoteLauncher = read('scripts/setup-wizard-remote.sh');

  assert.match(remoteLauncher, /\.\/setup\.sh --no-open-setup-port/);
  assert.doesNotMatch(remoteLauncher, /npm run setup-wizard/);
});

test('the setup-wizard image owns its Node and Compose dependencies', () => {
  const dockerfile = read('apps/setup-wizard/Dockerfile');

  assert.match(dockerfile, /^FROM node:20 AS builder/m);
  assert.match(dockerfile, /^FROM node:20-alpine/m);
  assert.match(dockerfile, /docker-cli-compose/);
  assert.match(dockerfile, /CMD \["node", "server\.mjs"\]/);
});

test('Windows launchers bootstrap Docker Desktop without npm', () => {
  const powershell = read('setup.ps1');
  const command = read('setup.cmd');

  assert.match(powershell, /Docker\.DockerDesktop/);
  assert.match(powershell, /winget\.exe install/);
  assert.match(powershell, /wsl\.exe/);
  assert.doesNotMatch(powershell, /\bnpm\b|\byarn\b/);
  assert.match(command, /setup\.ps1/);
});
