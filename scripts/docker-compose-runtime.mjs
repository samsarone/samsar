import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import {
  GENBLAZE_FINAL_UP_ARGS,
  hasValidatedGenBlazeRuntimeCatalog,
  splitGenBlazeComposeProfiles,
} from '../apps/setup-wizard/genblazeCompose.mjs';
import { runComposeWithContainerRecovery } from '../apps/setup-wizard/composeRecovery.mjs';
import { JOB_CONSUMER_SERVICES, resolveJobsDisabledOverride } from './docker-maintenance.mjs';

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

// Compose tracks bind-mount paths, not their contents. Include startup-only
// configuration in service labels so changed catalogs/logger/bootstrap files
// recreate their consumers, while unchanged files keep stable config hashes.
export function getRuntimeContentOverride(root) {
  const filesByService = {
    'mongo-auth-bootstrap': ['deploy/compose/mongo/bootstrap-auth.sh'],
    genblaze: ['runtime/config/genblaze-model-catalog.json'],
    'media-gateway': ['deploy/compose/media-gateway.conf'],
    'reverse-proxy': ['runtime/reverse-proxy/nginx.conf'],
    loki: ['deploy/compose/logger/loki-config.yml'],
    promtail: ['deploy/compose/logger/promtail-config.yml'],
    grafana: ['deploy/compose/logger/grafana/provisioning'],
  };
  const services = {};
  for (const [service, paths] of Object.entries(filesByService)) {
    const hash = createHash('sha256');
    let count = 0;
    const visit = relative => {
      const file = path.join(root, relative);
      if (!fs.existsSync(file)) return;
      const stat = fs.lstatSync(file);
      if (stat.isDirectory()) {
        for (const entry of fs.readdirSync(file).sort()) visit(path.join(relative, entry));
      } else if (stat.isFile()) {
        hash.update(relative).update('\0').update(fs.readFileSync(file)).update('\0');
        count += 1;
      }
    };
    paths.forEach(visit);
    if (count) services[service] = { labels: { 'samsar.runtime-content': hash.digest('hex') } };
  }
  return { services };
}

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

function executeDocker(command, args, root, { capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, COMPOSE_BAKE: 'false' },
      stdio: ['inherit', capture ? 'pipe' : 'inherit', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-64_000);
      if (!capture) process.stderr.write(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve(stdout);
      const error = new Error(`docker ${args.join(' ')} failed with exit code ${code}: ${stderr.trim()}`);
      error.exitCode = code || 1;
      error.stderr = stderr;
      reject(error);
    });
  });
}

async function runDockerCompose(root, rootEnvPath, composeFile, profiles, args, overrideFiles = []) {
  const profileArgs = profiles.flatMap((profile) => ['--profile', profile]);
  await runComposeWithContainerRecovery([
    'compose',
    '--env-file', rootEnvPath,
    '-f', composeFile,
    ...overrideFiles.flatMap(file => ['-f', file]),
    ...profileArgs,
    ...args,
  ], {
    rootDir: root,
    runCommand: (command, commandArgs) => executeDocker(command, commandArgs, root),
    captureCommand: (command, commandArgs) => executeDocker(command, commandArgs, root, { capture: true }),
    onRecovery: (message) => console.log(`[deploy] ${message}`),
  });
}

async function prepareLocalMongoAuthentication(runCompose, profiles) {
  if (!profiles.includes('local-mongo')) return;

  await runCompose(['local-mongo'], ['stop', 'mongo']);
  await runCompose(['local-mongo'], [
    'rm', '-s', '-f', 'mongo-auth-bootstrap',
  ]);
  await runCompose(['local-mongo'], [
    'up', '--force-recreate', '--no-deps', '--abort-on-container-exit',
    '--exit-code-from', 'mongo-auth-bootstrap', 'mongo-auth-bootstrap',
  ]);
}

async function synchronizeGrafanaAdminPassword(runCompose, profiles) {
  if (!profiles.includes('logger')) return;
  await runCompose(['logger'], [
    'exec',
    '-T',
    'grafana',
    'sh',
    '-ec',
    'grafana cli --homepath /usr/share/grafana admin reset-admin-password "$GF_SECURITY_ADMIN_PASSWORD" >/dev/null',
  ]);
}

