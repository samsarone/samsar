import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const action = process.argv[2] || 'up';
if (!['up', 'restart', 'update'].includes(action)) {
  console.error('Usage: node scripts/deploy-local.mjs <up|restart|update>');
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) console.error(`[deploy] ${result.error.message}`);
  if (result.error || result.status !== 0) process.exit(result.status || 1);
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
  run(process.execPath, [path.join(root, 'scripts/docker-compose-runtime.mjs'), action]);
} else {
  // A fresh install is configured and deployed by the wizard itself.
  console.log('[deploy] Complete setup in the wizard opened above to deploy the application stack.');
}
