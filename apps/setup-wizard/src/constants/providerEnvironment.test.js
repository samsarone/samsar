import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getProviderEnvironmentReferencePlaceholder,
  parseEnvironmentVariableReference,
  resolveProviderEnvironmentReferences,
} from './providerEnvironment.js';

test('accepts Bash variable reference syntax', () => {
  assert.equal(parseEnvironmentVariableReference('$OPENAI_API_KEY'), 'OPENAI_API_KEY');
  assert.equal(parseEnvironmentVariableReference('${OPENAI_API_KEY}'), 'OPENAI_API_KEY');
  assert.equal(parseEnvironmentVariableReference('OPENAI_API_KEY'), null);
  assert.equal(parseEnvironmentVariableReference('$1INVALID'), null);
  assert.equal(parseEnvironmentVariableReference(''), '');
});

test('resolves only explicitly allowed provider environment variables', () => {
  const result = resolveProviderEnvironmentReferences({
    openaiApiKey: '$OPENAI_API_KEY',
    falApiKey: '${FAL_API_KEY}',
  }, {
    OPENAI_API_KEY: 'openai-secret',
    FAL_API_KEY: 'fal-secret',
  });

  assert.equal(result.credentials.openaiApiKey, 'openai-secret');
  assert.equal(result.credentials.falApiKey, 'fal-secret');
  assert.equal(result.credentials.samsarApiKey, '');
  assert.deepEqual(result.variableNames, {
    openaiApiKey: 'OPENAI_API_KEY',
    falApiKey: 'FAL_API_KEY',
  });
});

test('supports custom variables only when the launcher allowlists them', () => {
  assert.throws(
    () => resolveProviderEnvironmentReferences(
      { openaiApiKey: '$LIVE_DEMO_OPENAI_KEY' },
      { LIVE_DEMO_OPENAI_KEY: 'secret' },
    ),
    /SAMSAR_SETUP_PROVIDER_ENV_NAMES/,
  );

  const result = resolveProviderEnvironmentReferences(
    { openaiApiKey: '$LIVE_DEMO_OPENAI_KEY' },
    { LIVE_DEMO_OPENAI_KEY: 'secret' },
    { allowedVariableNames: ['LIVE_DEMO_OPENAI_KEY'] },
  );
  assert.equal(result.credentials.openaiApiKey, 'secret');
});

test('reports missing variables without exposing any credential value', () => {
  assert.throws(
    () => resolveProviderEnvironmentReferences({ openaiApiKey: '$OPENAI_API_KEY' }, {}),
    /\$OPENAI_API_KEY is not set or is empty/,
  );
  assert.equal(getProviderEnvironmentReferencePlaceholder('googleCredentialsJson'), '$GOOGLE_APPLICATION_CREDENTIALS_JSON_B64');
});
