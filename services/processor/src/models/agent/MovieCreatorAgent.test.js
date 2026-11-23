import assert from 'node:assert/strict';
import test from 'node:test';
import OpenAI from 'openai';

import {
  buildCharacterSpeakerMessage,
  extractGroundedThemeFromUserPrompt,
  extractThemeFromUserPromptAndImageTheme,
  rewriteNarrativeSpeechItemToFitScene,
  sendNarrativePromptMessageRequest,
} from './MovieCreatorAgent.js';
import { extractThemeForImageListAndPrompt } from '../movie_session/ad_creator/AdAgentPrompts.js';
import { extractNarrativeFromInputPayload } from '../movie_session/image_list_to_video/system/NarrativeBuilder.js';

for (const model of ['gpt-6.2-astra', 'gpt-6.1-sol', 'claude-opus-5.5', 'claude-fable-5.2']) {
  for (const effort of ['high', 'xhigh']) {
    test(`translated speech repair uses ${model}/${effort} and retains source meaning instructions across retries`, async () => {
      const requests = [];
      const attempts = [];
      const scene = { visual: 'Marie visits Paris.', duration: 10 };
      const speechItem = { type: 'speech', sceneIndex: 0, audio: 'x'.repeat(58) };
      const translationContext = {
        originalText: 'Marie will not leave Paris until 2027.',
        translatedText: speechItem.audio, targetLanguage: 'French', durationSeconds: 10,
        currentCharacters: 58, maxCharacters: 57,
      };
      const result = await rewriteNarrativeSpeechItemToFitScene({
        movieResourceList: { scenes: [scene], sounds: [speechItem] }, scene, speechItem,
        maxCharacters: 57, inferenceModel: model,
        options: {
          sceneIndex: 0, soundIndex: 0, translationContext, reasoningEffort: effort,
          onRepairAttempt: (attempt) => attempts.push(attempt),
          dependencies: { openaiClient: {}, sleep: async () => {},
            createCompatibleChatCompletion: async (_client, request) => {
              requests.push(request);
              const content = requests.length === 1 ? 'x'.repeat(58)
                : requests.length === 2 ? '{"audio":"Bonjour"}' : 'Marie ne quittera Paris qu’en 2027.';
              return { choices: [{ message: { content } }] };
            },
          },
        },
      });
      assert.equal(result, 'Marie ne quittera Paris qu’en 2027.');
      assert.deepEqual(attempts, [1, 2, 3]);
      requests.forEach((request) => {
        assert.equal(request.model, model);
        assert.equal(request.reasoning_effort, effort);
        assert.match(request.messages[0].content, /at most 57 Unicode characters/);
        assert.match(request.messages[0].content, /proper nouns/);
        assert.match(request.messages[0].content, /numbers, facts, negation/);
        assert.deepEqual(JSON.parse(request.messages[1].content).translationContext, translationContext);
      });
      const previous = JSON.parse(requests[1].messages[1].content).previousAttempt;
      assert.equal(previous.characterCount, 58);
      assert.equal(previous.maxCharacters, 57);
      assert.match(previous.validationError, /58 characters/);
      assert.match(JSON.parse(requests[2].messages[1].content).previousAttempt.validationError, /not JSON/);
    });
  }
}

test('translated speech repair rejects empty, multiline and Markdown responses within three attempts', async () => {
  const scene = { duration: 10 };
  const speechItem = { type: 'speech', sceneIndex: 0, audio: 'x'.repeat(58) };
  const outputs = ['', 'Bonjour.\nAu revoir.', '```text\nBonjour\n```'];
  let attempts = 0;
  await assert.rejects(rewriteNarrativeSpeechItemToFitScene({
    scene, speechItem, movieResourceList: { scenes: [scene], sounds: [speechItem] },
    maxCharacters: 57, inferenceModel: 'gpt-6.2-astra',
    options: {
      sceneIndex: 0, soundIndex: 0, maxAttempts: 99,
      translationContext: { targetLanguage: 'French', originalText: 'Hello' },
      dependencies: { openaiClient: {}, sleep: async () => {},
        createCompatibleChatCompletion: async () => ({ choices: [{ message: { content: outputs[attempts++] } }] }),
      },
    },
  }), /without Markdown/);
  assert.equal(attempts, 3);
});

