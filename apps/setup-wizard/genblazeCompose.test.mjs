import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GENBLAZE_FINAL_UP_ARGS,
  hasValidatedGenBlazeRuntimeCatalog,
  splitGenBlazeComposeProfiles,
} from './genblazeCompose.mjs';

test('plans GenBlaze outside the primary Compose stage', () => {
  assert.deepEqual(splitGenBlazeComposeProfiles(['core', 'workers', 'genblaze']), {
    enabled: true,
    primaryProfiles: ['core', 'workers'],
  });
  assert.deepEqual(GENBLAZE_FINAL_UP_ARGS, [
    'up', '-d', '--build', '--no-deps', 'genblaze',
  ]);
});

test('does not invent a GenBlaze stage when its profile is absent', () => {
  assert.deepEqual(splitGenBlazeComposeProfiles(['core']), {
    enabled: false,
    primaryProfiles: ['core'],
  });
});

test('requires the rendered catalog to match the setup validation fingerprint', () => {
  const fingerprint = 'a'.repeat(64);
  const config = {
    providers: {
      gmicloud: { credentialFingerprint: fingerprint },
    },
  };

  assert.equal(hasValidatedGenBlazeRuntimeCatalog(config, {
    version: 1,
    provider: 'gmicloud',
    credentialFingerprint: fingerprint,
    models: {},
  }), true);
  assert.equal(hasValidatedGenBlazeRuntimeCatalog(config, {
    version: 1,
    provider: 'gmicloud',
    credentialFingerprint: 'b'.repeat(64),
    models: {},
  }), false);
  assert.equal(hasValidatedGenBlazeRuntimeCatalog(config, null), false);
});
