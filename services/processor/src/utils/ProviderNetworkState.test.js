import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { clearInheritedProviderNetworkFailure } from './ProviderNetworkState.js';

test('a new copied operation clears failure ownership while retaining media, provenance and the source record', () => {
  const original = { providerNetworkFailure: { requestId: 'old-request', providerRequestId: 'paid-provider-job' },
    layers: [{ _id: 'layer', lipSyncInfrastructureFailure: true, lipSyncVideoGenerationErrorCode: 'NETWORK_LIMIT',
      aiVideoLayer: '/existing-base.mp4', sourceSceneRef: { sceneIndex: 4 } }] };
  const before = structuredClone(original);
  const copy = structuredClone(original);
  clearInheritedProviderNetworkFailure(copy);
  assert.deepEqual(original, before);
  assert.equal(copy.providerNetworkFailure, null);
  assert.equal(copy.layers[0].lipSyncInfrastructureFailure, false);
  assert.equal(copy.layers[0].lipSyncVideoGenerationErrorCode, null);
  assert.equal(copy.layers[0].aiVideoLayer, '/existing-base.mp4');
  assert.deepEqual(copy.layers[0].sourceSceneRef, { sceneIndex: 4 });
});

test('reset metadata survives strict-false hydrated document serialization', () => {
  const schema = new mongoose.Schema({ layers: [new mongoose.Schema({}, { strict: false })] }, { strict: false });
  const Model = mongoose.models.ProviderNetworkStateTest || mongoose.model('ProviderNetworkStateTest', schema);
  const doc = Model.hydrate({ _id: new mongoose.Types.ObjectId(), providerNetworkFailure: { requestId: 'old' },
    layers: [{ _id: new mongoose.Types.ObjectId(), lipSyncInfrastructureFailure: true, lipSyncVideoGenerationErrorCode: 'OLD' }] });
  clearInheritedProviderNetworkFailure(doc);
  assert.equal(doc.toObject().providerNetworkFailure, null);
  assert.equal(doc.toObject().layers[0].lipSyncInfrastructureFailure, false);
});
