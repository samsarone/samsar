import assert from 'node:assert/strict';
import test from 'node:test';

import {
  API_KEY_PREFIX,
  generateAPIKey,
  generateAPIKeySecret,
} from './ApiKeyUtils.js';

test('generateAPIKey creates sk_live_ API keys', () => {
  const apiKey = generateAPIKey();

  assert.equal(API_KEY_PREFIX, 'sk_live_');
  assert.match(apiKey, /^sk_live_[a-f0-9]{40}$/);
});

test('generateAPIKeySecret remains available for prefixed internal key types', () => {
  assert.match(generateAPIKeySecret(), /^[a-f0-9]{40}$/);
});
