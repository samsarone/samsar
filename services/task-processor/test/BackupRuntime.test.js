import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backupDirectory = path.join(repositoryRoot, 'backup');

function run(command, env = {}, options = {}) {
  return spawnSync('/bin/bash', ['-c', command], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: {...process.env, ...env},
    ...options,
  });
}

function writeExecutable(destination, contents) {
  fs.writeFileSync(destination, contents, {mode: 0o755});
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-backup-test-'));
  const sourceRoot = path.join(root, 'sources');
  const stateRoot = path.join(root, 'state');
  const secretRoot = path.join(root, 'secrets');
  const fakeBin = path.join(root, 'bin');
  const fakeLog = path.join(root, 'commands.log');
  const fakeManifest = path.join(root, 'manifest.json');
  const repositoryMarker = path.join(root, 'repository-initialized');
  const sourceNames = [
    'blog-content',
    'media-assets',
    'media-assets-v2',
    'minio-data',
    'persistent-data',
    'license-data',
    'blog-analytics',
  ];

  fs.mkdirSync(stateRoot, {recursive: true});
  fs.mkdirSync(secretRoot, {recursive: true});
  fs.mkdirSync(fakeBin, {recursive: true});
  for (const sourceName of sourceNames) {
    const sourcePath = path.join(sourceRoot, sourceName);
    fs.mkdirSync(sourcePath, {recursive: true});
    fs.writeFileSync(path.join(sourcePath, 'fixture.txt'), sourceName);
  }
  fs.writeFileSync(path.join(sourceRoot, 'blog-analytics', 'analytics.sqlite'), 'sqlite-fixture');

  const secrets = {
    restic: 'test-restic-password',
    accessKey: 'TESTACCESSKEY123',
    secretKey: 'test-aws-secret-value',
    mongoUri: 'mongodb://backup-user:backup-password@mongo:27017/?authSource=admin',
    mysql: 'test-mysql-secret-value',
  };
  const secretFiles = {
    restic: path.join(secretRoot, 'restic-password'),
    accessKey: path.join(secretRoot, 'aws-access-key-id'),
    secretKey: path.join(secretRoot, 'aws-secret-access-key'),
    mongoUri: path.join(secretRoot, 'mongodb-backup-uri'),
  };
  for (const [name, secretPath] of Object.entries(secretFiles)) {
    fs.writeFileSync(secretPath, `${secrets[name]}\n`, {mode: 0o400});
  }

  writeExecutable(path.join(fakeBin, 'flock'), `#!/bin/bash
if [[ "\${FAKE_FLOCK_FAIL:-false}" == true ]]; then exit 1; fi
exit 0
`);
  writeExecutable(path.join(fakeBin, 'findmnt'), `#!/bin/bash
printf 'ro,relatime\\n'
`);
  writeExecutable(path.join(fakeBin, 'sha256sum'), `#!/bin/bash
for file in "$@"; do printf '%064d  %s\\n' 0 "$file"; done
`);
  writeExecutable(path.join(fakeBin, 'mongodump'), `#!/bin/bash
printf 'mongodump' >>"$FAKE_LOG"
output=''
for argument in "$@"; do
  printf ' %s' "$argument" >>"$FAKE_LOG"
  case "$argument" in --archive=*) output="\${argument#--archive=}" ;; esac
done
printf '\\n' >>"$FAKE_LOG"
printf 'logical-mongo-dump' | gzip -c >"$output"
`);
  writeExecutable(path.join(fakeBin, 'mysqldump'), `#!/bin/bash
printf 'mysqldump' >>"$FAKE_LOG"
for argument in "$@"; do printf ' %s' "$argument" >>"$FAKE_LOG"; done
printf '\\n' >>"$FAKE_LOG"
printf '%s\\n' '-- logical mysql dump'
`);
  writeExecutable(path.join(fakeBin, 'sqlite3'), `#!/bin/bash
source_path=''
for argument in "$@"; do
  if [[ -z "$source_path" && "$argument" != '-readonly' ]]; then source_path="$argument"; fi
  case "$argument" in
    ".backup '"*"'")
      output="\${argument#.backup \\\' }"
      output="\${argument#.backup \\'}"
      output="\${output%\\'}"
      cp "$source_path" "$output"
      exit 0
      ;;
    'PRAGMA quick_check;')
      printf 'ok\\n'
      exit 0
      ;;
  esac
done
exit 2
`);
  writeExecutable(path.join(fakeBin, 'restic'), `#!/bin/bash
[[ "\$TMPDIR" == "\$BACKUP_STATE_DIR/tmp" ]] || exit 98
[[ -d "\$TMPDIR" ]] || exit 98
command_name="\${1:-}"
printf 'restic' >>"$FAKE_LOG"
for argument in "$@"; do printf ' %s' "$argument" >>"$FAKE_LOG"; done
printf '\\n' >>"$FAKE_LOG"
case "$command_name" in
  cat)
    [[ -f "$FAKE_REPOSITORY_MARKER" ]]
    ;;
  init)
    : >"$FAKE_REPOSITORY_MARKER"
    ;;
  backup)
    for argument in "$@"; do
      if [[ "$argument" == */payload ]]; then cp "$argument/manifest.json" "$FAKE_MANIFEST"; fi
    done
    printf '%s\\n' '{"message_type":"summary","snapshot_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'
    ;;
  unlock|snapshots|forget|prune|check)
    exit 0
    ;;
  *)
    exit 2
    ;;
esac
`);

  const env = {
    PATH: `${fakeBin}:${process.env.PATH}`,
    BACKUP_ENABLED: 'true',
    SAMSAR_DEPLOYMENT_EDITION: 'production',
    BACKUP_SOURCE_ROOT: sourceRoot,
    BACKUP_STATE_DIR: stateRoot,
    BACKUP_MYSQL_USER: 'ghost_user',
    BACKUP_MYSQL_DATABASE: 'ghost_prod',
    BACKUP_MYSQL_PASSWORD: secrets.mysql,
    BACKUP_SCHEDULE_UTC: '02:00',
    BACKUP_PRUNE_WEEKDAY_UTC: String(new Date().getUTCDay() || 7),
    RESTIC_REPOSITORY: 's3:s3.amazonaws.com/samsar-backup/test',
    RESTIC_PASSWORD_FILE: secretFiles.restic,
    AWS_ACCESS_KEY_ID_FILE: secretFiles.accessKey,
    AWS_SECRET_ACCESS_KEY_FILE: secretFiles.secretKey,
    BACKUP_MONGODB_URI_FILE: secretFiles.mongoUri,
    FAKE_LOG: fakeLog,
    FAKE_MANIFEST: fakeManifest,
    FAKE_REPOSITORY_MARKER: repositoryMarker,
  };

  return {
    root,
    sourceRoot,
    stateRoot,
    fakeLog,
    fakeManifest,
    repositoryMarker,
    secrets,
    secretFiles,
    env,
  };
}

