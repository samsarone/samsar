import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveImageListItemRequiresEnhancement } from './SessionRequestBuilder.js';

test('supplied image-list inputs never opt into AI image editing implicitly', () => {
  assert.equal(resolveImageListItemRequiresEnhancement(), false);
  assert.equal(resolveImageListItemRequiresEnhancement({}), false);
  assert.equal(resolveImageListItemRequiresEnhancement({
    prepared_width: 512,
    required_width: 1080,
  }), false);
  assert.equal(resolveImageListItemRequiresEnhancement({
    requires_enhancement: true,
  }), true);
  assert.equal(resolveImageListItemRequiresEnhancement({
    requiresEnhancement: false,
  }), false);
});
