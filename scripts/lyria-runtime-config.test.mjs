import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('optional Gemini key survives runtime generation without enabling unrelated models', async (t) => {
  const source = fileURLToPath(new URL('..', import.meta.url));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lyria-runtime-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.cp(path.join(source, 'scripts'), path.join(root, 'scripts'), { recursive: true });
  await fs.mkdir(path.join(root, 'apps/setup-wizard'), { recursive: true });
  for (const name of ['gmiCloudValidation.mjs', 'storageConfig.mjs']) {
    await fs.copyFile(path.join(source, 'apps/setup-wizard', name), path.join(root, 'apps/setup-wizard', name));
  }
  await fs.cp(path.join(source, 'apps/setup-wizard/src/constants'), path.join(root, 'apps/setup-wizard/src/constants'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  const config = JSON.parse(await fs.readFile(path.join(source, 'samsar.config.example.json'), 'utf8'));
  config.providers = { googleCloud: { enabled: true, musicOnly: true, lyriaGeminiConfigured: true } };
  await fs.mkdir(path.join(root, 'runtime/config'), { recursive: true });
  await fs.mkdir(path.join(root, 'runtime/secrets'), { recursive: true });
  const configPath = path.join(root, 'runtime/config/samsar.config.json');
  await fs.writeFile(configPath, JSON.stringify(config));
  await fs.writeFile(path.join(root, 'runtime/secrets/provider.credentials.json'), JSON.stringify({ googleCloud: { geminiApiKey: 'test-gemini-secret' } }));
  execFileSync(process.execPath, [path.join(root, 'scripts/generate-runtime-config.mjs')], { cwd: root, stdio: 'pipe' });
  const env = await fs.readFile(path.join(root, 'runtime/secrets/root.env'), 'utf8');
  assert.match(env, /^GOOGLE_LYRIA_GEMINI_API_KEY=test-gemini-secret$/m);
  assert.equal((await fs.stat(path.join(root, 'runtime/secrets/root.env'))).mode & 0o777, 0o600);
  const available = JSON.parse(await fs.readFile(path.join(root, 'runtime/config/available-models.json'), 'utf8'));
  assert.deepEqual(available.models, ['LYRIA3']);
  assert.deepEqual(available.audio.ttsProviders, []);
  assert.equal((await fs.readFile(configPath, 'utf8')).includes('test-gemini-secret'), false);

  config.providers.googleCloud = { enabled: true, projectId: 'old-project', credentialsJsonB64: 'legacy-test-credentials' };
  await fs.writeFile(configPath, JSON.stringify(config));
  execFileSync(process.execPath, [path.join(root, 'scripts/generate-runtime-config.mjs')], { cwd: root, stdio: 'pipe' });
  const oldEnv = await fs.readFile(path.join(root, 'runtime/secrets/root.env'), 'utf8');
  assert.match(oldEnv, /^GOOGLE_LYRIA_GEMINI_API_KEY=$/m);
  assert.match(oldEnv, /^GOOGLE_APPLICATION_CREDENTIALS_JSON_B64=legacy-test-credentials$/m);
});