// Do not restart the one-shot bootstrap job alongside a running mongod: both
// mount the same database. Reuse a completed job only with matching credentials
// and Compose configuration; otherwise use the existing offline migration.
export async function canReuseMongoBootstrap({ captureCompose, inspectBootstrap }) {
  const ids = (await captureCompose(['local-mongo'], ['ps', '--all', '--quiet', 'mongo-auth-bootstrap'])).trim().split(/\s+/).filter(Boolean);
  if (ids.length !== 1) return false;
  const hashOutput = (await captureCompose(['local-mongo'], ['config', '--hash', 'mongo-auth-bootstrap'])).trim();
  const hash = hashOutput.split(/\s+/).at(-1);
  if (!/^[a-f0-9]{64}$/.test(hash || '')) throw new Error('Unable to read the MongoDB bootstrap configuration hash.');
  return (await inspectBootstrap(ids[0])).trim() === `exited 0 ${hash}`;
}

// Explicit dependency groups keep Compose from rerunning the completed MongoDB
// bootstrap when --no-deps is used. Each group is healthy before its dependents
// start. GenBlaze still starts last, after the processor and media tunnel.
export function getIncrementalServiceGroups(services) {
  const pending = new Set(Object.keys(services).filter(name => name !== 'mongo-auth-bootstrap'));
  const groups = [];
  while (pending.size) {
    const ready = [...pending].filter(name => {
      if (name === 'genblaze' && pending.size > 1) return false;
      const dependencies = services[name].depends_on || {};
      return (Array.isArray(dependencies) ? dependencies : Object.keys(dependencies))
        .every(dependency => !pending.has(dependency));
    });
    if (!ready.length) throw new Error('Cannot order the configured Docker services: cyclic dependencies.');
    groups.push(ready);
    ready.forEach(name => pending.delete(name));
  }
  return groups;
}

export async function updateRuntimeServices(profiles, { runCompose, captureCompose, inspectBootstrap }) {
  // BuildKit reuses unchanged layers/images. No running container is touched if
  // a changed image fails to build.
  await runCompose(profiles, ['build']);
  const { services } = JSON.parse(await captureCompose(profiles, ['config', '--format', 'json']));
  const groups = getIncrementalServiceGroups(services);
  if (!profiles.includes('genblaze')) {
    await runCompose(['genblaze'], ['rm', '-s', '-f', 'genblaze']);
  }
  if (profiles.includes('local-mongo') && !await canReuseMongoBootstrap({ captureCompose, inspectBootstrap })) {
    await prepareLocalMongoAuthentication(runCompose, profiles);
  }
  for (const group of groups) {
    await runCompose(profiles, [
      'up', '-d', '--no-build', '--no-deps', '--remove-orphans', '--wait', '--wait-timeout', '180', ...group,
    ]);
  }
  await synchronizeGrafanaAdminPassword(runCompose, profiles);
  if (profiles.includes('reverse-proxy')) {
    // Reload bind-mounted nginx config and re-resolve recreated upstreams
    // without unnecessarily replacing the proxy container.
    await runCompose(profiles, ['exec', '-T', 'reverse-proxy', 'sh', '-ec', 'nginx -t && nginx -s reload']);
  }
}

