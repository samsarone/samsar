import assert from 'node:assert/strict';
import test from 'node:test';
import { __testOnly__, getTranslateVideoBillingPreview, translateVideoSessionAndQueueGeneration } from './VideoSessionTranslateAPI.js';
import mongoose from 'mongoose';
import User from '../../schema/User.js';
import VideoSession from '../../schema/VideoSession.js';
import AudioGeneration from '../../schema/AudioGeneration.js';

function mockSession(t, preferences = {}) {
  const source = {
    _id: 'source-session', userId: 'owner', inferenceModel: 'gpt-6-astra',
    totalDuration: 5, aspectRatio: '16:9',
    movieResourceList: {
      scenes: [{ visual: 'A speaker', duration: 5 }],
      sounds: [{ type: 'speech', sceneIndex: 0, duration: 5, audio: 'Hello.' }],
    },
    layers: [{ _id: 'scene', duration: 5, durationOffset: 0,
      imageSession: { activeItemList: [] }, addFooterAnimation: true,
      footerMetadata: { title: 'Learn more', ctaText: 'Learn more' } }],
    audioLayers: [{ _id: 'audio', generationType: 'speech', connectedLayerId: 'scene',
      connectedLayerIndex: 0, prompt: 'Hello.', speakerCharacterName: 'Narrator',
      duration: 5, startTime: 0, endTime: 5 }],
    outroImageMetadata: { topText: 'Welcome', bottomText: 'Visit us' },
  };
  t.mock.method(mongoose, 'connect', async () => mongoose);
  t.mock.method(User, 'findById', (userId) => {
    assert.equal(userId, 'owner');
    return { select: () => ({ lean: async () => preferences }) };
  });
  t.mock.method(VideoSession, 'findOne', async (query) => {
    assert.deepEqual(query, { _id: 'source-session', userId: 'owner' });
    return { toObject: () => structuredClone(source) };
  });
  return source;
}

test('translation uses current user model and effort rather than the source session model', async (t) => {
  mockSession(t, { selectedInferenceModel: 'claude-fable-5.1', selectedInferenceEffort: 'xhigh' });
  const preview = await getTranslateVideoBillingPreview('owner', { session_id: 'source-session', language: 'FR' });
  assert.equal(preview.inferenceModel, 'claude-fable-5.1-xhigh');
  assert.equal(preview.inferenceEffort, 'xhigh');
});

test('translation request selection overrides saved settings for every supported model family', async (t) => {
  mockSession(t, { selectedInferenceModel: 'gpt-6-astra', selectedInferenceEffort: 'high' });
  for (const model of ['gpt-6-astra', 'gpt-6.1-sol', 'claude-opus-5.5', 'claude-fable-5.1']) {
    for (const effort of ['high', 'xhigh']) {
      const preview = await getTranslateVideoBillingPreview('owner', {
        session_id: 'source-session', language: 'FR', inference_model: model, effort,
      });
      assert.equal(preview.inferenceModel, `${model}${effort === 'xhigh' ? '-xhigh' : ''}`);
      assert.equal(preview.inferenceEffort, effort);
    }
  }
  for (const model of ['gemini-4-argon', 'kimi-k3', 'QWEN3.8']) {
    const preview = await getTranslateVideoBillingPreview('owner', {
      session_id: 'source-session', language: 'FR', inferenceModel: model,
    });
    assert.equal(preview.inferenceModel, model);
    assert.equal(preview.inferenceEffort, null);
  }
});

test('translation validates model and effort overrides before generation', async (t) => {
  mockSession(t);
  for (const overrides of [
    { inference_model: 'not-a-model' },
    { inference_model: 'claude-fable-5.1', effort: 'invalid' },
    { inference_model: 'gemini-4-argon', effort: 'xhigh' },
  ]) {
    await assert.rejects(getTranslateVideoBillingPreview('owner', {
      session_id: 'source-session', language: 'FR', ...overrides,
    }), { status: 400 });
  }
});

