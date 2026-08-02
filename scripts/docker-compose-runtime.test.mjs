import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ALL_RUNTIME_COMPOSE_PROFILES,
  getRuntimeComposeProfiles,
} from './docker-compose-runtime.mjs';

test('enables the GenBlaze profile only for an enabled GMICloud service', () => {
  const disabled = getRuntimeComposeProfiles({
    providers: { gmicloud: { enabled: false } },
    services: { genblaze: false },
  });
  assert.equal(disabled.includes('genblaze'), false);

  const enabled = getRuntimeComposeProfiles({
    providers: { gmicloud: { enabled: true } },
    services: { genblaze: true },
  });
  assert.equal(enabled.includes('genblaze'), true);
});

test('includes GenBlaze in all-profile cleanup without enabling it by default', () => {
  assert.equal(ALL_RUNTIME_COMPOSE_PROFILES.includes('genblaze'), true);
  assert.equal(getRuntimeComposeProfiles({}).includes('genblaze'), false);
});

test('runtime profile selection rejects a stale or missing rendered GMI catalog', () => {
  const fingerprint = 'a'.repeat(64);
  const config = {
    providers: { gmicloud: { enabled: true, credentialFingerprint: fingerprint } },
    services: { genblaze: true },
  };

  assert.equal(getRuntimeComposeProfiles(config, {
    genBlazeCatalog: {
      version: 1,
      provider: 'gmicloud',
      credentialFingerprint: fingerprint,
      models: {},
    },
  }).includes('genblaze'), true);
  assert.equal(getRuntimeComposeProfiles(config, {
    genBlazeCatalog: {
      version: 1,
      provider: 'gmicloud',
      credentialFingerprint: 'b'.repeat(64),
      models: {},
    },
  }).includes('genblaze'), false);
  assert.equal(getRuntimeComposeProfiles(config, { genBlazeCatalog: null }).includes('genblaze'), false);
});