export async function startRuntimeServices(profiles, { restart = false, runCompose }) {
  // Finish every image build before stopping or replacing running services.
  if (restart) await runCompose(profiles, ['build']);
  else if (profiles.includes('workers')) {
    // The local knowledge index build must succeed before any database bootstrap or container change.
    await runCompose(profiles, ['build', 'assistant-query-processor']);
  }

  if (!profiles.includes('genblaze')) {
    await runCompose(['genblaze'], ['rm', '-s', '-f', 'genblaze']);
  }
  await prepareLocalMongoAuthentication(runCompose, profiles);
  const genBlazeComposePlan = splitGenBlazeComposeProfiles(profiles);
  await runCompose(genBlazeComposePlan.primaryProfiles, restart
    ? ['up', '-d', '--no-build', '--force-recreate', '--remove-orphans', '--wait', '--wait-timeout', '180']
    : ['up', '-d', '--build', '--force-recreate', '--remove-orphans', '--wait', '--wait-timeout', '180']);
  await synchronizeGrafanaAdminPassword(runCompose, profiles);
  if (profiles.includes('reverse-proxy')) {
    await runCompose(['core', 'reverse-proxy'], [
      'up', '-d', '--no-deps', '--force-recreate', 'reverse-proxy',
    ]);
  }
  if (genBlazeComposePlan.enabled) {
    await runCompose(['genblaze'], restart
      ? ['up', '-d', '--no-deps', '--no-build', '--force-recreate', '--wait', '--wait-timeout', '180', 'genblaze']
      : [...GENBLAZE_FINAL_UP_ARGS, '--force-recreate']);
  }
}

async function main() {
  const action = process.argv[2];
  if (!['config', 'up', 'restart', 'update', 'down'].includes(action)) {
    throw new Error('Usage: node scripts/docker-compose-runtime.mjs <config|up|restart|update|down> [--no-jobs|--enable-jobs]');
  }
  const flags = process.argv.slice(3);
  if (flags.some(flag => !['--no-jobs', '--enable-jobs'].includes(flag))) throw new Error('Unknown runtime option.');

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
  const jobsDisabledFile = resolveJobsDisabledOverride(root, {
    noJobs: flags.includes('--no-jobs'), enableJobs: flags.includes('--enable-jobs'),
  });
  const overrideFiles = jobsDisabledFile ? [jobsDisabledFile] : [];
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
    await runDockerCompose(root, rootEnvPath, composeFile, profiles, ['config', '--quiet'], overrideFiles);
    return;
  }
  if (action === 'down') {
    await runDockerCompose(root, rootEnvPath, composeFile, profiles, ['down', '--remove-orphans'], overrideFiles);
    return;
  }

  if (jobsDisabledFile) {
    console.log('[deploy] Maintenance mode: stopping job consumers before building; jobs remain disabled.');
    // Compose scopes this operation to the selected project. Never bring up a
    // recovery loop or queue consumer before its idle override is applied.
    await runDockerCompose(root, rootEnvPath, composeFile, ALL_RUNTIME_COMPOSE_PROFILES,
      ['stop', ...JOB_CONSUMER_SERVICES], overrideFiles);
  }

  if (action === 'update') {
    const contentOverride = getRuntimeContentOverride(root);
    const overrideArgs = overrideFiles.flatMap(file => ['-f', file]);
    if (Object.keys(contentOverride.services).length) {
      const overridePath = path.join(root, 'runtime', 'config', 'compose.bind-content.json');
      fs.mkdirSync(path.dirname(overridePath), { recursive: true, mode: 0o700 });
      fs.writeFileSync(overridePath, JSON.stringify(contentOverride), { mode: 0o600 });
      overrideArgs.push('-f', overridePath);
    }
    const composeArgs = (selected, args) => [
      'compose', '--env-file', rootEnvPath, '-f', composeFile, ...overrideArgs,
      ...selected.flatMap(profile => ['--profile', profile]), ...args,
    ];
    await updateRuntimeServices(profiles, {
      // A conflict must not silently turn an incremental update into a forced
      // recreation of the entire stack through the legacy recovery helper.
      runCompose: (selected, args) => executeDocker('docker', composeArgs(selected, args), root),
      captureCompose: (selected, args) => executeDocker('docker', composeArgs(selected, args), root, { capture: true }),
      inspectBootstrap: id => executeDocker('docker', [
        'inspect', '--format', '{{.State.Status}} {{.State.ExitCode}} {{index .Config.Labels "com.docker.compose.config-hash"}}', id,
      ], root, { capture: true }),
    });
    return;
  }

  await startRuntimeServices(profiles, {
    restart: action === 'restart',
    runCompose: (selectedProfiles, args) => runDockerCompose(root, rootEnvPath, composeFile, selectedProfiles, args, overrideFiles),
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = error.exitCode || 1;
  });
}