test('Gemini translation repair waits for each request and reports private-safe diagnostics', async (t) => {
  const logs = [];
  const progress = [];
  t.mock.method(console, 'info', (...args) => logs.push(args));
  t.mock.method(console, 'warn', (...args) => logs.push(args));
  const requests = [];
  const releases = [];
  let active = 0;
  let maxActive = 0;
  const privateSpeech = 'Private source speech that must never appear in logs.';
  const scene = { visual: 'Private scene details.', duration: 10 };
  const speechItem = { type: 'speech', sceneIndex: 0, audio: 'x'.repeat(58) };
  const job = rewriteNarrativeSpeechItemToFitScene({
    movieResourceList: { scenes: [scene], sounds: [speechItem] }, scene, speechItem,
    maxCharacters: 57, inferenceModel: 'gemini-4-carbon',
    options: {
      sceneIndex: 0, soundIndex: 0, maxAttempts: 3,
      translationContext: { originalText: privateSpeech, targetLanguage: 'Thai', durationSeconds: 10 },
      externalRequestContext: { sessionId: 'session-1', requestKey: 'retranslation:speech-repair-4',
        speechIndex: 4, layerIndex: 7, speechCount: 8 },
      onProgress: async (event) => {
        progress.push(event);
        if (event.event === 'speech_repair_attempt_result') throw new Error(privateSpeech);
      },
      dependencies: { openaiClient: {}, sleep: async () => {},
        createCompatibleChatCompletion: async (_client, request) => {
          requests.push(request);
          active += 1;
          maxActive = Math.max(maxActive, active);
          try {
            return await new Promise((resolve) => releases.push(resolve));
          } finally { active -= 1; }
        },
      },
    },
  });
  await new Promise(setImmediate);
  assert.equal(requests.length, 1);
  assert.equal(active, 1);
  releases[0]({ id: 'provider-1', choices: [{ message: { content: '' }, finish_reason: 'content_filter' }],
    google_response: { promptFeedback: { blockReason: 'SAFETY', blockReasonMessage: privateSpeech,
      safetyRatings: [{ category: 'HARM_CATEGORY_DANGEROUS_CONTENT', probability: 'LOW', blocked: true,
        explanation: privateSpeech }] } } });
  await new Promise(setImmediate);
  assert.equal(requests.length, 2);
  assert.equal(active, 1);
  releases[1]({ id: 'provider-2', choices: [{ message: { content: 'Short.' }, finish_reason: 'stop' }] });
  assert.equal(await job, 'Short.');
  assert.equal(maxActive, 1);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].reasoning_effort, 'high');
  assert.equal(requests[0].timeout, 120000);
  assert.equal('max_tokens' in requests[0], false);
  assert.equal(progress[0].event, 'speech_repair_attempt_started');
  assert.equal(progress[0].speechIndex, 4);
  assert.equal(progress[0].layerIndex, 7);
  assert.equal(progress[0].requestKey, 'retranslation:speech-repair-4:attempt-1');
  const firstResult = progress.find((event) => event.event === 'speech_repair_attempt_result');
  assert.equal(firstResult.returnedCharacters, 0);
  assert.equal(firstResult.providerResponseId, 'provider-1');
  assert.equal(firstResult.finishReason, 'content_filter');
  assert.equal(firstResult.providerFeedback.blockReason, 'SAFETY');
  assert.equal(progress.find((event) => event.event === 'speech_repair_attempt_failed').errorCode,
    'SPEECH_REPAIR_EMPTY_OUTPUT');
  assert.equal(progress.at(-1).event, 'speech_repair_completed');
  assert.equal(progress.at(-1).finalCharacters, 6);
  const diagnostics = JSON.stringify({ logs, progress });
  for (const privateValue of [privateSpeech, scene.visual, speechItem.audio, 'Short.']) {
    assert.equal(diagnostics.includes(privateValue), false);
  }
});

test('Gemini narrative repair retains high thinking and its existing timeout', async (t) => {
  t.mock.method(console, 'info', () => {});
  const scene = { duration: 10 };
  const speechItem = { type: 'speech', sceneIndex: 0, audio: 'This sentence needs shortening.' };
  let request;
  await rewriteNarrativeSpeechItemToFitScene({
    movieResourceList: { scenes: [scene], sounds: [speechItem] }, scene, speechItem,
    maxCharacters: 20, inferenceModel: 'gemini-4-carbon',
    options: { sceneIndex: 0, soundIndex: 0,
      dependencies: { openaiClient: {}, createCompatibleChatCompletion: async (_client, payload) => {
        request = payload;
        return { choices: [{ message: { content: 'Short.' } }] };
      } },
    },
  });
  assert.equal(request.reasoning_effort, 'high');
  assert.equal(request.timeout, Number(process.env.OPENAI_NARRATIVE_TIMEOUT_MS) || 600000);
});

