import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { after, before, test } from 'node:test';
import { parseEnvironment } from './infrastructure-credentials.mjs';
import { buildDockerAvailableModelsFromProviderResults } from '../apps/setup-wizard/src/constants/dockerModelAvailability.js';
import { resolveProviderEnvironmentReferences } from '../apps/setup-wizard/src/constants/providerEnvironment.js';

const sourceRoot = fileURLToPath(new URL('..', import.meta.url));
const services = [
  ['processor', 'src/models/ai_utils/SamsarExternalInferenceAdapter.js'],
  ['generator', 'src/inference/SamsarExternalInferenceAdapter.js'],
  ['audio-generator', 'src/inference/SamsarExternalInferenceAdapter.js'],
  ['assistant-query-processor', 'src/SamsarExternalInferenceAdapter.js'],
  ['express-video-listener', 'src/ai_utils/SamsarExternalInferenceAdapter.js'],
  ['ai-video-layer-generator', 'src/utils/SamsarExternalInferenceAdapter.js'],
];
const googleCredentials = {
  type: 'service_account', project_id: 'argon-deployment-fixture',
  client_email: 'fixture@argon-deployment-fixture.iam.gserviceaccount.com', private_key: 'fixture-only',
};
const providerCases = [
  ['openrouter', 'openrouterApiKey', 'OPENROUTER_API_KEY', 'fixture-openrouter-key'],
  ['samsar', 'samsarApiKey', 'SAMSAR_API_KEY', 'fixture-samsar-key'],
  ['googleCloud', 'googleCredentialsJson', 'GOOGLE_APPLICATION_CREDENTIALS_JSON_B64',
    Buffer.from(JSON.stringify(googleCredentials)).toString('base64')],
];
let fixtureRoot;
let wizard;

before(async () => {
  fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'samsar-argon-deployment-'));
  await fs.cp(path.join(sourceRoot, 'scripts'), path.join(fixtureRoot, 'scripts'), { recursive: true });
  const fixtureWizard = path.join(fixtureRoot, 'apps/setup-wizard');
  await fs.mkdir(fixtureWizard, { recursive: true });
  for (const entry of await fs.readdir(path.join(sourceRoot, 'apps/setup-wizard'))) {
    if (entry.endsWith('.mjs') && !entry.endsWith('.test.mjs')) {
      await fs.copyFile(path.join(sourceRoot, 'apps/setup-wizard', entry), path.join(fixtureWizard, entry));
    }
  }
  await fs.cp(path.join(sourceRoot, 'apps/setup-wizard/src/constants'), path.join(fixtureWizard, 'src/constants'), { recursive: true });
  await fs.copyFile(path.join(sourceRoot, 'samsar.config.example.json'), path.join(fixtureRoot, 'samsar.config.example.json'));
  await fs.writeFile(path.join(fixtureRoot, 'package.json'), '{"type":"module"}');
  await fs.symlink(path.join(sourceRoot, 'node_modules'), path.join(fixtureRoot, 'node_modules'), 'dir');

  const serverPath = path.join(fixtureWizard, 'server.mjs');
  const server = await fs.readFile(serverPath, 'utf8');
  const listener = "server.listen(PORT, '0.0.0.0', () => {\n  console.log(`Samsar setup wizard listening on ${PORT}`);\n});";
  assert.ok(server.includes(listener));
  // Exercise the real setup builders without opening a listener or starting Docker.
  await fs.writeFile(serverPath, server
    .replace('const ROOT_DIR = resolveRootDir();', `const ROOT_DIR = ${JSON.stringify(fixtureRoot)};`)
    .replace(listener, 'export { buildRuntimeConfig, writeProviderSecrets };'));
  wizard = await import(pathToFileURL(serverPath));
});

after(async () => {
  if (fixtureRoot) await fs.rm(fixtureRoot, { recursive: true, force: true });
});

