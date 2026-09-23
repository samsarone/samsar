import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveLyriaModel, usesLyriaGeminiApi } from './GoogleLyriaConfig.js';

test('Gemini upgrades to Lyria 3.5 while existing Vertex credentials keep Lyria 3', () => {
  assert.equal(resolveLyriaModel({}), 'lyria-3-pro-preview');
  for (const key of ['GOOGLE_LYRIA_GEMINI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY']) {
    assert.equal(resolveLyriaModel({ [key]: 'test-key' }), 'lyria-3.5');
  }
  assert.equal(resolveLyriaModel({ GEMINI_API_KEY: 'test', GOOGLE_LYRIA_API_PROVIDER: 'vertex' }), 'lyria-3-pro-preview');
  assert.equal(usesLyriaGeminiApi({ GOOGLE_LYRIA_API_PROVIDER: 'gemini' }), true);
});

test('explicit model overrides remain authoritative', () => {
  assert.equal(resolveLyriaModel({ GEMINI_API_KEY: 'test', GOOGLE_LYRIA_MODEL: 'lyria-3-clip-preview' }), 'lyria-3-clip-preview');
  assert.equal(resolveLyriaModel({ GOOGLE_LYRIA_3_MODEL: 'custom', GOOGLE_LYRIA_MODEL: 'other' }), 'custom');
});
