import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GMI_CLOUD_KEY_VALIDATION_URL,
  GMI_CLOUD_MEDIA_MODEL_SPECS,
  GMI_CLOUD_MEDIA_MODELS_URL,
  buildGmiCloudRuntimeCatalog,
  chatCatalogModelMatches,
  createGmiCloudValidationRegistry,
  normalizeGmiCloudModelMappings,
  validateGmiCloudProviderCredential,
} from './gmiCloudValidation.mjs';

function response(status, body = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function buildFetch({
  catalog = [],
  mediaCatalog = [],
  mediaStatus = 200,
  mediaBody,
  calls = [],
} = {}) {
  return async (url, options = {}) => {
    calls.push({ url, options });
    if (url === GMI_CLOUD_KEY_VALIDATION_URL) {
      return response(200, { data: catalog });
    }
    if (url === GMI_CLOUD_MEDIA_MODELS_URL) {
      return response(mediaStatus, mediaBody === undefined ? { models: mediaCatalog } : mediaBody);
    }
    throw new Error(`Unexpected validation URL: ${url}`);
  };
}

test('validates a GMICloud credential and preserves actual active catalog ids', async () => {
  const calls = [];
  const result = await validateGmiCloudProviderCredential({
    gmiCloudApiKey: 'gmi-test-key',
  }, {
    fetchImpl: buildFetch({
      calls,
      catalog: [
        { id: 'OPENAI/GPT-5.6-SOL', status: 'active' },
        { id: 'tenant/google/gemini-3.1-pro-preview', active: true },
        { id: 'Qwen/Qwen3.8-Max', state: 'available' },
      ],
    }),
  });

  const validation = result.providers.gmicloud;
  assert.equal(calls[0].url, GMI_CLOUD_KEY_VALIDATION_URL);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer gmi-test-key');
  assert.equal(calls[1].url, GMI_CLOUD_MEDIA_MODELS_URL);
  assert.equal(calls[1].options.method, 'GET');
  assert.equal(calls[1].options.body, undefined);
  assert.equal(validation.ok, true);
  assert.equal(validation.modelMappings['gpt-5.6-sol'].text.modelId, 'OPENAI/GPT-5.6-SOL');
  assert.equal(validation.modelMappings['gemini-3.1-pro'].vision.modelId, 'tenant/google/gemini-3.1-pro-preview');
  assert.equal(validation.modelMappings['QWEN3.8'].text.modelId, 'Qwen/Qwen3.8-Max');
  assert.equal(validation.modelMappings['QWEN3.8'].vision.modelId, 'Qwen/Qwen3.8-Max');
  assert.doesNotMatch(JSON.stringify(result), /gmi-test-key/);
});

test('uses the same authenticated Qwen model for text and vision', async () => {
  const result = await validateGmiCloudProviderCredential({ gmiCloudApiKey: 'gmi-test-key' }, {
    fetchImpl: buildFetch({ catalog: [{ id: 'Qwen/Qwen3.8-Max' }] }),
  });

  assert.equal(result.providers.gmicloud.ok, true);
  assert.equal(result.providers.gmicloud.modelMappings['QWEN3.8'].text.modelId, 'Qwen/Qwen3.8-Max');
  assert.equal(result.providers.gmicloud.modelMappings['QWEN3.8'].vision.modelId, 'Qwen/Qwen3.8-Max');
});

test('accepts an authenticated empty catalog without advertising models', async () => {
  const result = await validateGmiCloudProviderCredential({ gmiCloudApiKey: 'gmi-test-key' }, {
    fetchImpl: buildFetch(),
  });

  assert.equal(result.providers.gmicloud.ok, true);
  assert.deepEqual(result.providers.gmicloud.modelMappings, {});
  assert.deepEqual(result.providers.gmicloud.availableModelKeys, []);
});

test('requires active status when status metadata is present', async () => {
  const result = await validateGmiCloudProviderCredential({ gmiCloudApiKey: 'gmi-test-key' }, {
    fetchImpl: buildFetch({
      catalog: [
        { id: 'openai/gpt-5.6-sol', status: 'inactive' },
        { id: 'google/gemini-3.1-pro-preview', enabled: false },
        { id: 'Qwen/Qwen3.8-Max', active: true },
      ],
    }),
  });

  assert.deepEqual(Object.keys(result.providers.gmicloud.modelMappings), ['QWEN3.8']);
});

test('chat matching ignores owner prefixes and case but remains version exact', () => {
  assert.equal(chatCatalogModelMatches('tenant/OPENAI/GPT-5.6-SOL', 'openai/gpt-5.6-sol'), true);
  assert.equal(chatCatalogModelMatches('google/gemini-3.1-pro-preview-v2', 'google/gemini-3.1-pro-preview'), false);
  assert.equal(chatCatalogModelMatches('Qwen/Qwen3.8-Max-2026-08-01', 'Qwen/Qwen3.8-Max'), false);
});

test('intersects exact active media catalog models without submitting generation requests', async () => {
  const calls = [];
  const result = await validateGmiCloudProviderCredential({ gmiCloudApiKey: 'gmi-test-key' }, {
    fetchImpl: buildFetch({
      calls,
      mediaCatalog: [
        { id: 'GPT-IMAGE-2-GENERATE', status: 'active' },
        { model: 'seedream-5.0-pro', enabled: true },
        { id: 'veo-3.1-generate-001', status: 'inactive' },
        { id: 'gpt-image-2-edit', status: 'active' },
        { id: 'gemini-3.1-flash-image', status: 'active' },
        { id: 'gemini-3-pro-image', status: 'active' },
        { id: 'bria-eraser', status: 'active' },
        { id: 'bria-genfill', status: 'active' },
        { id: 'wan2.7-image-pro', status: 'active' },
      ],
    }),
  });

  const mappings = result.providers.gmicloud.modelMappings;
  assert.equal(mappings.GPTIMAGE2.image.modelId, 'GPT-IMAGE-2-GENERATE');
  assert.equal(mappings.SEEDREAM.image.modelId, 'seedream-5.0-pro');
  assert.equal(mappings['VEO3.1I2V'], undefined);
  assert.equal(mappings.GPTIMAGE2EDIT.image.modelId, 'gpt-image-2-edit');
  assert.equal(mappings.GPTIMAGE2EDIT.image.operation, 'image.edit');
  assert.equal(mappings.NANOBANANA2EDIT.image.modelId, 'gemini-3.1-flash-image');
  assert.equal(mappings.NANOBANANAPROEDIT.image.modelId, 'gemini-3-pro-image');
  assert.equal(mappings.BRIA_ERASER.image.modelId, 'bria-eraser');
  assert.equal(mappings.BRIA_GENFILL.image.modelId, 'bria-genfill');
  assert.equal(mappings['WAN2.7PRO'], undefined);
  assert.equal(result.providers.gmicloud.mediaCatalogVerified, true);
  assert.equal(result.providers.gmicloud.mediaCatalogWarning, null);
  assert.equal(calls.every((call) => call.options.method === 'GET'), true);
  assert.equal(calls.every((call) => call.options.body === undefined), true);
  assert.equal(GMI_CLOUD_MEDIA_MODEL_SPECS.some((spec) => spec.samsarModel === 'WAN2.7PRO'), false);
});

test('maps every exact compatible GMICloud video version and excludes incompatible Kling text video', async () => {
  const result = await validateGmiCloudProviderCredential({ gmiCloudApiKey: 'gmi-test-key' }, {
    fetchImpl: buildFetch({
      mediaCatalog: [
        { id: 'veo-3.1-generate-001', status: 'active' },
        { id: 'seedance-2-0-260128', status: 'active' },
        { id: 'seedance-2-5-260628', status: 'active' },
        { id: 'kling-v3-image-to-video', status: 'active' },
        { id: 'kling-3.0-turbo-i2v', status: 'active' },
        { id: 'kling-v3-text-to-video', status: 'active' },
        { id: 'Kling-Image2Video-V1.6-Pro', status: 'active' },
        { id: 'Kling-Image2Video-V2.1-Master', status: 'active' },
        { id: 'Kling-Image2Video-V2.1-Pro', status: 'active' },
        { id: 'Kling-Image2Video-V2.1-Standard', status: 'active' },
        { id: 'Minimax-Hailuo-02', status: 'active' },
      ],
    }),
  });

  const mappings = result.providers.gmicloud.modelMappings;
  assert.equal(mappings['VEO3.1FLIV'].video.modelId, 'veo-3.1-generate-001');
  assert.equal(mappings['SEEDANCE2.0I2V'].video.modelId, 'seedance-2-0-260128');
  assert.equal(mappings['SEEDANCE2.5I2V'].video.modelId, 'seedance-2-5-260628');
  assert.equal(mappings['SEEDANCE2.0T2V'], undefined);
  assert.equal(mappings.KLINGIMGTOVID3PRO.video.modelId, 'kling-v3-image-to-video');
  assert.equal(mappings.KLINGIMGTOVIDTURBO.video.modelId, 'kling-3.0-turbo-i2v');
  assert.equal(mappings.KLINGIMGTOVIDPRO.video.modelId, 'Kling-Image2Video-V1.6-Pro');
  assert.equal(mappings['KLINGIMGTOVID2.1MASTER'].video.modelId, 'Kling-Image2Video-V2.1-Master');
  assert.equal(mappings['KLINGIMGTOVID2.1PRO'].video.modelId, 'Kling-Image2Video-V2.1-Pro');
  assert.equal(mappings['KLINGIMGTOVID2.1STANDARD'].video.modelId, 'Kling-Image2Video-V2.1-Standard');
  assert.equal(mappings.HAILUOPRO.video.modelId, 'Minimax-Hailuo-02');
  assert.equal(
    GMI_CLOUD_MEDIA_MODEL_SPECS.some((spec) => spec.samsarModel === 'KLINGTXTTOVID3PRO'),
    false,
  );
});

test('maps exact active Express speech versions in native then Fal preference order', async () => {
  const preferred = await validateGmiCloudProviderCredential({ gmiCloudApiKey: 'gmi-test-key' }, {
    fetchImpl: buildFetch({
      mediaCatalog: [
        { model: 'elevenlabs-tts-v3', status: 'active' },
        { model: 'elevenlabs-tts-multilingual-v2', status: 'active' },
        { model: 'gpt-4o-mini-tts', status: 'active' },
      ],
    }),
  });

  assert.deepEqual(preferred.providers.gmicloud.modelMappings.ELEVENLABS, {
    audio: {
      modelId: 'elevenlabs-tts-multilingual-v2',
      operation: 'audio.generate',
    },
  });
  assert.deepEqual(preferred.providers.gmicloud.modelMappings.OPENAI_TTS, {
    audio: {
      modelId: 'gpt-4o-mini-tts',
      operation: 'audio.generate',
    },
  });

  const falFallback = await validateGmiCloudProviderCredential({ gmiCloudApiKey: 'gmi-test-key' }, {
    fetchImpl: buildFetch({
      mediaCatalog: [
        { model: 'elevenlabs-tts-multilingual-v2', status: 'inactive' },
        { model: 'elevenlabs-tts-v3', status: 'active' },
      ],
    }),
  });
  assert.equal(
    falFallback.providers.gmicloud.modelMappings.ELEVENLABS.audio.modelId,
    'elevenlabs-tts-v3',
  );
  assert.equal(falFallback.providers.gmicloud.modelMappings.OPENAI_TTS, undefined);
});

test('accepts the authenticated GMICloud model_ids catalog response shape', async () => {
  const result = await validateGmiCloudProviderCredential({ gmiCloudApiKey: 'gmi-test-key' }, {
    fetchImpl: buildFetch({
      mediaBody: {
        model_ids: ['gpt-image-2-generate', 'elevenlabs-tts-multilingual-v2'],
      },
    }),
  });

  assert.equal(
    result.providers.gmicloud.modelMappings.GPTIMAGE2.image.modelId,
    'gpt-image-2-generate',
  );
  assert.equal(
    result.providers.gmicloud.modelMappings.ELEVENLABS.audio.modelId,
    'elevenlabs-tts-multilingual-v2',
  );
  assert.equal(result.providers.gmicloud.mediaCatalogModelCount, 2);
});

test('keeps authenticated chat routes when the secondary media catalog is unavailable', async () => {
  const result = await validateGmiCloudProviderCredential({ gmiCloudApiKey: 'gmi-test-key' }, {
    fetchImpl: buildFetch({
      catalog: [{ id: 'openai/gpt-5.6-sol', status: 'active' }],
      mediaStatus: 503,
    }),
  });

  const validation = result.providers.gmicloud;
  assert.equal(validation.ok, true);
  assert.equal(validation.modelMappings['gpt-5.6-sol'].text.modelId, 'openai/gpt-5.6-sol');
  assert.equal(validation.mediaCatalogVerified, false);
  assert.match(validation.mediaCatalogWarning, /unavailable.*only verified inference models/i);
});

test('keeps authenticated chat routes when the secondary media catalog is unreadable', async () => {
  const result = await validateGmiCloudProviderCredential({ gmiCloudApiKey: 'gmi-test-key' }, {
    fetchImpl: buildFetch({
      catalog: [{ id: 'google/gemini-3.1-pro-preview', status: 'active' }],
      mediaBody: { unexpected: [] },
    }),
  });

  const validation = result.providers.gmicloud;
  assert.equal(validation.ok, true);
  assert.equal(validation.modelMappings['gemini-3.1-pro'].text.modelId, 'google/gemini-3.1-pro-preview');
  assert.equal(validation.mediaCatalogVerified, false);
  assert.match(validation.mediaCatalogWarning, /unreadable.*only verified inference models/i);
});

test('normalizes mappings against the curated exact route set', () => {
  assert.deepEqual(normalizeGmiCloudModelMappings({
    'gpt-5.6-sol': {
      text: { modelId: 'tenant/openai/gpt-5.6-sol', operation: 'attacker.operation' },
    },
    'QWEN3.8': {
      text: { modelId: 'tenant/Qwen3.8-Max' },
      vision: { modelId: 'tenant/Qwen3.8-Max' },
    },
    GPTIMAGE2: { image: { modelId: 'gpt-image-2-generate' } },
    GPTIMAGE2EDIT: { image: { modelId: 'gpt-image-2-edit' } },
    NANOBANANA2EDIT: { image: { modelId: 'gemini-3.1-flash-image' } },
    BRIA_ERASER: { image: { modelId: 'bria-eraser' } },
    ELEVENLABS: { audio: { modelId: 'elevenlabs-tts-v3', operation: 'attacker.operation' } },
    OPENAI_TTS: { audio: { modelId: 'minimax-tts-speech-2.6-hd' } },
    'VEO3.1I2V': { video: { modelId: 'veo-3.2-generate-001' } },
    'SEEDANCE2.0I2V': { video: { modelId: 'seedance-2-0-260128' } },
    'SEEDANCE2.0T2V': { video: { modelId: 'seedance-2-0-260128' } },
  }), {
    'gpt-5.6-sol': {
      text: { modelId: 'tenant/openai/gpt-5.6-sol', operation: 'chat.completions' },
    },
    'QWEN3.8': {
      text: { modelId: 'tenant/Qwen3.8-Max', operation: 'chat.completions' },
      vision: { modelId: 'tenant/Qwen3.8-Max', operation: 'chat.completions' },
    },
    GPTIMAGE2: {
      image: { modelId: 'gpt-image-2-generate', operation: 'image.generate' },
    },
    GPTIMAGE2EDIT: {
      image: { modelId: 'gpt-image-2-edit', operation: 'image.edit' },
    },
    NANOBANANA2EDIT: {
      image: { modelId: 'gemini-3.1-flash-image', operation: 'image.edit' },
    },
    BRIA_ERASER: {
      image: { modelId: 'bria-eraser', operation: 'image.edit' },
    },
    ELEVENLABS: {
      audio: { modelId: 'elevenlabs-tts-v3', operation: 'audio.generate' },
    },
    'SEEDANCE2.0I2V': {
      video: { modelId: 'seedance-2-0-260128', operation: 'video.generate' },
    },
  });
});

test('builds a credential-bound non-secret runtime catalog', () => {
  const catalog = buildGmiCloudRuntimeCatalog({
    apiKey: 'gmi-secret',
    enabled: true,
    modelMappings: {
      GPTIMAGE2: { image: { modelId: 'gpt-image-2-generate' } },
    },
  });

  assert.equal(catalog.version, 1);
  assert.equal(catalog.provider, 'gmicloud');
  assert.match(catalog.credentialFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(catalog.models.GPTIMAGE2.image.modelId, 'gpt-image-2-generate');
  assert.doesNotMatch(JSON.stringify(catalog), /gmi-secret/);
  assert.deepEqual(buildGmiCloudRuntimeCatalog({
    apiKey: 'gmi-secret',
    enabled: false,
    modelMappings: catalog.models,
  }).models, {});
});

test('rejects a successful response without a readable model catalog', async () => {
  await assert.rejects(
    validateGmiCloudProviderCredential({ gmiCloudApiKey: 'gmi-test-key' }, {
      fetchImpl: async () => response(200, {}),
    }),
    /did not return a readable model catalog/i,
  );
});

test('rejects invalid keys and reports upstream errors distinctly', async () => {
  await assert.rejects(
    validateGmiCloudProviderCredential({ gmiCloudApiKey: 'invalid-key' }, {
      fetchImpl: async () => response(401),
    }),
    /rejected the API key/i,
  );

  await assert.rejects(
    validateGmiCloudProviderCredential({ gmiCloudApiKey: 'possibly-valid-key' }, {
      fetchImpl: async () => response(503),
    }),
    /validation failed with status 503/i,
  );
});

test('skips GMICloud validation when no key was entered', async () => {
  assert.deepEqual(await validateGmiCloudProviderCredential(), { providers: {} });
});

test('binds normalized model mappings and validation tokens to one credential', () => {
  let tokenIndex = 0;
  const registry = createGmiCloudValidationRegistry({
    tokenFactory: () => `gmi-token-${++tokenIndex}`,
  });

  const matchingToken = registry.register('gmi-key', {
    modelMappings: {
      GPTIMAGE2: { image: { modelId: 'gpt-image-2-generate' } },
      UNKNOWN: { image: { modelId: 'attacker-model' } },
    },
  });
  const consumed = registry.consume(matchingToken, 'gmi-key');
  assert.equal(consumed.credentialFingerprint.length, 64);
  assert.deepEqual(Object.keys(consumed.modelMappings), ['GPTIMAGE2']);
  assert.equal(registry.consume(matchingToken, 'gmi-key'), null);

  const mismatchedToken = registry.register('gmi-key');
  assert.equal(registry.consume(mismatchedToken, 'changed-key'), null);
  assert.equal(registry.consume(mismatchedToken, 'gmi-key'), null);
});

test('expires GMICloud validation tokens', () => {
  let currentTime = 1_000;
  const registry = createGmiCloudValidationRegistry({
    ttlMs: 500,
    now: () => currentTime,
    tokenFactory: () => 'expiring-gmi-token',
  });

  const token = registry.register('gmi-key');
  currentTime = 1_500;
  assert.equal(registry.consume(token, 'gmi-key'), null);
});

test('uses the authenticated read-only media model catalog endpoint', () => {
  assert.match(GMI_CLOUD_MEDIA_MODELS_URL, /console\.gmicloud\.ai\/api\/v1\/ie\/requestqueue\/apikey\/models$/);
});