test('translation without subtitles does not require OpenAI credentials, but subtitles still do', async (t) => {
  mockSession(t, { selectedInferenceModel: 'claude-fable-5.1', selectedInferenceEffort: 'high' });
  const overrides = { SAMSAR_DEPLOYMENT_EDITION: 'standalone', OPENAI_API_KEY: '', SAMSAR_API_KEY: '' };
  const previous = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
  Object.assign(process.env, overrides);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const reachedCreation = new Error('Reached session creation without a subtitle provider');
  const create = t.mock.method(VideoSession, 'create', async () => { throw reachedCreation; });
  const payload = { session_id: 'source-session', language: 'FR', skipCreditDeduction: true };
  await assert.rejects(translateVideoSessionAndQueueGeneration('owner', {
    ...payload, enable_subtitles: true,
  }), { code: 'SUBTITLE_PROVIDER_NOT_CONFIGURED' });
  assert.equal(create.mock.callCount(), 0);
  await assert.rejects(translateVideoSessionAndQueueGeneration('owner', {
    ...payload, enable_subtitles: false,
  }), (error) => error === reachedCreation);
  assert.equal(create.mock.callCount(), 1);
});

test('translation job keeps selected inference settings for speech, speakers, overlays and the cloned session', async (t) => {
  const source = mockSession(t, { selectedInferenceModel: 'claude-fable-5.1', selectedInferenceEffort: 'xhigh' });
  const original = structuredClone(source);
  const preview = await getTranslateVideoBillingPreview('owner', { session_id: 'source-session', language: 'FR' });
  const requests = [];
  const queued = [];
  let saved;
  t.mock.method(VideoSession, 'updateOne', async (_query, update) => { saved = update.$set; });
  t.mock.method(AudioGeneration.prototype, 'save', async function () { queued.push(this.toObject()); });
  await __testOnly__.processTranslateVideoSessionJob({
    ...preview, userId: 'owner', newSessionId: 'translated-session',
  }, {
    copyTranslateSessionAssets: async () => {},
    translateTextContent: async (texts, language, model, options) => {
      requests.push({ texts, language, model, options });
      return texts.map((text) => `Translated ${text}`);
    },
  });
  assert.deepEqual(requests.map(({ texts }) => texts), [
    ['Hello.'], ['Narrator'], ['Welcome'], ['Visit us'], ['Learn more'],
  ]);
  for (const request of requests) {
    assert.equal(request.language, 'French');
    assert.equal(request.model, 'claude-fable-5.1-xhigh');
    assert.equal(request.options.reasoningEffort, 'xhigh');
  }
  assert.equal(saved.inferenceModel, 'claude-fable-5.1-xhigh');
  assert.equal(saved.expressGenerationInferenceModel, saved.inferenceModel);
  assert.equal(saved.inferenceEffort, 'xhigh');
  assert.equal(saved.expressGenerationInferenceEffort, 'xhigh');
  assert.equal(queued.length, 1);
  assert.equal(queued[0].prompt, 'Translated Hello.');
  assert.deepEqual(source, original);
});

test('batch fallback reuses the supplied translator and keeps speech ordering', async () => {
  const calls = [];
  const translated = await __testOnly__.translateSpeechTextList(
    ['First', '', 'Second'], 'French', async (texts, language) => {
      calls.push({ texts, language });
      return texts.length > 1 ? ['bad batch count'] : [`French ${texts[0]}`];
    },
  );
  assert.deepEqual(translated, ['French First', '', 'French Second']);
  assert.deepEqual(calls.map(({ texts }) => texts), [['First', 'Second'], ['First'], ['Second']]);
  assert.ok(calls.every(({ language }) => language === 'French'));
});

test('every translation batch uses the selected translator', async () => {
  const texts = Array.from({ length: 13 }, (_, index) => `Line ${index}`);
  const batches = [];
  const result = await __testOnly__.translateSpeechTextList(texts, 'French', async (batch) => {
    batches.push(batch.length);
    return batch.map((text) => `French ${text}`);
  });
  assert.deepEqual(batches, [12, 1]);
  assert.deepEqual(result, texts.map((text) => `French ${text}`));
});