for (const inferenceModel of ['gemini-4-carbon', 'gemini-4-neon']) {
  test(`${inferenceModel} translated speech repair preserves its high thinking policy`, async (t) => {
    t.mock.method(console, 'info', () => {});
    const scene = { duration: 10 };
    const speechItem = { type: 'speech', sceneIndex: 0, audio: 'x'.repeat(58) };
    let request;
    await rewriteNarrativeSpeechItemToFitScene({
      movieResourceList: { scenes: [scene], sounds: [speechItem] }, scene, speechItem,
      maxCharacters: 57, inferenceModel,
      options: { sceneIndex: 0, soundIndex: 0,
        translationContext: { originalText: 'Source speech.', targetLanguage: 'Thai' },
        dependencies: { openaiClient: {}, createCompatibleChatCompletion: async (_client, payload) => {
          request = payload;
          return { choices: [{ message: { content: 'Short.' } }] };
        } },
      },
    });
    assert.equal(request.model, inferenceModel);
    assert.equal(request.reasoning_effort, 'high');
    assert.equal(request.reasoning.effort, 'high');
    assert.equal(request.timeout, Number(process.env.OPENAI_TRANSLATION_SPEECH_REPAIR_TIMEOUT_MS) || 120000);
  });
}

for (const failure of [
  { code: 'ETIMEDOUT', status: 504, providerOutcomeUncertain: true, retryable: false },
  { code: 'ECONNRESET', providerOutcomeUncertain: true },
  { code: 'PROVIDER_REQUEST_REJECTED', retryable: false },
]) {
  test(`speech repair avoids another request after ${failure.code}`, async (t) => {
    const progress = [];
    const logs = [];
    t.mock.method(console, 'info', (...args) => logs.push(args));
    let calls = 0;
    const error = Object.assign(new Error('Private request payload'), failure);
    const scene = { duration: 10 };
    const speechItem = { type: 'speech', sceneIndex: 0, audio: 'x'.repeat(58) };
    await assert.rejects(rewriteNarrativeSpeechItemToFitScene({
      movieResourceList: { scenes: [scene], sounds: [speechItem] }, scene, speechItem,
      maxCharacters: 57, inferenceModel: 'gemini-4-carbon',
      options: { sceneIndex: 0, soundIndex: 0, maxAttempts: 3,
        translationContext: { originalText: 'Private source', targetLanguage: 'Thai' },
        onProgress: async (event) => progress.push(event),
        dependencies: { openaiClient: {}, sleep: async () => assert.fail('Must not retry an unknown outcome'),
          createCompatibleChatCompletion: async () => { calls += 1; throw error; } },
      },
    }), (actual) => actual === error);
    assert.equal(calls, 1);
    assert.deepEqual(progress.map((event) => event.event), [
      'speech_repair_attempt_started', 'speech_repair_attempt_failed',
    ]);
    assert.equal(progress.at(-1).willRetry, false);
    assert.equal(progress.at(-1).errorCode, failure.code);
    assert.equal(JSON.stringify({ logs, progress }).includes(error.message), false);
  });
}

