import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyEffectiveGmiCloudProviderConfig,
  buildGenBlazeServiceEnvironment,
  isGmiCloudCredentialValidationCurrent,
  readEnvironmentValue,
  serializeEnvironment,
} from './genblaze-runtime-config.mjs';
import { buildGmiCloudCredentialFingerprint } from '../apps/setup-wizard/gmiCloudValidation.mjs';

test('enables GMICloud only when configuration and its secret agree', () => {
  const enabled = applyEffectiveGmiCloudProviderConfig(
    { gmicloud: { enabled: true } },
    { apiKey: 'gmi-secret' },
  );
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.providers.gmicloud.enabled, true);
  assert.equal(enabled.providers.gmicloud.apiKey, undefined);

  const missingSecret = applyEffectiveGmiCloudProviderConfig({
    gmicloud: { enabled: true },
  });
  assert.equal(missingSecret.enabled, false);
  assert.equal(missingSecret.providers.gmicloud.enabled, false);
});

test('puts the GMI key only in the dedicated GenBlaze environment', () => {
  const environment = buildGenBlazeServiceEnvironment({
    apiKey: 'gmi-secret',
    chatBaseUrl: 'https://chat.example/v1',
    jobTokenSecret: 'stable-job-token-secret',
  });
  const serialized = serializeEnvironment(environment);

  assert.match(serialized, /^GMI_API_KEY=gmi-secret$/m);
  assert.match(serialized, /^GMI_CHAT_BASE_URL=https:\/\/chat\.example\/v1$/m);
  assert.match(serialized, /^GMI_BASE_URL=$/m);
  assert.match(serialized, /^GENBLAZE_JOB_TOKEN_SECRET=stable-job-token-secret$/m);
  assert.equal(
    readEnvironmentValue(serialized, 'GENBLAZE_JOB_TOKEN_SECRET'),
    'stable-job-token-secret',
  );
});

test('accepts only the API key fingerprint produced by setup validation', () => {
  const apiKey = 'validated-gmi-key';
  const credentialFingerprint = buildGmiCloudCredentialFingerprint(apiKey);

  assert.equal(isGmiCloudCredentialValidationCurrent({ apiKey, credentialFingerprint }), true);
  assert.equal(isGmiCloudCredentialValidationCurrent({
    apiKey: 'rotated-without-validation',
    credentialFingerprint,
  }), false);
  assert.equal(isGmiCloudCredentialValidationCurrent({ apiKey }), false);
});
