import assert from 'node:assert/strict';
import test from 'node:test';

const {
  buildModerationRequestBody,
  buildGoogleModerationInferenceReceipt,
  extractGeminiModerationPayload,
  getGoogleModerationCredentialOptions,
  normalizeGeminiModerationPayload,
  normalizeGoogleModerationResponse,
} = await import('./GoogleModeration.js');

test('Argon moderation keeps JSON classification while using supported thinking settings', () => {
  const { generationConfig } = buildModerationRequestBody('A harmless landscape', {
    model: 'gemini-4-argon', maxOutputTokens: 100000,
  });
  assert.deepEqual(generationConfig.thinkingConfig, { thinkingLevel: 'LOW' });
  assert.equal(generationConfig.maxOutputTokens, 32768);
  assert.equal(generationConfig.temperature, undefined);
  assert.equal(generationConfig.topP, undefined);
  assert.equal(generationConfig.responseMimeType, 'application/json');
  assert.ok(generationConfig.responseSchema.properties.flagged);
  const versionedConfig = buildModerationRequestBody('A harmless landscape', {
    model: 'gemini-4-argon-production', maxOutputTokens: 100000,
  }).generationConfig;
  assert.deepEqual(versionedConfig, generationConfig);
  const legacyConfig = buildModerationRequestBody('A harmless landscape', { model: 'gemini-2.5-flash' }).generationConfig;
  assert.equal(legacyConfig.temperature, 0);
  assert.equal(legacyConfig.thinkingConfig, undefined);
});

test('buildGoogleModerationInferenceReceipt exposes every paid Vertex token counter', () => {
  const usageMetadata = {
    promptTokenCount: 120,
    candidatesTokenCount: 18,
    thoughtsTokenCount: 7,
    cachedContentTokenCount: 20,
  };

  assert.deepEqual(buildGoogleModerationInferenceReceipt({
    modelVersion: 'gemini-4-argon-20260701',
    usageMetadata,
  }, { model: 'gemini-4-argon', attempt: 3 }), {
    stage: 'moderation',
    attempt: 3,
    model: 'gemini-4-argon-20260701',
    provider: 'google',
    usageMetadata,
  });
});

test('extractGeminiModerationPayload parses Gemini JSON output', () => {
  assert.deepEqual(extractGeminiModerationPayload({
    candidates: [
      {
        content: {
          parts: [
            {
              text: JSON.stringify({
                flagged: false,
                reason: 'benign prompt',
                categories: [
                  {
                    name: 'violence',
                    flagged: false,
                    score: 0.02,
                  },
                ],
              }),
            },
          ],
        },
      },
    ],
  }), {
    flagged: false,
    reason: 'benign prompt',
    categories: [
      {
        name: 'violence',
        flagged: false,
        score: 0.02,
      },
    ],
  });
});

test('normalizeGeminiModerationPayload preserves OpenAI-compatible moderation shape', () => {
  assert.deepEqual(normalizeGeminiModerationPayload({
    flagged: true,
    reason: 'blocked by policy',
    categories: [
      {
        name: 'graphic violence',
        flagged: true,
        score: 0.93,
      },
      {
        name: 'harassment',
        flagged: false,
        score: 0.12,
      },
    ],
  }, { model: 'gemini-4-argon' }), {
    model: 'gemini-4-argon',
    results: [
      {
        flagged: true,
        categories: {
          graphic_violence: true,
          harassment: false,
        },
        category_scores: {
          graphic_violence: 0.93,
          harassment: 0.12,
        },
      },
    ],
    google: {
      moderation_reason: 'blocked by policy',
    },
  });
});

test('normalizeGoogleModerationResponse flags Vertex prompt filter blocks', () => {
  const normalized = normalizeGoogleModerationResponse({
    promptFeedback: {
      blockReason: 'PROHIBITED_CONTENT',
    },
  }, { model: 'gemini-4-argon' });

  assert.equal(normalized.results[0].flagged, true);
  assert.equal(normalized.results[0].categories.prohibited_content, true);
  assert.equal(normalized.results[0].category_scores.prohibited_content, 1);
  assert.equal(normalized.google.promptFeedback.blockReason, 'PROHIBITED_CONTENT');
});

test('Gemini flagged categories retain conservative scores when provider scores are unusable', () => {
  const invalidScores = [
    undefined, null, '', '  ', false, true, [], [0], [0.2], {},
    Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
    'Infinity', 'not-a-score', -0.1, 1.1,
  ];

  for (const score of invalidScores) {
    for (const categories of [
      [{ name: 'violence', flagged: true, score }],
      { violence: { flagged: true, score } },
    ]) {
      const normalized = normalizeGeminiModerationPayload({ flagged: true, categories });
      assert.equal(normalized.results[0].categories.violence, true);
      assert.equal(normalized.results[0].category_scores.violence, 1);
    }
  }
});