function forceNativeOpenAIForTest(t) {
  const overrides = {
    OPENAI_API_KEY: 'test-openai-key',
    OPENROUTER_API_KEY: undefined,
    SAMSAR_API_KEY: undefined,
    GENBLAZE_API_KEY: undefined,
    GMI_API_KEY: undefined,
    SAMSAR_EXTERNAL_INFERENCE_ENABLED: 'false',
    SAMSAR_FORCE_EXTERNAL_INFERENCE: undefined,
  };
  const originalValues = new Map();
  Object.entries(overrides).forEach(([key, value]) => {
    originalValues.set(key, Object.prototype.hasOwnProperty.call(process.env, key)
      ? process.env[key]
      : undefined);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  });
  t.after(() => {
    originalValues.forEach((value, key) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
  });
}

for (const failure of [
  { code: 'ETIMEDOUT', providerOutcomeUncertain: true, retryable: false },
  { code: 'ECONNRESET', providerOutcomeUncertain: true },
  { code: 'PROVIDER_REQUEST_REJECTED', retryable: false },
]) {
  test(`narrative generation does not replay a request after ${failure.code}`, async (t) => {
    forceNativeOpenAIForTest(t);
    const logs = [];
    t.mock.method(console, 'error', (...args) => logs.push(args));
    let calls = 0;
    const error = Object.assign(new Error('Provider request did not complete.'), failure);
    t.mock.method(OpenAI.prototype, 'post', async () => { calls += 1; throw error; });
    await assert.rejects(sendNarrativePromptMessageRequest(
      [{ role: 'user', content: 'Create a short scene.' }], 'gpt-6.2-astra', 'high', { maxAttempts: 4 },
    ), (actual) => actual === error);
    assert.equal(calls, 1);
    assert.equal(logs.some(([label]) => label.includes('will retry')), false);
  });
}

test('character visual speaker message includes canonical gender when available', () => {
  assert.equal(
    buildCharacterSpeakerMessage('Sanctuary Control Crew', 'M'),
    'The speaker is: Sanctuary Control Crew. Their gender is Male.',
  );
  assert.equal(
    buildCharacterSpeakerMessage('Kaia Vale', 'Female'),
    'The speaker is: Kaia Vale. Their gender is Female.',
  );
  assert.equal(
    buildCharacterSpeakerMessage('Narrator', ''),
    'The speaker is: Narrator',
  );
});

test('theme and narrative callers preserve GPT 6.2 Astra xhigh while canonical Sol defaults high', async (t) => {
  forceNativeOpenAIForTest(t);
  const requestBodies = [];
  const responseJson = JSON.stringify({
    subject: [],
    actors: [],
    places: [],
    objects: [],
    setting: [],
    style: [],
    general: [],
  });
  t.mock.method(OpenAI.prototype, 'post', async (_path, options) => {
    requestBodies.push(options.body);
    return {
      id: `response-${requestBodies.length}`,
      model: 'gpt-6.2-astra',
      output_text: responseJson,
    };
  });

  await extractGroundedThemeFromUserPrompt(
    'A grounded technical documentary.',
    'gpt-6.2-astra-xhigh',
  );
  await extractThemeFromUserPromptAndImageTheme(
    'Continue the reference image.',
    'cinematic reference',
    'gpt-6.2-astra-xhigh',
  );
  await extractThemeForImageListAndPrompt(
    'product photography',
    'Build an ad.',
    'gpt-6.2-astra-xhigh',
  );
  await extractNarrativeFromInputPayload(
    {},
    { prompt: 'Connect the frames.', metadata: {}, imageDescriptionList: [] },
    30,
    'RUNWAYML',
    'gpt-6.2-astra-xhigh',
    1,
    'English',
  );
  await extractGroundedThemeFromUserPrompt(
    'A standard documentary.',
    'gpt-6.2-astra',
  );

  assert.equal(requestBodies.length, 5);
  requestBodies.slice(0, 4).forEach((body) => {
    assert.equal(body.model, 'gpt-6.2-astra');
    assert.deepEqual(body.reasoning, { effort: 'xhigh' });
  });
  assert.deepEqual(requestBodies[4].reasoning, { effort: 'high' });
});

test('retries invalid speech repairs three times with backoff and preserves item metadata', async () => {
  const requests = [];
  const receipts = [];
  const delays = [];
  const scene = {
    visual: 'A detective studies a photograph beneath a desk lamp.',
    type: 'narration',
    speaker: '',
    duration: 7.875,
    startTime: 0,
    endTime: 7.875,
  };
  const speechItem = {
    type: 'speech',
    subType: 'narration',
    actor: 'Narrator',
    gender: 'F',
    Identity: 'Detached observer',
    isHuman: true,
    sceneIndex: 4,
    audio: 'This first line is much too long.',
    duration: 7.875,
    startTime: 31.5,
    endTime: 39.375,
  };
  const movieResourceList = {
    scenes: [
      { visual: 'Opening image.', type: 'base', duration: 7.875 },
      { visual: 'A door closes.', type: 'sound_effect', duration: 7.875 },
      { visual: 'An empty corridor.', type: 'base', duration: 7.875 },
      { visual: 'A clock advances.', type: 'base', duration: 7.875 },
      scene,
    ],
    sounds: [
      {
        type: 'sound_effect',
        subType: '',
        sceneIndex: 1,
        audio: 'A wooden door clicks shut.',
      },
      {
        type: 'speech',
        subType: 'narration',
        actor: 'Narrator',
        gender: 'F',
        sceneIndex: 3,
        audio: 'Time passes.',
      },
      speechItem,
    ],
  };

  const repaired = await rewriteNarrativeSpeechItemToFitScene({
    movieResourceList,
    scene,
    speechItem,
    maxCharacters: 9,
    inferenceModel: 'QWEN3.8',
    options: {
      externalRequestContext: {
        sessionId: 'session-1',
        requestKey: 'text_to_video:speech-repair-1-4-2',
      },
      sceneIndex: 4,
      soundIndex: 2,
      onInferenceResponse: (receipt) => receipts.push(receipt),
      dependencies: {
        openaiClient: {},
        sleep: async (delayMs) => delays.push(delayMs),
        createCompatibleChatCompletion: async (_client, request) => {
          requests.push(request);
          const content = requests.length === 1
            ? JSON.stringify({ audio: 'Short.' })
            : (requests.length === 2 ? 'This replacement remains too long.' : 'Short.');
          return {
            model: 'qwen/qwen3.8-max',
            choices: [{ message: { content } }],
            usage: { input_tokens: 10, output_tokens: 3 },
          };
        },
      },
    },
  });

  assert.equal(requests.length, 3);
  assert.equal(
    requests[0].messages[0].content,
    'Rewrite the target speech to fit its scene in at most 9 characters. ' +
      'Preserve its meaning, language, speaker, and tone, using movieResourceList only for ' +
      'context. Return only the rewritten speech text.',
  );
  assert.match(requests[1].messages[0].content, /at most 8 characters/);
  assert.match(requests[2].messages[0].content, /at most 7 characters/);
  assert.equal('response_format' in requests[0], false);
  const expectedUserPayload = {
    movieResourceList,
    targetSceneIndex: 4,
    targetSoundIndex: 2,
    originalAudioItem: speechItem,
    sceneDescription: scene.visual,
  };
  requests.forEach((request) => {
    assert.equal(request.messages.length, 2);
    assert.deepEqual(JSON.parse(request.messages[1].content), expectedUserPayload);
  });
  assert.equal(
    requests[0].externalRequestContext.requestKey,
    'text_to_video:speech-repair-1-4-2:attempt-1',
  );
  assert.equal(
    requests[1].externalRequestContext.requestKey,
    'text_to_video:speech-repair-1-4-2:attempt-2',
  );
  assert.equal(
    requests[2].externalRequestContext.requestKey,
    'text_to_video:speech-repair-1-4-2:attempt-3',
  );
  assert.equal(requests[0].max_tokens, 8192);
  assert.equal(requests[0].reasoning.effort, 'low');
  assert.deepEqual(delays, [1000, 2000]);
  assert.equal(receipts.length, 3);
  assert.equal(receipts[2].stage, 'narrative_speech_repair');
  assert.equal(receipts[2].sceneIndex, 4);
  assert.equal(receipts[2].soundIndex, 2);
  assert.equal(repaired, 'Short.');
});

test('caps configured speech repair attempts at three', async () => {
  let requests = 0;
  const delays = [];
  const systemPrompts = [];
  const scene = { visual: 'A quiet sunrise.', duration: 5 };
  const speechItem = {
    type: 'speech',
    sceneIndex: 0,
    audio: 'This line needs repair.',
  };
  const movieResourceList = {
    scenes: [scene],
    sounds: [speechItem],
  };

  await assert.rejects(
    rewriteNarrativeSpeechItemToFitScene({
      movieResourceList,
      scene,
      speechItem,
      maxCharacters: 4,
      inferenceModel: 'QWEN3.8',
      options: {
        maxAttempts: 99,
        sceneIndex: 0,
        soundIndex: 0,
        dependencies: {
          openaiClient: {},
          sleep: async (delayMs) => delays.push(delayMs),
          createCompatibleChatCompletion: async (_client, request) => {
            requests += 1;
            systemPrompts.push(request.messages[0].content);
            return {
              model: 'qwen/qwen3.8-max',
              choices: [{
                message: { content: 'Still too long.' },
              }],
            };
          },
        },
      },
    }),
    /Replacement speech has 15 characters; 2 are allowed/,
  );

  assert.equal(requests, 3);
  assert.match(systemPrompts[0], /at most 4 characters/);
  assert.match(systemPrompts[1], /at most 3 characters/);
  assert.match(systemPrompts[2], /at most 2 characters/);
  assert.deepEqual(delays, [1000, 2000]);
});