test('backup runtime is fail-closed unless explicitly enabled for production', () => {
  const common = path.join(backupDirectory, 'common.sh');
  const command = `source "${common}"; backup_validate_runtime_gate`;

  assert.notEqual(run(command, {}).status, 0);
  assert.notEqual(run(command, {BACKUP_ENABLED: 'true', SAMSAR_DEPLOYMENT_EDITION: 'standalone'}).status, 0);
  assert.equal(run(command, {BACKUP_ENABLED: 'true', SAMSAR_DEPLOYMENT_EDITION: 'production'}).status, 0);
});

test('backup image includes MySQL 8 caching SHA-2 authentication support', () => {
  const dockerfile = fs.readFileSync(path.join(backupDirectory, 'Dockerfile'), 'utf8');

  assert.match(dockerfile, /apk add --no-cache[\s\S]*mariadb-connector-c/);
  assert.match(dockerfile, /test -f \/usr\/lib\/mariadb\/plugin\/caching_sha2_password\.so/);
});

test('file-based AWS credentials load without logging values and conflict with direct inputs', (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, {recursive: true, force: true}));
  const common = path.join(backupDirectory, 'common.sh');
  const command = `set -e; source "${common}"; backup_load_cloud_credentials; printf '%s:%s' "$AWS_ACCESS_KEY_ID" "$AWS_SECRET_ACCESS_KEY"`;
  const success = run(command, fixture.env);

  assert.equal(success.status, 0, success.stderr);
  assert.equal(success.stdout, `${fixture.secrets.accessKey}:${fixture.secrets.secretKey}`);
  assert.equal(success.stderr.includes(fixture.secrets.accessKey), false);
  assert.equal(success.stderr.includes(fixture.secrets.secretKey), false);

  const conflict = run(command, {...fixture.env, AWS_ACCESS_KEY_ID: 'direct-conflict'});
  assert.notEqual(conflict.status, 0);
  assert.match(conflict.stderr, /mutually exclusive/);
  assert.equal(conflict.stderr.includes('direct-conflict'), false);
});