for (const [provider, credentialField, variableName, credentialValue] of providerCases) {
  for (const credentialSource of ['direct', 'environment']) {
    test(`${provider}: ${credentialSource} wizard credentials configure Carbon for Docker inference and vision`, async (t) => {
      const credentials = credentialSource === 'direct'
        ? { [credentialField]: provider === 'googleCloud' ? JSON.stringify(googleCredentials) : credentialValue }
        : resolveProviderEnvironmentReferences({ [credentialField]: `$${variableName}` }, {
          [variableName]: credentialValue,
        }).credentials;
      const validation = { [provider]: { ok: true, provider, status: 'valid' } };
      const wizardAvailability = buildDockerAvailableModelsFromProviderResults(validation);
      assert.equal(wizardAvailability.modelProviders['gemini-4-carbon'], provider);
      const payload = {
        credentials,
        deployment: { available: wizardAvailability },
        ...(provider === 'openrouter'
          ? { validatedOpenRouterProviderSecret: { apiKey: credentialValue } }
          : {}),
      };
      const config = await wizard.buildRuntimeConfig(payload);
      assert.equal(config.runtime, 'docker');
      assert.equal(config.deploymentEdition, 'standalone');
      assert.equal(config.providers[provider].enabled, true);
      if (provider === 'openrouter') {
        assert.equal(config.providers.openrouter.gemini4CarbonModel, 'google/gemini-4-carbon');
      }
      if (provider === 'googleCloud') {
        assert.equal(config.providers.googleCloud.gemini4CarbonModel, 'gemini-4-carbon');
      }
      await wizard.writeProviderSecrets(payload);
      await fs.mkdir(path.join(fixtureRoot, 'runtime/config'), { recursive: true });
      await fs.writeFile(path.join(fixtureRoot, 'runtime/config/samsar.config.json'), JSON.stringify(config));
      execFileSync(process.execPath, [path.join(fixtureRoot, 'scripts/generate-runtime-config.mjs')], {
        cwd: fixtureRoot, stdio: 'pipe', timeout: 10000,
      });
      const runtimeEnv = parseEnvironment(await fs.readFile(path.join(fixtureRoot, 'runtime/secrets/root.env'), 'utf8'));
      assert.equal(runtimeEnv.GOOGLE_GEMINI_THINKING_LEVEL, 'HIGH');
      assert.equal(runtimeEnv.OPENROUTER_GEMINI_REASONING_EFFORT, 'high');
      const available = JSON.parse(await fs.readFile(path.join(fixtureRoot, 'runtime/config/available-models.json'), 'utf8'));
      assert.equal(available.modelProviders['gemini-4-carbon'], provider);
      assert.ok(!available.models.includes('gemini-3.1-pro'));
      assert.ok(available.actions.includes('chat'));
      assert.ok(available.actions.includes('assistant'));
      if (provider === 'googleCloud') {
        assert.equal(runtimeEnv.GOOGLE_GEMINI_4_CARBON_MODEL, 'gemini-4-carbon');
        assert.equal(runtimeEnv.GOOGLE_CLOUD_PROJECT, googleCredentials.project_id);
      } else {
        assert.equal(runtimeEnv[variableName], credentialValue);
      }
      if (provider === 'openrouter') assert.equal(runtimeEnv.OPENROUTER_GEMINI_4_CARBON_MODEL, 'google/gemini-4-carbon');

      const originalEnv = process.env;
      process.env = { ...runtimeEnv,
        SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH: path.join(fixtureRoot, 'no-preferences.json'),
        OPENROUTER_INFERENCE_TIMEOUT_MS: '1000',
      };
      try {
        for (const [service, relativePath] of services) {
          const adapterPath = path.join(sourceRoot, 'services', service, relativePath);
          const adapter = await import(pathToFileURL(adapterPath));
          const require = createRequire(adapterPath);
          const { default: OpenAI } = await import(pathToFileURL(require.resolve('openai').replace(/\.js$/, '.mjs')));
          let SamsarClient;
          for (const modulesPath of require.resolve.paths('samsar-js')) {
            const sdkPath = path.join(modulesPath, 'samsar-js/dist/index.js');
            if (await fs.access(sdkPath).then(() => true, () => false)) {
              ({ default: SamsarClient } = await import(pathToFileURL(sdkPath)));
              break;
            }
          }
          assert.ok(SamsarClient, `${service} has its Samsar SDK installed`);
          let sent;
          const response = { choices: [{ message: { role: 'assistant', content: 'verified' } }] };
          const openrouterMock = t.mock.method(OpenAI.Chat.Completions.prototype, 'create', async (request) => {
            sent = request; return response;
          });
          const samsarMock = t.mock.method(SamsarClient.prototype, 'createV2ExternalChatCompletion', async (request) => {
            sent = request; return response;
          });
          try {
            for (const vision of [false, true]) {
              const messages = [{ role: 'user', content: vision ? [
                { type: 'text', text: 'Describe this frame.' },
                { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } },
              ] : 'Describe a scene.' }];
              const request = { model: 'GEMINI4', messages, externalMaxRetries: 0, maxRetries: 0 };
              assert.deepEqual(adapter.getConfiguredInferenceProviders('gemini-4-carbon', request), [provider], service);
              if (provider === 'googleCloud') {
                assert.equal(adapter.shouldUseSamsarExternalInference(request), false, service);
                assert.equal(adapter.shouldUseOpenRouterInference(request), false, service);
                continue;
              }
              const originalMessages = structuredClone(messages);
              const result = provider === 'openrouter'
                ? await adapter.createOpenRouterChatCompletion(request)
                : await adapter.createSamsarExternalChatCompletion(request);
              assert.equal(sent.model, provider === 'openrouter' ? 'google/gemini-4-carbon' : 'gemini-4-carbon', service);
              assert.deepEqual(messages, originalMessages, service);
              assert.equal(result.choices[0].message.content, 'verified', service);
              if (vision) assert.ok(JSON.stringify(sent.messages).includes('QUJD'), service);
            }
          } finally {
            openrouterMock.mock.restore();
            samsarMock.mock.restore();
          }
        }
      } finally {
        process.env = originalEnv;
      }
    });
  }
}
