import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const launcher = fs.readFileSync(new URL('./setup-wizard-docker.sh', import.meta.url), 'utf8');
const start = launcher.indexOf('echo "Building ${IMAGE_NAME} from apps/setup-wizard..."');
assert.ok(start > 0);

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-wizard-reuse-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const script = `
set -euo pipefail
ROOT_DIR="$CHECK_ROOT"
IMAGE_NAME=wizard:test
CONTAINER_NAME=wizard-test
HOST_PORT=8089
HOST_BIND_ADDR=127.0.0.1
CONTAINER_PORT=8080
DOCKER_SOCKET_PATH=/tmp/test-docker.sock
BOOTSTRAP_TOKEN_FILE=/tmp/test-bootstrap-token
BOOTSTRAP_TOKEN_CONTAINER_FILE=/run/test-bootstrap-token
SETUP_BOOTSTRAP_TOKEN="$CHECK_TOKEN"
HOST_PRIVATE_IPS=""
HOST_PUBLIC_IPS=""
REMOTE_INSTALL=""
CLOUD_ENVIRONMENT=""
AZURE_RESOURCE_GROUP=""
AZURE_VM_NAME=""
AZURE_SUBSCRIPTION_ID=""
PROVIDER_ENV_ALLOWLIST=SAMSAR_API_KEY
PROVIDER_ENV_DOCKER_ARGS=(--env "SAMSAR_API_KEY=$CHECK_PROVIDER")
LOCAL_SETUP_WIZARD_URL=http://localhost:8089
LOCAL_SETUP_WIZARD_AUTH_URL=http://localhost:8089
enabled() { [[ "$1" != 0 ]]; }
wait_for_setup_wizard() { return 0; }
detect_reachable_public_setup_ips() { :; }
print_setup_wizard_urls() { :; }
open_setup_wizard_browser() { :; }
die() { exit 1; }
docker_cli() {
  printf '%s\\n' "$1" >> "$CHECK_ROOT/events"
  case "$1" in
    build) : ;;
    ps) if [[ -f "$CHECK_ROOT/image" ]]; then printf 'existing-id'; fi ;;
    image) printf '%s' "$CHECK_IMAGE" ;;
    inspect) printf '%s %s %s %s' "$(cat "$CHECK_ROOT/image")" "$(cat "$CHECK_ROOT/hash")" "$CHECK_RUNNING" "$CHECK_HEALTH" ;;
    rm) rm "$CHECK_ROOT/image" "$CHECK_ROOT/hash" ;;
    run)
      printf '%s' "$CHECK_IMAGE" > "$CHECK_ROOT/image"
      for arg in "$@"; do
        case "$arg" in samsar.setup.config-hash=*) printf '%s' "\${arg#*=}" > "$CHECK_ROOT/hash" ;; esac
      done
      printf 'new-id'
      ;;
    *) exit 99 ;;
  esac
}
${launcher.slice(start)}
`;
  return overrides => {
    fs.writeFileSync(path.join(root, 'events'), '');
    const result = spawnSync('bash', ['-c', script], {
      encoding: 'utf8', timeout: 10_000,
      env: {
        ...process.env, CHECK_ROOT: root, CHECK_IMAGE: 'sha256:original',
        CHECK_TOKEN: 'test-bootstrap-secret', CHECK_PROVIDER: 'test-provider-secret',
        CHECK_RUNNING: 'true', CHECK_HEALTH: 'healthy', SAMSAR_SETUP_REUSE_UNCHANGED: '1',
        ...overrides,
      },
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout + result.stderr, /test-bootstrap-secret|test-provider-secret/);
    return fs.readFileSync(path.join(root, 'events'), 'utf8').trim().split('\n');
  };
}

test('an unchanged healthy wizard is reused after its first launch', t => {
  const run = fixture(t);
  assert.ok(run().includes('run'));
  const calls = run();
  assert.ok(calls.includes('build'));
  assert.ok(!calls.includes('rm') && !calls.includes('run'));
});

for (const [name, overrides] of [
  ['changed image', { CHECK_IMAGE: 'sha256:new' }],
  ['changed provider credentials', { CHECK_PROVIDER: 'changed-key' }],
  ['rotated bootstrap token', { CHECK_TOKEN: 'changed-token' }],
  ['stopped container', { CHECK_RUNNING: 'false' }],
  ['unhealthy container', { CHECK_HEALTH: 'unhealthy' }],
  ['forced recreation', { SAMSAR_SETUP_REUSE_UNCHANGED: '0' }],
]) {
  test(`${name} replaces the wizard`, t => {
    const run = fixture(t);
    run();
    const calls = run(overrides);
    assert.ok(calls.includes('rm') && calls.includes('run'));
  });
}
