import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeJsonSchemaForGemini } from './GoogleGemini.js';

test('normalizeJsonSchemaForGemini removes empty enum values rejected by Vertex', () => {
  const schema = {
    type: 'object',
    properties: {
      sounds: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            gender: {
              type: 'string',
              enum: ['M', 'F', ''],
              description: 'Use an empty string only for sound_effect items.',
            },
          },
        },
      },
    },
  };

  const normalized = normalizeJsonSchemaForGemini(schema);

  assert.deepEqual(
    normalized.properties.sounds.items.properties.gender.enum,
    ['M', 'F'],
  );
  assert.equal(
    normalized.properties.sounds.items.properties.gender.description,
    'Use an empty string only for sound_effect items.',
  );
});
