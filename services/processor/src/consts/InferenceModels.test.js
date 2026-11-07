import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_INFERENCE_MODEL,
  DEFAULT_GEMINI_4_ARGON_VERTEX_MODEL,
  GEMINI_4_ARGON_INFERENCE_MODEL,
  GPT_56_SOL_XHIGH_INFERENCE_MODEL,
  GPT_56_SOL_REASONING_EFFORT,
  INFERENCE_MODEL_KEYS,
  INFERENCE_MODELS,
  INFERENCE_PROVIDER_MODEL_KEYS,
  INFERENCE_REASONING_EFFORTS,
  KIMI_K3_INFERENCE_MODEL,
  KIMI_K3_PROVIDER_MODEL,
  PUBLICATION_METADATA_INFERENCE_SETTINGS,
  QWEN_38_INFERENCE_MODEL,
  QWEN_38_MAX_MODEL,
  getReasoningEffortForInferenceModel,
  getPublicationMetadataInferenceSettings,
  getProviderModelForInferenceModel,
  isOpenAIInferenceModel,
  isGeminiArgonProviderModel,
  isKimiInferenceModel,
  isQwenInferenceModel,
  normalizeGeminiProviderModel,
  normalizeInferenceModel,
  normalizeOpenAIInferenceModel,
} from './InferenceModels.js';

test('defaults inference model to GPT 6 Astra', () => {
  assert.equal(INFERENCE_MODELS.Inference, 'gpt-6-astra');
  assert.equal(INFERENCE_MODEL_KEYS.GPT_56_SOL, 'gpt-6-astra');
  assert.equal(INFERENCE_PROVIDER_MODEL_KEYS[INFERENCE_MODEL_KEYS.GPT_56_SOL], 'gpt-6-astra');
  assert.equal(normalizeInferenceModel(), DEFAULT_INFERENCE_MODEL);
  assert.equal(normalizeInferenceModel(''), DEFAULT_INFERENCE_MODEL);
  assert.equal(normalizeInferenceModel('gpt-6-astra'), DEFAULT_INFERENCE_MODEL);
  assert.equal(getProviderModelForInferenceModel('gpt-6-astra'), 'gpt-6-astra');
  assert.equal(GPT_56_SOL_REASONING_EFFORT, 'high');
});

test('preserves the GPT 6 Astra extra-high logical option while routing to the Sol provider model', () => {
  assert.equal(GPT_56_SOL_XHIGH_INFERENCE_MODEL, 'gpt-6-astra-xhigh');
  for (const alias of [
    'gpt-6-astra-xhigh',
    'GPT 6 Astra XHigh',
    'GPT 6 Astra Extra High',
  ]) {
    assert.equal(normalizeInferenceModel(alias), GPT_56_SOL_XHIGH_INFERENCE_MODEL);
    assert.equal(getReasoningEffortForInferenceModel(alias), 'xhigh');
    assert.equal(getProviderModelForInferenceModel(alias), 'gpt-6-astra');
  }
  assert.equal(isOpenAIInferenceModel(GPT_56_SOL_XHIGH_INFERENCE_MODEL), true);
});

test('keeps publication metadata on Sol with explicit xhigh reasoning', () => {
  assert.equal(INFERENCE_MODELS.PublicationMetadata, 'gpt-6-astra');
  assert.equal(INFERENCE_REASONING_EFFORTS.PublicationMetadata, 'xhigh');
  assert.deepEqual(PUBLICATION_METADATA_INFERENCE_SETTINGS, {
    model: 'gpt-6-astra',
    reasoning: { effort: 'xhigh' },
  });
  assert.equal(normalizeOpenAIInferenceModel('gpt-6-astra'), 'gpt-6-astra');
  assert.equal(getReasoningEffortForInferenceModel('gpt-6-astra'), 'high');
  assert.equal(isOpenAIInferenceModel('gpt-6-astra'), true);

  // Publication metadata shares the model, while its settings retain xhigh effort.
  assert.equal(normalizeInferenceModel('gpt-6-astra'), DEFAULT_INFERENCE_MODEL);
});

test('uses the session inference provider for publication metadata', () => {
  assert.deepEqual(getPublicationMetadataInferenceSettings('gpt-6-astra'), {
    model: 'gpt-6-astra',
    reasoning: { effort: 'xhigh' },
  });
  assert.deepEqual(getPublicationMetadataInferenceSettings('gemini-4-argon'), {
    model: 'gemini-4-argon',
  });
  assert.deepEqual(getPublicationMetadataInferenceSettings('QWEN3.8'), {
    model: 'QWEN3.8',
  });
});

