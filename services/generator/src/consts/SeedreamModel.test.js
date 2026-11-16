import test from 'node:test';
import assert from 'node:assert/strict';
import { getSeedreamFalEndpoint, LEGACY_SEEDREAM_FAL_ENDPOINT, SEEDREAM_FAL_ENDPOINT } from './SeedreamModel.js';

test('new Seedream jobs use 5.5 while accepted unversioned jobs retain 5.0 affinity', () => {
  assert.equal(getSeedreamFalEndpoint({ apiGenerationStatus: 'INIT' }), SEEDREAM_FAL_ENDPOINT);
  assert.equal(getSeedreamFalEndpoint({ apiRequestId: 'old-accepted' }), LEGACY_SEEDREAM_FAL_ENDPOINT);
  assert.equal(getSeedreamFalEndpoint({ apiRequestId: 'new-accepted', seedreamFalEndpoint: SEEDREAM_FAL_ENDPOINT }), SEEDREAM_FAL_ENDPOINT);
});

test('a sealed Seedream retry retains its original model and cannot submit against a conflicting tariff', () => {
  const falImageBillingSnapshot = { model: 'SEEDREAM', endpoint: LEGACY_SEEDREAM_FAL_ENDPOINT };
  assert.equal(getSeedreamFalEndpoint({ apiGenerationStatus: 'INIT', falImageBillingSnapshot }), LEGACY_SEEDREAM_FAL_ENDPOINT);
  assert.throws(() => getSeedreamFalEndpoint({ falImageBillingSnapshot, seedreamFalEndpoint: SEEDREAM_FAL_ENDPOINT }), /conflicts/);
  assert.throws(() => getSeedreamFalEndpoint({ seedreamFalEndpoint: 'unverified/seedream/endpoint' }), /unsupported/);
});
