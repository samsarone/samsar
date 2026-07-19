import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeGeminiUsage,
  normalizeJsonSchemaForGemini,
} from './GoogleGemini.js';

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

test('normalizeGeminiUsage includes thinking tokens in billable output tokens', () => {
  const usage = normalizeGeminiUsage({
    promptTokenCount: 100,
    candidatesTokenCount: 20,
    thoughtsTokenCount: 7,
    cachedContentTokenCount: 10,
    totalTokenCount: 127,
  });

  assert.equal(usage.prompt_tokens, 100);
  assert.equal(usage.completion_tokens, 27);
  assert.equal(usage.output_tokens, 27);
  assert.equal(usage.completion_tokens_details.reasoning_tokens, 7);
  assert.equal(usage.total_tokens, 127);
});
