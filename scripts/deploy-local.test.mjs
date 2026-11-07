import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const posixOnly = { skip: process.platform === 'win32' };

function fixture(t, { configured = true, wizardStatus = 0, runtimeStatus = 0, renderStatus = 0, configureInWizard = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-deploy-command-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'scripts'));
  const pkg = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'package.json'), 'utf8'));
  pkg.scripts.sync = 'node scripts/sync-fixture.mjs';
  pkg.scripts['docker:update'] = 'node scripts/deploy-local.mjs update';
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'deployment-fixture', private: true, type: 'module', scripts: pkg.scripts }));
  const entry = path.join(sourceRoot, 'scripts/deploy-local.mjs');
  if (fs.existsSync(entry)) fs.copyFileSync(entry, path.join(root, 'scripts/deploy-local.mjs'));
  const configPath = path.join(root, 'runtime/config/samsar.config.json');
  if (configured) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, '{}');
  }
  const record = "import fs from 'node:fs'; fs.appendFileSync(process.env.SAMSAR_DEPLOY_TEST_EVENTS, ";
  fs.writeFileSync(path.join(root, 'scripts/sync-fixture.mjs'), `${record}'sync\\n');`);
  fs.writeFileSync(path.join(root, 'scripts/generate-runtime-config.mjs'), `${record}'render\\n'); process.exit(${renderStatus});`);
  fs.writeFileSync(path.join(root, 'scripts/docker-compose-runtime.mjs'), `${record}'runtime:' + process.argv[2] + '\\n'); process.exit(${runtimeStatus});`);
  fs.writeFileSync(path.join(root, 'scripts/setup-wizard-docker.sh'), `#!/usr/bin/env bash
set -eu
printf 'wizard\\n' >> "$SAMSAR_DEPLOY_TEST_EVENTS"
printf '%s' "$SAMSAR_SETUP_REUSE_UNCHANGED" > "$SAMSAR_DEPLOY_TEST_READY.reuse"
if [[ "${wizardStatus}" != 0 ]]; then exit ${wizardStatus}; fi
printf ready > "$SAMSAR_DEPLOY_TEST_READY"
${configureInWizard ? "mkdir -p runtime/config\nprintf '{}' > runtime/config/samsar.config.json" : ''}
`);
  return {
    configPath,
    run(command) {
      const result = spawnSync('npm', ['run', command, '--silent'], {
        cwd: root, encoding: 'utf8', timeout: 15000,
        env: { ...process.env, npm_config_cache: path.join(root, 'npm-cache'), npm_config_update_notifier: 'false',
          SAMSAR_DEPLOY_TEST_EVENTS: path.join(root, 'events'), SAMSAR_DEPLOY_TEST_READY: path.join(root, 'wizard-ready') },
      });
      assert.ifError(result.error);
      return { ...result, events: fs.existsSync(path.join(root, 'events')) ? fs.readFileSync(path.join(root, 'events'), 'utf8').trim().split('\n') : [],
        wizardReady: fs.existsSync(path.join(root, 'wizard-ready')),
        reuseWizard: fs.readFileSync(path.join(root, 'wizard-ready.reuse'), 'utf8') };
    },
  };
}

for (const [command, action] of [['docker:up', 'up'], ['docker:restart', 'restart'], ['docker:update', 'update']]) {
  test(`F2P: ${command} starts the wizard before rendering config or building the runtime`, posixOnly, t => {
    const result = fixture(t).run(command);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.events, ['wizard', 'render', `runtime:${action}`]);
    assert.equal(result.reuseWizard, action === 'update' ? '1' : '0');
  });
  test(`F2P: fresh ${command} leaves configuration to the ready wizard`, posixOnly, t => {
    const project = fixture(t, { configured: false });
    const result = project.run(command);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.events, ['wizard']);
    assert.equal(result.wizardReady, true);
    assert.equal(fs.existsSync(project.configPath), false);
  });
}

test('F2P: sync:restart syncs sources and then starts the wizard before the stack', posixOnly, t => {
  const result = fixture(t).run('sync:restart');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.events, ['sync', 'wizard', 'render', 'runtime:restart']);
});

test('F2P: a failed wizard launch stops deployment before any config or runtime changes', posixOnly, t => {
  const result = fixture(t, { wizardStatus: 19 }).run('docker:up');
  assert.equal(result.status, 19, result.stderr);
  assert.deepEqual(result.events, ['wizard']);
});

test('F2P: a runtime failure keeps the setup wizard available and propagates failure', posixOnly, t => {
  const result = fixture(t, { runtimeStatus: 17 }).run('docker:up');
  assert.equal(result.status, 17, result.stderr);
  assert.deepEqual(result.events, ['wizard', 'render', 'runtime:up']);
  assert.equal(result.wizardReady, true);
});

test('F2P: a render failure leaves the wizard available without starting runtime services', posixOnly, t => {
  const result = fixture(t, { renderStatus: 23 }).run('docker:up');
  assert.equal(result.status, 23, result.stderr);
  assert.deepEqual(result.events, ['wizard', 'render']);
  assert.equal(result.wizardReady, true);
});

test('F2P: the deploy alias boots a fresh installation directly into the wizard', posixOnly, t => {
  const result = fixture(t, { configured: false }).run('deploy');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.events, ['wizard']);
  assert.equal(result.wizardReady, true);
});

test('F2P: configuration completed while the wizard starts is used for deployment', posixOnly, t => {
  const result = fixture(t, { configured: false, configureInWizard: true }).run('docker:up');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.events, ['wizard', 'render', 'runtime:up']);
});

test('F2P: a setup wizard readiness timeout cannot report a successful launch', posixOnly, () => {
  const launcher = fs.readFileSync(path.join(sourceRoot, 'scripts/setup-wizard-docker.sh'), 'utf8');
  const start = launcher.lastIndexOf('echo "Started ${CONTAINER_NAME} (${container_id})."');
  assert.ok(start > 0);
  const result = spawnSync('bash', ['-c', `
set -eu
CONTAINER_NAME=wizard-fixture
container_id=fixture
LOCAL_SETUP_WIZARD_URL=http://localhost:8089
LOCAL_SETUP_WIZARD_AUTH_URL=http://localhost:8089/#bootstrap=fixture
READY_TIMEOUT_SECONDS=1
wait_for_setup_wizard() { return 1; }
detect_reachable_public_setup_ips() { :; }
print_setup_wizard_urls() { :; }
open_setup_wizard_browser() { exit 97; }
die() { printf '%s\\n' "$*" >&2; exit 1; }
${launcher.slice(start)}
`], { encoding: 'utf8', timeout: 5000 });
  assert.ifError(result.error);
  assert.equal(result.status, 1, result.stdout + result.stderr);
});