test('MongoDB backup URI is required explicitly and supports a secret file', (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, {recursive: true, force: true}));
  const common = path.join(backupDirectory, 'common.sh');
  const command = `set -e; source "${common}"; backup_load_mongodb_uri; printf '%s' "$BACKUP_MONGODB_URI"`;

  const missing = run(command, {
    BACKUP_MONGODB_URI: '',
    BACKUP_MONGODB_URI_FILE: '',
  });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /BACKUP_MONGODB_URI or BACKUP_MONGODB_URI_FILE is required/);
  assert.doesNotMatch(missing.stderr, /mongodb:\/\/mongo:27017/);

  const fromFile = run(command, fixture.env);
  assert.equal(fromFile.status, 0, fromFile.stderr);
  assert.equal(fromFile.stdout, fixture.secrets.mongoUri);
  assert.equal(fromFile.stderr.includes(fixture.secrets.mongoUri), false);

  const conflict = run(command, {
    ...fixture.env,
    BACKUP_MONGODB_URI: fixture.secrets.mongoUri,
  });
  assert.notEqual(conflict.status, 0);
  assert.match(conflict.stderr, /mutually exclusive/);
  assert.equal(conflict.stderr.includes(fixture.secrets.mongoUri), false);
});

test('UTC scheduler catches up missed runs and otherwise selects the next daily boundary', () => {
  const scheduler = path.join(backupDirectory, 'scheduler.sh');
  const dayStart = 10 * 86400;
  const command = `source "${scheduler}"; compute_next_attempt_epoch "$NOW" "$LAST_SUCCESS"`;
  const before = run(command, {BACKUP_SCHEDULE_UTC: '02:00', NOW: String(dayStart + 3600), LAST_SUCCESS: '0'});
  const missed = run(command, {BACKUP_SCHEDULE_UTC: '02:00', NOW: String(dayStart + 8000), LAST_SUCCESS: '0'});
  const complete = run(command, {BACKUP_SCHEDULE_UTC: '02:00', NOW: String(dayStart + 8000), LAST_SUCCESS: String(dayStart + 7500)});

  assert.equal(Number(before.stdout.trim()), dayStart + 7200);
  assert.equal(Number(missed.stdout.trim()), dayStart + 8000);
  assert.equal(Number(complete.stdout.trim()), dayStart + 86400 + 7200);
});