test('Gemini category normalization preserves valid zero and numeric string scores', () => {
  for (const [score, expected] of [[0, 0], ['0', 0], [' 0.24 ', 0.24], [1, 1]]) {
    for (const categories of [
      [{ name: 'violence', flagged: true, score }],
      { violence: { flagged: true, score } },
    ]) {
      const normalized = normalizeGeminiModerationPayload({ flagged: true, categories });
      assert.equal(normalized.results[0].categories.violence, true);
      assert.equal(normalized.results[0].category_scores.violence, expected);
    }
  }

  const normalized = normalizeGeminiModerationPayload({
    flagged: false,
    categories: [{ name: 'violence', flagged: false, score: false }],
  });
  assert.equal(normalized.results[0].category_scores.violence, 0);
});

test('normalizeGoogleModerationResponse includes Gemini response metadata', () => {
  const normalized = normalizeGoogleModerationResponse({
    responseId: 'response-id',
    modelVersion: 'gemini-4-argon',
    promptFeedback: {},
    candidates: [
      {
        finishReason: 'STOP',
        safetyRatings: [
          {
            category: 'HARM_CATEGORY_HATE_SPEECH',
            probability: 'NEGLIGIBLE',
          },
        ],
        content: {
          parts: [
            {
              text: '```json\n{"flagged":false,"reason":"ok","categories":[]}\n```',
            },
          ],
        },
      },
    ],
  }, { model: 'gemini-4-argon' });

  assert.equal(normalized.results[0].flagged, false);
  assert.deepEqual(normalized.results[0].categories, {});
  assert.equal(normalized.google.finishReason, 'STOP');
  assert.equal(normalized.google.responseId, 'response-id');
  assert.equal(normalized.google.modelVersion, 'gemini-4-argon');
});

test('normalizeGoogleModerationResponse uses Gemini inference model override by default', () => {
  const previousModerationModel = process.env.GOOGLE_GEMINI_MODERATION_MODEL;
  const previousVertexModerationModel = process.env.GOOGLE_MODERATION_VERTEX_MODEL;
  const previousGenericModerationModel = process.env.GOOGLE_MODERATION_MODEL;
  const previousGemini31Model = process.env.GOOGLE_GEMINI_4_ARGON_MODEL;
  process.env.GOOGLE_GEMINI_MODERATION_MODEL = '';
  process.env.GOOGLE_MODERATION_VERTEX_MODEL = '';
  process.env.GOOGLE_MODERATION_MODEL = '';
  process.env.GOOGLE_GEMINI_4_ARGON_MODEL = 'gemini-4-argon-production';

  try {
    const normalized = normalizeGoogleModerationResponse({
      promptFeedback: {
        blockReason: 'PROHIBITED_CONTENT',
      },
    });

    assert.equal(normalized.model, 'gemini-4-argon-production');
    assert.deepEqual(
      buildModerationRequestBody('A harmless landscape').generationConfig.thinkingConfig,
      { thinkingLevel: 'LOW' },
    );
  } finally {
    if (previousModerationModel === undefined) {
      delete process.env.GOOGLE_GEMINI_MODERATION_MODEL;
    } else {
      process.env.GOOGLE_GEMINI_MODERATION_MODEL = previousModerationModel;
    }
    if (previousVertexModerationModel === undefined) {
      delete process.env.GOOGLE_MODERATION_VERTEX_MODEL;
    } else {
      process.env.GOOGLE_MODERATION_VERTEX_MODEL = previousVertexModerationModel;
    }
    if (previousGenericModerationModel === undefined) {
      delete process.env.GOOGLE_MODERATION_MODEL;
    } else {
      process.env.GOOGLE_MODERATION_MODEL = previousGenericModerationModel;
    }
    if (previousGemini31Model === undefined) {
      delete process.env.GOOGLE_GEMINI_4_ARGON_MODEL;
    } else {
      process.env.GOOGLE_GEMINI_4_ARGON_MODEL = previousGemini31Model;
    }
  }
});

test('getGoogleModerationCredentialOptions strips caller credentials in production', () => {
  const options = getGoogleModerationCredentialOptions({
    env: {
      CURRENT_ENV: 'production',
    },
    credentials: {
      client_email: 'user@example.com',
      project_id: 'user-project',
    },
    projectId: 'user-project',
    googleProjectId: 'user-google-project',
    google_credentials_json_b64: 'encoded-user-credentials',
    credentialsJsonB64: 'encoded-user-credentials',
    location: 'global',
    model: 'gemini-4-argon',
    timeoutMs: 1234,
  });

  assert.deepEqual(options, {
    location: 'global',
    model: 'gemini-4-argon',
    timeoutMs: 1234,
  });
});

test('getGoogleModerationCredentialOptions keeps runtime credentials outside production', () => {
  const credentials = {
    client_email: 'deployment@example.com',
    project_id: 'deployment-project',
  };
  const options = {
    env: {
      CURRENT_ENV: 'docker',
    },
    credentials,
    projectId: 'deployment-project',
    location: 'global',
  };

  assert.strictEqual(getGoogleModerationCredentialOptions(options), options);
});

test('getGoogleModerationCredentialOptions treats docker NODE_ENV production as non-production', () => {
  const options = {
    env: {
      CURRENT_ENV: 'docker',
      NODE_ENV: 'production',
    },
    credentials: {
      client_email: 'deployment@example.com',
    },
    projectId: 'deployment-project',
  };

  assert.strictEqual(getGoogleModerationCredentialOptions(options), options);
});
