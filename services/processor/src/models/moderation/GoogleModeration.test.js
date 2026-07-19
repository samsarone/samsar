import assert from 'node:assert/strict';
import test from 'node:test';

const {
  buildGoogleModerationInferenceReceipt,
  extractGeminiModerationPayload,
  getGoogleModerationCredentialOptions,
  normalizeGeminiModerationPayload,
  normalizeGoogleModerationResponse,
} = await import('./GoogleModeration.js');

test('buildGoogleModerationInferenceReceipt exposes every paid Vertex token counter', () => {
  const usageMetadata = {
    promptTokenCount: 120,
    candidatesTokenCount: 18,
    thoughtsTokenCount: 7,
    cachedContentTokenCount: 20,
  };

  assert.deepEqual(buildGoogleModerationInferenceReceipt({
    modelVersion: 'gemini-3.1-pro-preview-20260701',
    usageMetadata,
  }, { model: 'gemini-3.1-pro-preview', attempt: 3 }), {
    stage: 'moderation',
    attempt: 3,
    model: 'gemini-3.1-pro-preview-20260701',
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
  }, { model: 'gemini-3.1-pro-preview' }), {
    model: 'gemini-3.1-pro-preview',
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
  }, { model: 'gemini-3.1-pro-preview' });

  assert.equal(normalized.results[0].flagged, true);
  assert.equal(normalized.results[0].categories.prohibited_content, true);
  assert.equal(normalized.results[0].category_scores.prohibited_content, 1);
  assert.equal(normalized.google.promptFeedback.blockReason, 'PROHIBITED_CONTENT');
});

test('normalizeGoogleModerationResponse includes Gemini response metadata', () => {
  const normalized = normalizeGoogleModerationResponse({
    responseId: 'response-id',
    modelVersion: 'gemini-3.1-pro-preview',
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
  }, { model: 'gemini-3.1-pro-preview' });

  assert.equal(normalized.results[0].flagged, false);
  assert.deepEqual(normalized.results[0].categories, {});
  assert.equal(normalized.google.finishReason, 'STOP');
  assert.equal(normalized.google.responseId, 'response-id');
  assert.equal(normalized.google.modelVersion, 'gemini-3.1-pro-preview');
});

test('normalizeGoogleModerationResponse uses Gemini inference model override by default', () => {
  const previousModerationModel = process.env.GOOGLE_GEMINI_MODERATION_MODEL;
  const previousVertexModerationModel = process.env.GOOGLE_MODERATION_VERTEX_MODEL;
  const previousGenericModerationModel = process.env.GOOGLE_MODERATION_MODEL;
  const previousGemini31Model = process.env.GOOGLE_GEMINI_31_PRO_MODEL;
  process.env.GOOGLE_GEMINI_MODERATION_MODEL = '';
  process.env.GOOGLE_MODERATION_VERTEX_MODEL = '';
  process.env.GOOGLE_MODERATION_MODEL = '';
  process.env.GOOGLE_GEMINI_31_PRO_MODEL = 'gemini-3.1-pro-production';

  try {
    const normalized = normalizeGoogleModerationResponse({
      promptFeedback: {
        blockReason: 'PROHIBITED_CONTENT',
      },
    });

    assert.equal(normalized.model, 'gemini-3.1-pro-production');
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
      delete process.env.GOOGLE_GEMINI_31_PRO_MODEL;
    } else {
      process.env.GOOGLE_GEMINI_31_PRO_MODEL = previousGemini31Model;
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
    model: 'gemini-3.1-pro-preview',
    timeoutMs: 1234,
  });

  assert.deepEqual(options, {
    location: 'global',
    model: 'gemini-3.1-pro-preview',
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
