import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const action = process.argv[2] || 'up';
const flags = process.argv.slice(3);
if (!['up', 'restart', 'update'].includes(action)) {
  console.error('Usage: node scripts/deploy-local.mjs <up|restart|update> [--no-jobs|--enable-jobs]');
  process.exit(1);
}
if (flags.some(flag => !['--no-jobs', '--enable-jobs'].includes(flag)) ||
    flags.includes('--no-jobs') && flags.includes('--enable-jobs')) {
  console.error('Use only one of --no-jobs or --enable-jobs.');
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) console.error(`[deploy] ${result.error.message}`);
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}

if (flags.includes('--no-jobs') || (!flags.includes('--enable-jobs') &&
    fs.existsSync(path.join(root, 'runtime/config/compose.jobs-disabled.json')))) {
  if (!fs.existsSync(path.join(root, 'runtime/config/samsar.config.json'))) {
    console.error('A maintenance build requires an existing runtime config.');
    process.exit(1);
  }
  // The ordinary wizard may start Docker automatically. Maintenance must first
  // require an already reachable engine so old consumers cannot auto-resume.
  console.log('[deploy] Maintenance deployment: Docker must be reachable; job consumers stay disabled.');
  run(process.execPath, [path.join(root, 'scripts/generate-runtime-config.mjs')]);
  run(process.execPath, [path.join(root, 'scripts/docker-compose-runtime.mjs'), action, ...flags]);
  process.exit(0);
}

// The control UI must be available before long-running application image builds.
process.env.SAMSAR_SETUP_REUSE_UNCHANGED = action === 'update' ? '1' : '0';
console.log('[deploy] Starting the setup wizard before application services.');
if (process.platform === 'win32') {
  run('powershell.exe', ['-NoProfile', '-File', path.join(root, 'setup.ps1')]);
} else {
  run('bash', [path.join(root, 'scripts/setup-wizard-docker.sh')]);
}

if (fs.existsSync(path.join(root, 'runtime/config/samsar.config.json'))) {
  run(process.execPath, [path.join(root, 'scripts/generate-runtime-config.mjs')]);
  run(process.execPath, [path.join(root, 'scripts/docker-compose-runtime.mjs'), action, ...flags]);
} else {
  // A fresh install is configured and deployed by the wizard itself.
  console.log('[deploy] Complete setup in the wizard opened above to deploy the application stack.');
}
