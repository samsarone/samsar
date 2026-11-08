import assert from 'node:assert/strict';
import test from 'node:test';
import VideoSession from '../schema/VideoSession.js';
import User from '../schema/User.js';
import { createGenerativeVideoAnimationsForFrames } from './AIVideoGenerator.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup(t, concurrency = 2) {
  const previous = process.env.EXPRESS_AI_VIDEO_PROMPT_CONCURRENCY;
  process.env.EXPRESS_AI_VIDEO_PROMPT_CONCURRENCY = String(concurrency);
  t.after(() => {
    if (previous === undefined) delete process.env.EXPRESS_AI_VIDEO_PROMPT_CONCURRENCY;
    else process.env.EXPRESS_AI_VIDEO_PROMPT_CONCURRENCY = previous;
  });
  const state = {
    _id: 'session', userId: 'user', isExpressGeneration: true,
    expressGenerationPending: true, expressGenerativeVideoModel: 'KLINGIMGTOVID4',
    expressGenerationInferenceModel: 'gpt-6-astra', aspectRatio: '16:9', framesPerSecond: 24,
    layers: [0, 1, 2].map(index => ({
      _id: `layer-${index}`, layerAiVideoType: 'narration', duration: 5,
      aiVideoGenerationStatus: 'INIT', prompt: `scene-${index}`,
      activeImageDescription: `description-${index}`,
      sourceSceneIndex: index,
      imageSession: { activeGeneratedImage: `image-${index}.png` },
    })),
    audioLayers: [{ generationType: 'speech', connectedLayerId: 'layer-0', duration: 7 }],
  };
  const prompts = [deferred(), deferred(), deferred()];
  const camera = deferred();
  const events = [], queued = [];
  t.mock.method(VideoSession, 'findById', async () => structuredClone(state));
  t.mock.method(User, 'findById', async () => ({ selectedInferenceModel: 'gpt-6-astra' }));
  const operations = {
    getDBConnectionString: async () => {},
    getTransitionListForLayerSceneDescriptions: async descriptions => {
      assert.deepEqual(descriptions, ['description-0', 'description-1', 'description-2']);
      events.push('camera');
      await camera.promise;
      return 'camera-0\ncamera-1\ncamera-2';
    },
    createTextToVideoPromptFromStartingLayerPrompt: async (prompt, description, _model, _short, _speaker, indexData, _tone, transition) => {
      const index = Number(prompt.slice(-1));
      assert.equal(description, `description-${index}`);
      assert.equal(transition, `camera-${index}`);
      assert.equal(indexData.isStartScene, index === 0);
      assert.equal(indexData.isEndScene, index === 2);
      events.push(`prepare:${index}`);
      return prompts[index].promise;
    },
    updateLayerAiVideoGenerationPrompt: async (_session, layer, prompt) => {
      events.push(`persist:${layer}:${prompt}`);
    },
    setSessionLayerAiVideoGenerationPending: async payload => {
      events.push(`retime:${payload.layerId}`);
      const layer = state.layers.find(layer => layer._id === payload.layerId);
      layer.aiVideoGenerationStatus = 'PENDING';
      layer.aiVideoGenerationPending = true;
      return state;
    },
    dispatchAiVideo: async payload => {
      events.push(`queue:${payload.layerId}`);
      queued.push(payload);
    },
  };
  return { state, prompts, camera, events, queued, operations,
    run: () => createGenerativeVideoAnimationsForFrames('session', operations) };
}

test('real AI-video preparation preserves camera context, duration and ordered dispatch while prompts overlap', async t => {
  const f = setup(t);
  const task = f.run();
  await flush();
  assert.deepEqual(f.events, ['camera']);
  f.camera.resolve();
  await flush();
  assert.deepEqual(f.events, ['camera', 'prepare:0', 'prepare:1']);
  f.prompts[1].resolve('motion-1');
  await flush();
  assert.equal(f.queued.length, 0);
  f.prompts[0].resolve('motion-0');
  await flush();
  assert.deepEqual(f.queued.map(item => item.layerId), ['layer-0', 'layer-1']);
  assert.equal(f.queued[0].duration, 10); // Still fits the connected 7-second speech.
  assert.equal(f.queued[0].promptSeedContext.cameraTransition, 'camera-0');
  assert.equal(f.queued[1].sourceSceneIndex, 1);
  f.prompts[2].resolve('motion-2');
  await task;
  assert.deepEqual(f.queued.map(item => item.prompt), ['motion-0', 'motion-1', 'motion-2']);
  assert.deepEqual(f.events.filter(event => /^(retime|queue):/.test(event)), [
    'retime:layer-0', 'queue:layer-0', 'retime:layer-1', 'queue:layer-1', 'retime:layer-2', 'queue:layer-2',
  ]);
});

for (const field of ['expressGenerationPaused', 'expressGenerationCancelled', 'expressGenerationFailed']) {
  test(`${field} during model preparation prevents pending writes and dispatch`, async t => {
    const f = setup(t);
    const task = f.run();
    f.camera.resolve(); await flush();
    f.state[field] = true;
    f.prompts[0].resolve('motion-0'); f.prompts[1].resolve('motion-1');
    await task;
    assert.equal(f.queued.length, 0);
    assert.equal(f.events.some(event => event.startsWith('persist:')), false);
    assert.equal(f.events.includes('prepare:2'), false);
  });
}

test('completed and already queued layers are not regenerated on resume', async t => {
  const f = setup(t);
  f.state.layers[0].aiVideoGenerationStatus = 'COMPLETED';
  f.state.layers[0].aiVideoLayer = 'keep.mp4';
  f.state.layers[1].aiVideoGenerationStatus = 'PENDING';
  f.state.layers[1].aiVideoGenerationPending = true;
  const task = f.run();
  f.camera.resolve(); f.prompts[2].resolve('motion-2');
  await task;
  assert.deepEqual(f.events.filter(event => event.startsWith('prepare:')), ['prepare:2']);
  assert.deepEqual(f.queued.map(item => item.layerId), ['layer-2']);
  assert.equal(f.state.layers[0].aiVideoLayer, 'keep.mp4');
});

test('a layer completed during preparation is rechecked before dispatch', async t => {
  const f = setup(t);
  const task = f.run();
  f.camera.resolve(); await flush();
  f.state.layers[0].aiVideoGenerationStatus = 'COMPLETED';
  f.state.layers[0].aiVideoLayer = 'keep.mp4';
  for (let index = 0; index < 3; index++) f.prompts[index].resolve(`motion-${index}`);
  await task;
  assert.deepEqual(f.queued.map(item => item.layerId), ['layer-1', 'layer-2']);
});

test('failed prompt preparation preserves earlier queue work and leaves remaining layers retryable', async t => {
  const f = setup(t);
  const task = f.run();
  f.camera.resolve(); await flush();
  f.prompts[1].reject(new Error('inference unavailable'));
  f.prompts[0].resolve('motion-0');
  f.prompts[2].resolve('motion-2');
  await assert.rejects(task, /inference unavailable/);
  assert.deepEqual(f.queued.map(item => item.layerId), ['layer-0']);
  assert.equal(f.state.layers[1].aiVideoGenerationStatus, 'INIT');
  assert.equal(f.state.layers[2].aiVideoGenerationStatus, 'INIT');
});