test('health permits a bounded initial-success grace and treats disabled mode as healthy', (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, {recursive: true, force: true}));
  const statusDirectory = path.join(fixture.stateRoot, 'status');
  const now = Math.floor(Date.now() / 1000);
  fs.mkdirSync(statusDirectory, {recursive: true});
  fs.writeFileSync(path.join(statusDirectory, 'scheduler-status.json'), JSON.stringify({
    status: 'waiting',
    startedAtEpoch: now,
    heartbeatAtEpoch: now,
    nextAttemptEpoch: now + 3600,
  }));
  const health = path.join(backupDirectory, 'healthcheck.sh');

  const grace = run(`"${health}"`, fixture.env);
  assert.equal(grace.status, 0, grace.stderr);
  assert.match(grace.stdout, /last_success_epoch=0/);

  const disabled = run(`"${health}"`, {...fixture.env, BACKUP_ENABLED: 'false', SAMSAR_DEPLOYMENT_EDITION: 'standalone'});
  assert.equal(disabled.status, 0);
  assert.match(disabled.stdout, /status=disabled/);

  fs.writeFileSync(path.join(statusDirectory, 'scheduler-status.json'), JSON.stringify({
    status: 'waiting',
    startedAtEpoch: now - 27 * 3600,
    heartbeatAtEpoch: now,
    nextAttemptEpoch: now + 3600,
  }));
  const stale = run(`"${health}"`, fixture.env);
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /initial grace period/);
});

test('one-shot backup dumps databases, snapshots all volumes, prunes weekly, and records success', (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, {recursive: true, force: true}));
  const result = run(`"${path.join(backupDirectory, 'run-backup.sh')}"`, fixture.env);

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(fs.existsSync(fixture.repositoryMarker), true);
  const commands = fs.readFileSync(fixture.fakeLog, 'utf8');
  assert.match(commands, /mysqldump .*--databases ghost_prod .*--single-transaction/);
  assert.match(commands, /mysqldump .*--ssl .*--skip-ssl-verify-server-cert/);
  assert.doesNotMatch(commands, /(?:^|\s)--(?:skip|disable)-ssl(?:\s|$)/);
  assert.match(commands, /mysqldump .*--no-tablespaces/);
  assert.match(commands, /mysqldump .*--routines .*--events .*--triggers/);
  assert.doesNotMatch(commands, /--all-databases/);
  assert.match(commands, /restic backup .*blog-content .*media-assets .*media-assets-v2 .*minio-data .*persistent-data .*license-data/);
  assert.match(commands, /restic unlock --remove-all/);
  assert.match(commands, /restic forget .*--group-by host,tags/);
  assert.doesNotMatch(commands, /restic forget .*--prune/);
  assert.match(commands, /restic prune/);
  assert.match(commands, /restic check/);
  for (const secret of Object.values(fixture.secrets)) {
    assert.equal(commands.includes(secret), false);
    assert.equal(result.stderr.includes(secret), false);
  }
  const resticBackupLine = commands.split('\n').find((line) => line.startsWith('restic backup'));
  assert.equal(resticBackupLine.includes('/private'), false);

  const manifest = JSON.parse(fs.readFileSync(fixture.fakeManifest, 'utf8'));
  assert.equal(manifest.mongoScope, 'all-databases');
  assert.equal(manifest.mysqlScope, 'database:ghost_prod');
  assert.deepEqual(manifest.filesystemSources, [
    'blog-content',
    'media-assets',
    'media-assets-v2',
    'minio-data',
    'persistent-data',
    'license-data',
  ]);

  const lastSuccess = JSON.parse(fs.readFileSync(path.join(fixture.stateRoot, 'status', 'last-success.json'), 'utf8'));
  assert.equal(lastSuccess.status, 'success');
  assert.equal(lastSuccess.snapshotId.length, 64);
  assert.equal(fs.statSync(path.join(fixture.stateRoot, 'tmp')).mode & 0o777, 0o700);
  assert.deepEqual(fs.readdirSync(path.join(fixture.stateRoot, 'work')), []);
});

test('one-shot lock contention exits without starting a dump', (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, {recursive: true, force: true}));
  const result = run(`"${path.join(backupDirectory, 'run-backup.sh')}"`, {
    ...fixture.env,
    FAKE_FLOCK_FAIL: 'true',
  });

  assert.equal(result.status, 75, result.stderr);
  assert.match(result.stderr, /owns the lock/);
  assert.equal(fs.existsSync(fixture.fakeLog), false);
});
