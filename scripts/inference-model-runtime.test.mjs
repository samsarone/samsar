import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { parseEnvironment } from './infrastructure-credentials.mjs';
import { resolveProviderEnvironmentReferences } from '../apps/setup-wizard/src/constants/providerEnvironment.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const gptModels = ['gpt-6-astra', 'gpt-6.1-sol'];
const claudeModels = ['claude-opus-5.5', 'claude-fable-5.2'];
let fixtureRoot;

before(async () => {
  fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'samsar-model-runtime-'));
  await fs.cp(path.join(root, 'scripts'), path.join(fixtureRoot, 'scripts'), { recursive: true });
  const wizard = path.join(fixtureRoot, 'apps/setup-wizard');
  await fs.mkdir(wizard, { recursive: true });
  for (const entry of await fs.readdir(path.join(root, 'apps/setup-wizard'))) {
    if (entry.endsWith('.mjs') && !entry.endsWith('.test.mjs')) {
      await fs.copyFile(path.join(root, 'apps/setup-wizard', entry), path.join(wizard, entry));
    }
  }
  await fs.cp(path.join(root, 'apps/setup-wizard/src/constants'), path.join(wizard, 'src/constants'), { recursive: true });
  await fs.copyFile(path.join(root, 'samsar.config.example.json'), path.join(fixtureRoot, 'samsar.config.example.json'));
  await fs.writeFile(path.join(fixtureRoot, 'package.json'), '{"type":"module"}');
  await fs.mkdir(path.join(fixtureRoot, 'runtime/config'), { recursive: true });
  await fs.mkdir(path.join(fixtureRoot, 'runtime/secrets'), { recursive: true });
});
after(async () => { if (fixtureRoot) await fs.rm(fixtureRoot, { recursive: true, force: true }); });

for (const [provider, field, variable, expectedModels] of [
  ['openai', 'openaiApiKey', 'OPENAI_API_KEY', gptModels],
  ['anthropic', 'anthropicApiKey', 'ANTHROPIC_API_KEY', claudeModels],
  ['openrouter', 'openrouterApiKey', 'OPENROUTER_API_KEY', [...gptModels, ...claudeModels]],
  ['samsar', 'samsarApiKey', 'SAMSAR_API_KEY', [...gptModels, ...claudeModels]],
]) {
  for (const source of ['direct', 'environment']) {
    test(`${provider} ${source} credentials render both supported model choices`, async () => {
      const apiKey = `test-${provider}-model-choices`;
      const credentials = source === 'direct' ? { [field]: apiKey }
        : resolveProviderEnvironmentReferences({ [field]: `$${variable}` }, { [variable]: apiKey }).credentials;
      const config = JSON.parse(await fs.readFile(path.join(root, 'samsar.config.example.json'), 'utf8'));
      config.runtime = 'docker';
      config.deploymentEdition = 'standalone';
      config.providers = { [provider]: { enabled: true, apiKey: credentials[field] } };
      await fs.writeFile(path.join(fixtureRoot, 'runtime/config/samsar.config.json'), JSON.stringify(config));
      await fs.writeFile(path.join(fixtureRoot, 'runtime/secrets/provider.credentials.json'), JSON.stringify({
        ...(provider === 'openrouter' ? { openrouter: { apiKey } } : {}),
      }));
      execFileSync(process.execPath, [path.join(fixtureRoot, 'scripts/generate-runtime-config.mjs')], {
        cwd: fixtureRoot, stdio: 'pipe', timeout: 10000,
      });
      const env = parseEnvironment(await fs.readFile(path.join(fixtureRoot, 'runtime/secrets/root.env'), 'utf8'));
      const available = JSON.parse(await fs.readFile(path.join(fixtureRoot, 'runtime/config/available-models.json'), 'utf8'));
      assert.equal(env[variable], apiKey);
      for (const model of expectedModels) {
        assert.ok(available.models.includes(model), model);
        assert.equal(available.modelProviders[model], provider);
      }
      for (const model of [...gptModels, ...claudeModels].filter(model => !expectedModels.includes(model))) {
        assert.equal(available.models.includes(model), false, model);
      }
      assert.ok(available.actions.includes('chat'));
      assert.ok(available.actions.includes('assistant'));
    });
  }
}
