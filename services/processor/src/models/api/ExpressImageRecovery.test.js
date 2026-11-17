import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExpressImageRecovery } from './ExpressImageRecovery.js';

function session() {
  return { _id: 'session', userId: 'owner', expressGenerationImageModel: 'SEEDREAM', aspectRatio: '16:9',
    expressGenerationFailed: true, expressGenerationStatus: { prompt_generation: 'COMPLETED', image_generation: 'FAILED',
      speech_generation: 'COMPLETED', music_generation: 'COMPLETED' },
    hostedAgentBilling: { revision: 3, controlRevision: 2 },
    layers: Array.from({ length: 8 }, (_, i) => ({ _id: `scene-${i + 1}`,
      originalImageGenerationPrompt: i === 7 ? undefined : `Canonical scene ${i + 1}`,
      prompt: `Mutable retry ${i + 1}`,
      sourceSceneRef: { version: 1, sourceSessionId: 'source', sceneIndex: i, scene: { visual: `Source scene ${i + 1}` } },
      imageSession: { generationStatus: [0, 1, 7].includes(i) ? 'COMPLETED' : i === 4 ? 'FAILED' : 'PENDING',
        activeGeneratedImage: i < 2 ? `accepted-${i}.png` : '', generationError: i > 1 ? 'Old error' : null } })) };
}

test('failed image recovery rebuilds only unfinished scenes using canonical prompts and identity', () => {
  const s = session(), before = structuredClone(s);
  const plan = buildExpressImageRecovery(s, { recoveryId: 'repair', now: new Date(0) });
  assert.deepEqual(plan.recovery.jobs.map(j => j.layerId), ['scene-3', 'scene-4', 'scene-5', 'scene-6', 'scene-7']);
  assert.deepEqual(plan.recovery.jobs.map(j => j.prompt), Array.from({ length: 5 }, (_, i) => `Canonical scene ${i + 3}`));
  for (const job of plan.recovery.jobs) {
    assert.equal(job.imageBillingPolicy, 'pipeline'); assert.equal(job.model, 'SEEDREAM');
    assert.equal(job.generationRetryCount, 0); assert.equal(job.apiGenerationStatus, 'INIT');
    assert.equal(job.sourceSceneRef.sourceSessionId, 'source');
  }
  assert.deepEqual(s, before, 'building a recovery never changes session data');
  assert.equal(plan.layerFields['layers.0.imageSession.generationStatus'], undefined);
  assert.equal(plan.layerFields['layers.7.imageSession.generationStatus'], undefined);
  assert.equal(plan.layerFields['layers.4.imageSession.generationStatus'], 'PENDING');
  assert.equal(plan.recovery.failedBillingRevision, 3);
  assert.equal(plan.recovery.controlRevision, 3);
  assert.equal(new Set(plan.recovery.jobs.map(j => j._id)).size, 5);
  assert.deepEqual(buildExpressImageRecovery(s, { recoveryId: 'repair' }).recovery.jobs.map(j => j._id), plan.recovery.jobs.map(j => j._id));
});

test('funding retry reuses the durable recovery plan even when image queues were deleted', () => {
  const s = session(); s.expressImageRecovery = buildExpressImageRecovery(s, { recoveryId: 'repair' }).recovery;
  s.expressGenerationStatus.image_generation = 'PENDING';
  s.hostedAgentBilling.controlRevision = 3;
  s.hostedAgentBilling.state = 'FAILED';
  s.hostedAgentBilling.revision = 4; // A rejected funding intent advanced the durable wallet operation.
  const again = buildExpressImageRecovery(s);
  assert.equal(again.recovery.id, 'repair');
  assert.equal(again.recovery.controlRevision, 4);
  assert.equal(again.recovery.failedBillingRevision, 4);
  assert.deepEqual(again.recovery.jobs, s.expressImageRecovery.jobs);
  assert.deepEqual(again.layerFields, {});
});

test('recovery does not silently regenerate completed assets or accept unrelated failures', () => {
  const s = session(); s.layers[4].imageSession.activeSelectedImage = 'accepted-existing.png';
  const plan = buildExpressImageRecovery(s);
  assert.equal(plan.recovery.jobs.some(j => j.layerId === 'scene-5'), false);
  assert.equal(plan.layerFields['layers.4.imageSession.generationStatus'], 'COMPLETED');
  s.expressGenerationStatus.image_generation = 'COMPLETED';
  assert.equal(buildExpressImageRecovery(s), null);
  s.expressGenerationStatus.image_generation = 'FAILED';
  s.videoLink = 'final.mp4';
  assert.equal(buildExpressImageRecovery(s), null);
});

for (const completedVideo of [
  { aiVideoGenerationStatus: 'COMPLETED' },
  { aiVideoGenerationStatus: 'INIT', aiVideoLayer: 'already-rendered.mp4', hasAiVideoLayer: false },
  { aiVideoGenerationStatus: 'INIT', aiVideoRemoteLink: 'https://media.example/already-rendered.mp4' },
]) {
  test(`completed video evidence preserves the scene without another image request: ${Object.keys(completedVideo).join(',')}`, () => {
    const s = session(); Object.assign(s.layers[4], completedVideo);
    s.layers[4].filterPasses = [{ score: 64, src: 'retained-candidate.png' }];
    const before = structuredClone(s.layers[4]);
    const plan = buildExpressImageRecovery(s);
    assert.equal(plan.recovery.jobs.some(job => job.layerId === 'scene-5'), false);
    assert.equal(plan.layerFields['layers.4.imageSession.generationStatus'], 'COMPLETED');
    assert.deepEqual(s.layers[4], before);
  });
}

test('the AI-video enable flag alone never accepts an unfinished image or rejected candidate', () => {
  const s = session(); s.layers[4].hasAiVideoLayer = true;
  s.layers[4].aiVideoGenerationStatus = 'INIT';
  s.layers[4].filterPasses = [{ score: 46, src: 'rejected-candidate.png' }];
  const plan = buildExpressImageRecovery(s);
  assert.equal(plan.recovery.jobs.some(job => job.layerId === 'scene-5'), true);
  assert.equal(plan.layerFields['layers.4.imageSession.generationStatus'], 'PENDING');
  assert.deepEqual(s.layers[4].filterPasses, [{ score: 46, src: 'rejected-candidate.png' }]);
});

test('selected base images are preserved while overlays and rejected filter candidates do not satisfy image readiness', () => {
  const s = session();
  s.layers[2].imageSession.activeItemList = [{ type: 'image', is_base_image: true, src: 'accepted-base.png' }];
  s.layers[3].imageSession.activeItemList = [{ type: 'image', src: 'overlay-logo.png' }];
  s.layers[4].imageSession.activeItemList = [{ type: 'image', is_base_image: true, src: ' ' }];
  s.layers[4].filterPasses = [{ score: 46, src: 'rejected-candidate.png' }];
  const plan = buildExpressImageRecovery(s);
  assert.equal(plan.recovery.jobs.some(job => job.layerId === 'scene-3'), false);
  assert.equal(plan.layerFields['layers.2.imageSession.generationStatus'], 'COMPLETED');
  assert.equal(plan.recovery.jobs.some(job => job.layerId === 'scene-4'), true);
  assert.equal(plan.recovery.jobs.some(job => job.layerId === 'scene-5'), true);
});
