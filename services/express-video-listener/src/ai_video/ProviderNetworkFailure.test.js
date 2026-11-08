import assert from 'node:assert/strict';
import test from 'node:test';
import VideoSession from '../schema/VideoSession.js';
import { buildProviderNetworkFailureGuard, getUnresolvedProviderNetworkFailure } from './ProviderNetworkFailure.js';

function activeSession(overrides = {}) {
  return {
    _id: 'session', expressGenerationPending: true,
    expressGenerationStatus: { lip_sync_generation: 'FAILED', audio_generation: 'PENDING' },
    providerNetworkFailure: {
      code: 'PROVIDER_NETWORK_RETRY_EXHAUSTED', message: 'Network recovery exhausted',
      stage: 'lip_sync_generation', layerId: 'current', requestId: 'generation', providerRequestId: 'accepted',
    },
    layers: [{ _id: 'current', lipSyncVideoGenerationStatus: 'FAILED', hasLipSyncVideoLayer: false }],
    audioLayers: [{ _id: 'speech', generationStatus: 'FAILED' }],
    ...overrides,
  };
}

test('terminal network markers resolve only to the current session target', () => {
  const session = activeSession();
  assert.equal(getUnresolvedProviderNetworkFailure(session)?.layer._id, 'current');
  session.providerNetworkFailure.layerId = 'original-source-layer';
  assert.equal(getUnresolvedProviderNetworkFailure(session), null);
});

test('completed usable media wins over a stale provider network marker', () => {
  const session = activeSession();
  Object.assign(session.layers[0], { lipSyncVideoGenerationStatus: 'COMPLETED', hasLipSyncVideoLayer: true, lipSyncRemoteLink: 'https://cdn.example/completed.mp4' });
  assert.equal(getUnresolvedProviderNetworkFailure(session), null);
  session.layers[0].lipSyncRemoteLink = '';
  assert.ok(getUnresolvedProviderNetworkFailure(session));
});

test('paused, cancelled, failed and inactive sessions never consume markers', () => {
  for (const override of [
    { expressGenerationPaused: true }, { expressGenerationCancelled: true },
    { expressGenerationFailed: true }, { expressGenerationPending: false },
  ]) assert.equal(getUnresolvedProviderNetworkFailure(activeSession(override)), null);
});

test('audio terminal markers resolve audioLayerId and preserve completed audio', () => {
  const session = activeSession();
  session.providerNetworkFailure = { code: 'PROVIDER_MEDIA_DOWNLOAD_FAILED', stage: 'audio_generation', audioLayerId: 'speech', requestId: 'audio-request' };
  const failure = getUnresolvedProviderNetworkFailure(session);
  assert.equal(failure.collection, 'audioLayers');
  const filter = buildProviderNetworkFailureGuard(session, failure);
  assert.equal(filter['providerNetworkFailure.audioLayerId'], 'speech');
  assert.equal(filter['providerNetworkFailure.layerId'], undefined);
  assert.equal(filter.audioLayers.$elemMatch.generationStatus, 'FAILED');
  assert.equal(filter['expressGenerationStatus.audio_generation'], 'PENDING');
  session.audioLayers[0].generationStatus = 'COMPLETED';
  session.audioLayers[0].localAudioLinks = ['/completed.wav'];
  assert.equal(getUnresolvedProviderNetworkFailure(session), null);
  session.providerNetworkFailure.audioLayerId = 'old-source-audio';
  assert.equal(getUnresolvedProviderNetworkFailure(session), null);
});

test('marker identity and current result fields protect late success and replacement work', () => {
  const session = activeSession();
  const filter = buildProviderNetworkFailureGuard(session, getUnresolvedProviderNetworkFailure(session));
  assert.equal(filter.expressGenerationPending, true);
  assert.deepEqual(filter.expressGenerationPaused, { $ne: true });
  assert.deepEqual(filter.expressGenerationCancelled, { $ne: true });
  assert.deepEqual(filter.expressGenerationFailed, { $ne: true });
  assert.equal(filter['providerNetworkFailure.requestId'], 'generation');
  assert.equal(filter['providerNetworkFailure.providerRequestId'], 'accepted');
  assert.deepEqual(filter.layers.$elemMatch.lipSyncVideoLayer, { $exists: false });
  assert.equal(filter.layers.$elemMatch.lipSyncVideoGenerationStatus, 'FAILED');
});

test('other current generation stages consume terminal markers without accepting arbitrary Mongo paths', () => {
  const session = activeSession({ expressGenerationStatus: { image_generation: 'FAILED' } });
  session.providerNetworkFailure.stage = 'image_generation';
  assert.ok(getUnresolvedProviderNetworkFailure(session));
  session.expressGenerationStatus.image_generation = 'COMPLETED';
  assert.equal(getUnresolvedProviderNetworkFailure(session), null);
  session.providerNetworkFailure.stage = 'image_generation.$bad';
  assert.equal(getUnresolvedProviderNetworkFailure(session), null);
});


test('hydrated Mongoose markers and unknown result fields retain control and completion guards', () => {
  const session = new VideoSession({
    expressGenerationPending: true,
    expressGenerationStatus: { lip_sync_generation: 'FAILED' },
    layers: [{ _id: '507f1f77bcf86cd799439011', lipSyncVideoGenerationStatus: 'FAILED' }],
  });
  session.set('providerNetworkFailure', { code: 'PROVIDER_NETWORK_RETRY_EXHAUSTED', stage: 'lip_sync_generation', layerId: '507f1f77bcf86cd799439011', requestId: 'accepted' });
  assert.equal(session.providerNetworkFailure, undefined);
  const failure = getUnresolvedProviderNetworkFailure(session);
  assert.ok(failure);
  const filter = buildProviderNetworkFailureGuard(session, failure);
  assert.equal(filter['providerNetworkFailure.requestId'], 'accepted');
  assert.deepEqual(filter.layers.$elemMatch.hasLipSyncVideoLayer, { $in: [false, null] });
  assert.doesNotThrow(() => VideoSession.findOne(filter).cast(VideoSession));
  session.set('expressGenerationPaused', true);
  assert.equal(getUnresolvedProviderNetworkFailure(session), null);
  session.set('expressGenerationPaused', false);
  session.layers[0].set({ lipSyncVideoGenerationStatus: 'COMPLETED', hasLipSyncVideoLayer: true, lipSyncRemoteLink: 'https://cdn.example/late.mp4' });
  assert.equal(getUnresolvedProviderNetworkFailure(session), null);
});


test('hydrated absent audio arrays do not prevent consuming a terminal marker on legacy data', () => {
  const session = new VideoSession({
    expressGenerationPending: true,
    expressGenerationStatus: { audio_generation: 'FAILED' },
    audioLayers: [{ _id: '507f1f77bcf86cd799439012', generationStatus: 'FAILED' }],
  });
  session.set('providerNetworkFailure', { code: 'PROVIDER_NETWORK_RETRY_EXHAUSTED', stage: 'audio_generation', audioLayerId: '507f1f77bcf86cd799439012' });
  const filter = buildProviderNetworkFailureGuard(session, getUnresolvedProviderNetworkFailure(session));
  assert.deepEqual(filter.audioLayers.$elemMatch.localAudioLinks, { $in: [[], null] });
  assert.doesNotThrow(() => VideoSession.findOne(filter).cast(VideoSession));
});
