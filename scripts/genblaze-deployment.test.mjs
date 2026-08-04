import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readText = (relativePath) => fs.readFile(path.join(root, relativePath), 'utf8');
const readJson = async (relativePath) => JSON.parse(await readText(relativePath));

test('keeps GMICloud and GenBlaze disabled in the example configuration', async () => {
  const config = await readJson('samsar.config.example.json');

  assert.equal(config.providers.gmicloud.enabled, false);
  assert.equal(config.services.genblaze, false);
  assert.equal(config.providers.gmicloud.apiKey, undefined);
});

test('setup and runtime use Qwen 3.8 Max for both inference and vision', async () => {
  const [validation, catalog, renderer] = await Promise.all([
    readText('apps/setup-wizard/gmiCloudValidation.mjs'),
    readText('services/genblaze-gateway/app/catalog.py'),
    readText('scripts/generate-runtime-config.mjs'),
  ]);
  assert.match(validation, /'QWEN3\.8': Object\.freeze\(\{[\s\S]*?text:[^\n]*Qwen\/Qwen3\.8-Max[\s\S]*?vision:[^\n]*Qwen\/Qwen3\.8-Max/);
  assert.match(catalog, /"QWEN3\.8": CuratedModel\([\s\S]*?\("Qwen\/Qwen3\.8-Max",\),\s*\("Qwen\/Qwen3\.8-Max",\)/);
  assert.match(catalog, /"QWEN3\.8": CuratedModel/);
  assert.match(catalog, /if curated\.modality == "text":/);
  assert.match(catalog, /must match its text model/);
  assert.match(catalog, /_validate_text_vision_pair\(samsar_model, gmi_model, vision_model\)/);
  assert.match(renderer, /\? 'qwen3\.8-max'\s*:\s*''/);
  assert.match(renderer, /ALIBABA_QWEN_MODEL: alibabaQwenModel/);
  assert.match(renderer, /ALIBABA_QWEN_TEXT_MODEL: alibabaQwenModel/);
  assert.doesNotMatch(validation, /wan2\.7-image-pro/);
  assert.doesNotMatch(catalog, /WAN2\.7PRO/);
});

test('isolates the GMI key to the profiled GenBlaze container', async () => {
  const [compose, renderer, runtimeCompose, setupServer] = await Promise.all([
    readText('deploy/compose/docker-compose.yml'),
    readText('scripts/generate-runtime-config.mjs'),
    readText('scripts/docker-compose-runtime.mjs'),
    readText('apps/setup-wizard/server.mjs'),
  ]);

  assert.match(compose, /^  genblaze:\n    profiles: \["genblaze"\]/m);
  assert.match(compose, /image: samsar-genblaze-gateway:local/);
  assert.match(compose, /runtime\/secrets\/genblaze\.env/);
  assert.match(compose, /genblaze-model-catalog\.json:\/app\/config\/genblaze-model-catalog\.json:ro/);
  assert.match(compose, /GENBLAZE_MODEL_CATALOG_PATH: \/app\/config\/genblaze-model-catalog\.json/);
  assert.match(compose, /http:\/\/127\.0\.0\.1:8080\/health\/ready/);
  assert.match(
    renderer,
    /effectiveGmiCloudConfig\.enabled[\s\S]*gmiCloudCredentialValidationCurrent[\s\S]*config\.services\?\.genblaze === true/,
  );
  assert.match(setupServer, /credentialFingerprint: gmiCloudEnabled/);
  assert.match(renderer, /isGmiCloudCredentialValidationCurrent/);
  assert.match(renderer, /SAMSAR_GENBLAZE_BASE_URL:[^\n]*'http:\/\/genblaze:8080\/v1'/);
  assert.match(renderer, /SAMSAR_GENBLAZE_MODEL_CATALOG_PATH:[^\n]*genblaze-model-catalog\.json/);
  assert.match(renderer, /genblazeModelCatalogPath[\s\S]*?mode: 0o644/);
  assert.doesNotMatch(renderer, /^\s*GMI_API_KEY:/m);
  assert.match(runtimeCompose, /!profiles\.includes\('genblaze'\)[\s\S]*?'rm', '-s', '-f', 'genblaze'/);
  assert.match(setupServer, /genBlazeComposePlan\.enabled[\s\S]*?waitForComposeServiceHealthy\('genblaze'\)/);
  assert.match(setupServer, /removeDisabledGenBlazeContainer\(run\)/);
  assert.match(
    setupServer,
    /readJson\(GENBLAZE_MODEL_CATALOG_PATH\)[\s\S]*getRuntimeComposeProfiles\(runtimeConfig, \{ genBlazeCatalog \}\)/,
  );
  assert.match(setupServer, /splitGenBlazeComposeProfiles\(profiles\)/);
  assert.match(setupServer, /GENBLAZE_FINAL_UP_ARGS/);
});

test('offers Backblaze as a public S3-compatible storage backend', async () => {
  const [wizard, server, renderer, processorAws] = await Promise.all([
    readText('apps/setup-wizard/src/components/OnboardingWizard.jsx'),
    readText('apps/setup-wizard/server.mjs'),
    readText('scripts/generate-runtime-config.mjs'),
    readText('services/processor/src/models/AWS.js'),
  ]);

  assert.match(wizard, /storageMode === 'backblazeB2'/);
  assert.match(wizard, /value=\{activeDataConfig\.s3Endpoint\}/);
  assert.match(wizard, /required=\{dataConfig\.storageMode === 'backblazeB2'\}/);
  assert.doesNotMatch(wizard, /https:\/\/s3\.\$\{storageRegion\}\.backblazeb2\.com/);
  assert.doesNotMatch(wizard, /us-west-004/);
  assert.doesNotMatch(wizard, /Public B2 bucket URL/);
  assert.match(wizard, /buildBackblazePublicBucketUrl/);
  assert.match(server, /storage\.mode === 'backblaze-b2'/);
  assert.match(server, /parseBackblazeS3Endpoint\(configuredEndpoint\)/);
  assert.match(server, /s3Endpoint: backblazeEndpoint\?\.endpoint \|\| configuredEndpoint/);
  assert.match(server, /objectTaggingSupported: !isBackblazeB2/);
  assert.match(renderer, /SAMSAR_S3_OBJECT_TAGGING_SUPPORTED/);
  assert.match(processorAws, /shouldUseS3ObjectTagging\(\)/);
});
