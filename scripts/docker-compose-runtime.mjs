import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  GENBLAZE_FINAL_UP_ARGS,
  hasValidatedGenBlazeRuntimeCatalog,
  splitGenBlazeComposeProfiles,
} from '../apps/setup-wizard/genblazeCompose.mjs';

export const ALL_RUNTIME_COMPOSE_PROFILES = Object.freeze([
  'core',
  'workers',
  'local-mongo',
  'minio',
  'local-media',
  'logger',
  'reverse-proxy',
  'genblaze',
]);

export function getRuntimeComposeProfiles(config = {}, { genBlazeCatalog } = {}) {
  const services = config.services || {};
  const profiles = ['core'];

  if (services.workers !== false) profiles.push('workers');
  if (services.localMongo !== false) profiles.push('local-mongo');
  if (services.minio !== false) profiles.push('minio');
  if (services.mediaGateway !== false) profiles.push('local-media');
  if (services.logger !== false) profiles.push('logger');
  if (
    services.genblaze === true &&
    config.providers?.gmicloud?.enabled === true &&
    (genBlazeCatalog === undefined || hasValidatedGenBlazeRuntimeCatalog(config, genBlazeCatalog))
  ) {
    profiles.push('genblaze');
  }
  if (services.reverseProxy === true || config.reverseProxy?.enabled === true) {
    profiles.push('reverse-proxy');
  }

  return profiles;
}

function runDockerCompose(root, rootEnvPath, composeFile, profiles, args) {
  const profileArgs = profiles.flatMap((profile) => ['--profile', profile]);
  const result = spawnSync('docker', [
    'compose',
    '--env-file', rootEnvPath,
    '-f', composeFile,
    ...profileArgs,
    ...args,
  ], {
    cwd: root,
    env: { ...process.env, COMPOSE_BAKE: 'false' },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

function prepareLocalMongoAuthentication(root, rootEnvPath, composeFile, profiles) {
  if (!profiles.includes('local-mongo')) return;

  runDockerCompose(root, rootEnvPath, composeFile, ['local-mongo'], ['stop', 'mongo']);
  runDockerCompose(root, rootEnvPath, composeFile, ['local-mongo'], [
    'rm', '-s', '-f', 'mongo-auth-bootstrap',
  ]);
  runDockerCompose(root, rootEnvPath, composeFile, ['local-mongo'], [
    'up', '--no-deps', '--abort-on-container-exit',
    '--exit-code-from', 'mongo-auth-bootstrap', 'mongo-auth-bootstrap',
  ]);
}

function synchronizeGrafanaAdminPassword(root, rootEnvPath, composeFile, profiles) {
  if (!profiles.includes('logger')) return;
  runDockerCompose(root, rootEnvPath, composeFile, ['logger'], [
    'exec',
    '-T',
    'grafana',
    'sh',
    '-ec',
    'grafana cli --homepath /usr/share/grafana admin reset-admin-password "$GF_SECURITY_ADMIN_PASSWORD" >/dev/null',
  ]);
}

function main() {
  const action = process.argv[2];
  if (!['config', 'up', 'down'].includes(action)) {
    throw new Error('Usage: node scripts/docker-compose-runtime.mjs <config|up|down>');
  }

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const configPath = path.join(root, 'runtime', 'config', 'samsar.config.json');
  const exampleConfigPath = path.join(root, 'samsar.config.example.json');
  const rootEnvPath = path.join(root, 'runtime', 'secrets', 'root.env');
  const genblazeEnvPath = path.join(root, 'runtime', 'secrets', 'genblaze.env');
  const infrastructureEnvPaths = [
    path.join(root, 'runtime', 'secrets', 'application.env'),
    path.join(root, 'runtime', 'secrets', 'mongo.env'),
    path.join(root, 'runtime', 'secrets', 'minio.env'),
    path.join(root, 'runtime', 'secrets', 'grafana.env'),
  ];
  const composeFile = path.join(root, 'deploy', 'compose', 'docker-compose.yml');
  fs.mkdirSync(path.dirname(rootEnvPath), { recursive: true, mode: 0o700 });
  if (!fs.existsSync(rootEnvPath)) fs.writeFileSync(rootEnvPath, '', { mode: 0o600 });
  if (!fs.existsSync(genblazeEnvPath)) fs.writeFileSync(genblazeEnvPath, '', { mode: 0o600 });
  for (const infrastructureEnvPath of infrastructureEnvPaths) {
    if (!fs.existsSync(infrastructureEnvPath)) {
      fs.writeFileSync(infrastructureEnvPath, '', { mode: 0o600 });
    }
  }

  const config = JSON.parse(fs.readFileSync(
    fs.existsSync(configPath) ? configPath : exampleConfigPath,
    'utf8',
  ));
  let genBlazeCatalog = null;
  const genBlazeCatalogPath = path.join(root, 'runtime', 'config', 'genblaze-model-catalog.json');
  try {
    genBlazeCatalog = JSON.parse(fs.readFileSync(genBlazeCatalogPath, 'utf8'));
  } catch {}
  const profiles = action === 'down'
    ? ALL_RUNTIME_COMPOSE_PROFILES
    : getRuntimeComposeProfiles(config, { genBlazeCatalog });

  if (action === 'config') {
    // Resolved Compose output expands env_file values, including credentials.
    // Validate silently so `npm run docker:config` cannot print secrets.
    runDockerCompose(root, rootEnvPath, composeFile, profiles, ['config', '--quiet']);
    return;
  }
  if (action === 'down') {
    runDockerCompose(root, rootEnvPath, composeFile, profiles, ['down', '--remove-orphans']);
    return;
  }

  if (!profiles.includes('genblaze')) {
    runDockerCompose(root, rootEnvPath, composeFile, ['genblaze'], [
      'rm', '-s', '-f', 'genblaze',
    ]);
  }
  prepareLocalMongoAuthentication(root, rootEnvPath, composeFile, profiles);
  const genBlazeComposePlan = splitGenBlazeComposeProfiles(profiles);
  runDockerCompose(root, rootEnvPath, composeFile, genBlazeComposePlan.primaryProfiles, [
    'up', '-d', '--build', '--wait', '--wait-timeout', '180',
  ]);
  synchronizeGrafanaAdminPassword(root, rootEnvPath, composeFile, profiles);
  if (profiles.includes('reverse-proxy')) {
    runDockerCompose(root, rootEnvPath, composeFile, ['core', 'reverse-proxy'], [
      'up', '-d', '--no-deps', '--force-recreate', 'reverse-proxy',
    ]);
  }
  if (genBlazeComposePlan.enabled) {
    runDockerCompose(root, rootEnvPath, composeFile, ['genblaze'], [
      ...GENBLAZE_FINAL_UP_ARGS,
    ]);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
