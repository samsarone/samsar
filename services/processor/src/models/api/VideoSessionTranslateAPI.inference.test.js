import assert from 'node:assert/strict';
import test from 'node:test';
import { __testOnly__, getTranslateVideoBillingPreview, translateVideoSessionAndQueueGeneration } from './VideoSessionTranslateAPI.js';
import mongoose from 'mongoose';
import User from '../../schema/User.js';
import VideoSession from '../../schema/VideoSession.js';
import AudioGeneration from '../../schema/AudioGeneration.js';
import { rewriteNarrativeSpeechItemToFitScene } from '../agent/MovieCreatorAgent.js';

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

test('translation validates and repairs before queuing TTS, saving the same accepted text and metadata', async (t) => {
  const source = mockSession(t);
  const before = structuredClone(source);
  let saved;
  const queued = [];
  const events = [];
  t.mock.method(VideoSession, 'updateOne', async (_query, update) => { saved = update.$set; });
  t.mock.method(AudioGeneration.prototype, 'save', async function () { events.push('TTS'); queued.push(this.toObject()); });
  await __testOnly__.processTranslateVideoSessionJob({
    oldSessionId: 'source-session', userId: 'owner', newSessionId: 'translated',
    normalizedLanguageCode: 'FR', inferenceModel: 'claude-fable-5.1', inferenceEffort: 'xhigh',
    enableSubtitles: true,
  }, {
    copyTranslateSessionAssets: async () => { events.push('copy'); },
    translateTextContent: async (texts) => texts.map((text) => text === 'Hello.' ? 'x'.repeat(29) : 'Narrateur'),
    rewriteSpeechItem: async (request) => {
      events.push('repair');
      assert.equal(request.maxCharacters, 28); // 5s French: 22 prompt characters + 30% tolerance.
      assert.equal(request.options.reasoningEffort, 'xhigh');
      assert.equal(request.options.translationContext.originalText, 'Hello.');
      request.options.onRepairAttempt(1);
      return 'Bonjour.';
    },
  });
  assert.deepEqual(events, ['repair', 'copy', 'TTS']);
  const speech = saved.audioLayers[0];
  assert.equal(speech.prompt, 'Bonjour.');
  assert.equal(speech.speechText, 'Bonjour.');
  assert.equal(speech.transcriptText, 'Bonjour.');
  assert.equal(queued[0].prompt, 'Bonjour.');
  assert.equal(queued[0].generationMeta.translationValidation.maxCharacters, 28);
  assert.equal(speech.generationMeta.translationValidation.attempts, 1);
  assert.equal(speech.addSubtitles, true);
  assert.deepEqual(source, before);
});

test('exhausted speech repair queues no TTS jobs, even when an earlier item passed validation', async (t) => {
  const source = mockSession(t);
  source.layers.push({ ...structuredClone(source.layers[0]), _id: 'scene2', durationOffset: 5 });
  source.movieResourceList.scenes.push({ duration: 5, visual: 'Another speaker' });
  source.movieResourceList.sounds.push({ type: 'speech', sceneIndex: 1, duration: 5, audio: 'Goodbye.' });
  source.audioLayers.push({ ...structuredClone(source.audioLayers[0]), _id: 'audio2',
    connectedLayerId: 'scene2', connectedLayerIndex: 1, prompt: 'Goodbye.', startTime: 5, endTime: 10 });
  const queued = t.mock.method(AudioGeneration.prototype, 'save', async () => {});
  const saved = t.mock.method(VideoSession, 'updateOne', async () => {});
  let attempts = 0;
  await assert.rejects(__testOnly__.processTranslateVideoSessionJob({
    oldSessionId: 'source-session', userId: 'owner', newSessionId: 'translated',
    normalizedLanguageCode: 'FR', inferenceModel: 'gpt-6-astra', inferenceEffort: 'high',
  }, {
    copyTranslateSessionAssets: async () => assert.fail('Do not copy assets after failed validation'),
    translateTextContent: async (texts) => texts.map((text) => text === 'Goodbye.' ? 'x'.repeat(29) : 'Bonjour.'),
    rewriteSpeechItem: (request) => rewriteNarrativeSpeechItemToFitScene({
      ...request, options: { ...request.options, dependencies: {
        openaiClient: {}, sleep: async () => {},
        createCompatibleChatCompletion: async () => {
          attempts += 1;
          return { choices: [{ message: { content: 'x'.repeat(29) } }] };
        },
      } },
    }),
  }), { code: 'TRANSLATED_SPEECH_VALIDATION_FAILED', attempts: 3, speechIndex: 1 });
  assert.equal(attempts, 3);
  assert.equal(queued.mock.callCount(), 0);
  assert.equal(saved.mock.callCount(), 0);
});

test('translation timing matches sounds by scene and preserves multiple speech offsets before validation', () => {
  const session = {
    movieResourceList: { scenes: [{ duration: 5 }, { duration: 10 }], sounds: [
      { type: 'speech', sceneIndex: 1, audio: 'First', duration: 3 },
      { type: 'speech', sceneIndex: 1, audio: 'Second', duration: 2.5 },
    ] },
    layers: [{ _id: 'silent', duration: 9, durationOffset: 0 }, { _id: 'speaking', duration: 12, durationOffset: 9 }],
    audioLayers: [
      { generationType: 'speech', connectedLayerId: 'speaking', connectedLayerIndex: 0, prompt: 'First', startTime: 9 },
      { generationType: 'speech', connectedLayerId: 'speaking', prompt: 'Second', startTime: 16.5 },
    ],
  };
  __testOnly__.resetTimelineDurationsFromMovieResourceList(session);
  assert.deepEqual(session.audioLayers.map(({ duration, startTime, endTime }) => ({ duration, startTime, endTime })), [
    { duration: 3, startTime: 5, endTime: 8 },
    { duration: 2.5, startTime: 12.5, endTime: 15 },
  ]);
  __testOnly__.prepareSessionForTranslate({ clonedSession: session, normalizedLanguageCode: 'FR', enableSubtitles: false });
  assert.equal(session.audioLayers[1].connectedLayerStartTimeOffset, 7.5);
});

test('translation timing uses the connected scene snapshot when joined source indexes overlap', () => {
  const session = {
    movieResourceList: { scenes: [{ duration: 10 }], sounds: [{ type: 'speech', sceneIndex: 0, duration: 10 }] },
    layers: [{ _id: 'joined', duration: 10, durationOffset: 0, sourceSceneRef: {
      sceneIndex: 0, sounds: [{ type: 'speech', sceneIndex: 0, duration: 2.5, audio: 'Hello' }],
    } }],
    audioLayers: [{ generationType: 'speech', connectedLayerId: 'joined', prompt: 'Hello', startTime: 0 }],
  };
  __testOnly__.resetTimelineDurationsFromMovieResourceList(session);
  assert.equal(session.audioLayers[0].duration, 2.5);
});
