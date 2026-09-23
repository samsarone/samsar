import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = (await readdir(resolve(root, 'src'), { recursive: true }))
  .filter((file) => file.endsWith('.test.mjs'))
  .sort()
  .map((file) => resolve(root, 'src', file));
if (!files.length) throw new Error('No existing Node regression tests found.');
const result = spawnSync(process.execPath, ['--test', ...files], {
  cwd: root,
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