test('normalizes Gemini 4 Argon assistant model aliases to the current Vertex model', () => {
  assert.equal(INFERENCE_MODEL_KEYS.GEMINI_4_ARGON, 'gemini-4-argon');
  assert.equal(
    INFERENCE_PROVIDER_MODEL_KEYS[INFERENCE_MODEL_KEYS.GEMINI_4_ARGON],
    DEFAULT_GEMINI_4_ARGON_VERTEX_MODEL,
  );
  assert.equal(normalizeInferenceModel('gemini-4-argon'), GEMINI_4_ARGON_INFERENCE_MODEL);
  assert.equal(normalizeInferenceModel('gemini-4-argon'), GEMINI_4_ARGON_INFERENCE_MODEL);
  assert.equal(normalizeInferenceModel('gemini-4'), GEMINI_4_ARGON_INFERENCE_MODEL);
  assert.equal(normalizeInferenceModel('gemini-4-argon'), GEMINI_4_ARGON_INFERENCE_MODEL);
  assert.equal(normalizeInferenceModel('Gemini 4 Argon'), GEMINI_4_ARGON_INFERENCE_MODEL);
  assert.equal(normalizeInferenceModel('GEMINI4'), GEMINI_4_ARGON_INFERENCE_MODEL);
  assert.equal(normalizeInferenceModel('gemini4'), GEMINI_4_ARGON_INFERENCE_MODEL);
  assert.equal(normalizeInferenceModel('Google Gemini 4 Argon'), GEMINI_4_ARGON_INFERENCE_MODEL);

  assert.equal(getProviderModelForInferenceModel('gemini-4-argon'), DEFAULT_GEMINI_4_ARGON_VERTEX_MODEL);
  assert.equal(normalizeGeminiProviderModel('gemini-4-argon'), DEFAULT_GEMINI_4_ARGON_VERTEX_MODEL);
  assert.equal(normalizeGeminiProviderModel('gemini-4'), DEFAULT_GEMINI_4_ARGON_VERTEX_MODEL);
  assert.equal(getProviderModelForInferenceModel('Gemini 4 Argon'), DEFAULT_GEMINI_4_ARGON_VERTEX_MODEL);
  assert.equal(getProviderModelForInferenceModel('gemini-4-argon-20261013'), 'gemini-4-argon-20261013');
  assert.equal(isGeminiArgonProviderModel('gemini-4-argon-20261013'), true);
  assert.equal(isGeminiArgonProviderModel('gemini-4-argonish'), false);
});

test('normalizes Qwen aliases while selecting Qwen 3.8 Max by default', () => {
  assert.equal(QWEN_38_INFERENCE_MODEL, 'QWEN3.8');
  assert.equal(QWEN_38_MAX_MODEL, 'qwen3.8-max');
  assert.equal(normalizeInferenceModel('QWEN3.8'), QWEN_38_INFERENCE_MODEL);
  assert.equal(normalizeInferenceModel('Qwen 3.8'), QWEN_38_INFERENCE_MODEL);
  assert.equal(normalizeInferenceModel('qwen3.8-max'), QWEN_38_INFERENCE_MODEL);
  assert.equal(normalizeInferenceModel('qwen/qwen3.8-max'), QWEN_38_INFERENCE_MODEL);
  assert.equal(normalizeInferenceModel('Alibaba Cloud Qwen 3.8'), QWEN_38_INFERENCE_MODEL);
  assert.equal(isQwenInferenceModel('qwen3.8-max'), true);
  assert.equal(getProviderModelForInferenceModel('QWEN3.8'), QWEN_38_MAX_MODEL);
  assert.equal(
    getProviderModelForInferenceModel('QWEN3.8', { vision: true }),
    QWEN_38_MAX_MODEL,
  );
  assert.equal(
    getProviderModelForInferenceModel('QWEN3.8', {
      env: {
        ALIBABA_QWEN_MODEL: 'generic-qwen-model',
        ALIBABA_QWEN_TEXT_MODEL: 'legacy-text-qwen-model',
      },
    }),
    'generic-qwen-model',
  );
  assert.equal(
    getProviderModelForInferenceModel('QWEN3.8', {
      vision: true,
      env: { ALIBABA_QWEN_MODEL: 'generic-qwen-model' },
    }),
    'generic-qwen-model',
  );
  assert.equal(
    getProviderModelForInferenceModel('QWEN3.8', {
      env: { ALIBABA_QWEN_TEXT_MODEL: 'text-qwen-model' },
    }),
    'text-qwen-model',
  );
});

test('normalizes Kimi K3 aliases to the native multimodal provider model', () => {
  assert.equal(INFERENCE_MODEL_KEYS.KIMI_K3, 'kimi-k3');
  assert.equal(KIMI_K3_INFERENCE_MODEL, 'kimi-k3');
  assert.equal(KIMI_K3_PROVIDER_MODEL, 'kimi-k3');
  assert.equal(normalizeInferenceModel('KIMIK3'), KIMI_K3_INFERENCE_MODEL);
  assert.equal(normalizeInferenceModel('Kimi K3'), KIMI_K3_INFERENCE_MODEL);
  assert.equal(normalizeInferenceModel('Moonshot Kimi K3'), KIMI_K3_INFERENCE_MODEL);
  assert.equal(isKimiInferenceModel('kimi-k3'), true);
  assert.equal(getProviderModelForInferenceModel('KIMIK3'), KIMI_K3_PROVIDER_MODEL);
  assert.deepEqual(getPublicationMetadataInferenceSettings('KIMIK3'), {
    model: KIMI_K3_INFERENCE_MODEL,
  });
});


test('upgrades saved GPT 5.6 selections to GPT 6 Astra without losing xhigh effort', () => {
  assert.equal(normalizeInferenceModel('gpt-5.6-sol'), 'gpt-6-astra');
  assert.equal(normalizeInferenceModel('gpt-5.6-sol-xhigh'), 'gpt-6-astra-xhigh');
});


test('keeps Sol and Astra distinct and preserves explicit xhigh', () => {
  for (const alias of ['gpt-6-astra', 'GPT 6 Astra High', 'gpt-6.1-sol', 'GPT 6.1 Sol High']) {
    assert.equal(normalizeInferenceModel(alias), alias.toLowerCase().includes('6.1') ? 'gpt-6.1-sol' : 'gpt-6-astra');
    assert.equal(getReasoningEffortForInferenceModel(alias), 'high');
  }
  for (const alias of ['gpt-6-astra-xhigh', 'GPT 6 Astra Extra High', 'gpt-6.1-sol-xhigh']) {
    assert.equal(getReasoningEffortForInferenceModel(alias), 'xhigh');
  }
});
