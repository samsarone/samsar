import assert from 'node:assert/strict';
import test from 'node:test';
import { getTranslatedSpeechSlots, validateTranslatedSpeech } from './TranslatedSpeechValidation.js';

function fixture(duration = 10) {
  return {
    layers: [{ _id: 'layer', duration, durationOffset: 0 }],
    audioLayers: [{ _id: 'speech', connectedLayerId: 'layer', generationType: 'speech',
      startTime: 0, duration, speakerCharacterName: 'Marie' }],
  };
}

for (const [targetLanguage, text] of [
  ['English', 'a'.repeat(71)], ['French', 'a'.repeat(57)],
  ['Japanese', '字'.repeat(57)], ['Thai', 'ก้'.repeat(28) + 'ก'],
  ['Chinese', '𠮷'.repeat(57)],
]) {
  test(`${targetLanguage} accepts the exact tolerated Unicode boundary without a rewrite`, async () => {
    const session = fixture();
    const before = structuredClone(session);
    const result = await validateTranslatedSpeech({
      session, originalTexts: ['Short.'], translatedTexts: [` ${text} `], targetLanguage,
    }, { rewriteSpeechItem: () => assert.fail('Within tolerance must not call the LLM') });
    assert.deepEqual(result.texts, [text]);
    assert.equal(result.validation[0].finalCharacters, Array.from(text).length);
    assert.equal(result.validation[0].attempts, 0);
    assert.deepEqual(session, before);
  });
}

test('one character beyond tolerance repairs only the offending item with source and selected effort', async () => {
  const session = fixture();
  session.layers.push({ _id: 'second', duration: 10, durationOffset: 10 });
  session.audioLayers.push({ connectedLayerId: 'second', generationType: 'speech', startTime: 10, duration: 10 });
  const result = await validateTranslatedSpeech({
    session, originalTexts: ['Marie visits Paris.', 'Hello.'],
    translatedTexts: ['x'.repeat(58), 'Bonjour.'], targetLanguage: 'French',
    inferenceModel: 'claude-fable-5.2', inferenceEffort: 'xhigh', sessionId: 'translated',
  }, { rewriteSpeechItem: async (request) => {
    assert.equal(request.maxCharacters, 57);
    assert.equal(request.inferenceModel, 'claude-fable-5.2');
    assert.equal(request.options.reasoningEffort, 'xhigh');
    assert.equal(request.options.translationContext.originalText, 'Marie visits Paris.');
    assert.equal(request.options.translationContext.translatedText.length, 58);
    assert.equal(request.options.translationContext.targetLanguage, 'French');
    request.options.onRepairAttempt(1);
    return 'Marie visite Paris.';
  } });
  assert.deepEqual(result.texts, ['Marie visite Paris.', 'Bonjour.']);
  assert.equal(result.validation[0].attempts, 1);
  assert.equal(result.validation[1].attempts, 0);
});

test('speech budgets use remaining layer time, offsets, the next speech start and fractional duration', () => {
  const session = fixture(10);
  session.audioLayers[0].duration = 20; // Old TTS duration must not enlarge the layer budget.
  session.audioLayers.push({ generationType: 'speech', connectedLayerId: 'layer', startTime: 7.5, duration: 6 });
  session.audioLayers.push({ generationType: 'music', duration: 99 });
  assert.deepEqual(getTranslatedSpeechSlots(session).map((slot) => slot.durationSeconds), [7.5, 2.5]);
  session.audioLayers[0].duration = 3;
  assert.equal(getTranslatedSpeechSlots(session)[0].durationSeconds, 3);
});

test('connected layer ID takes precedence over a stale layer index', () => {
  const session = fixture(2.5);
  session.layers.push({ _id: 'other', duration: 20, durationOffset: 2.5 });
  session.audioLayers[0].connectedLayerIndex = 1;
  assert.equal(getTranslatedSpeechSlots(session)[0].durationSeconds, 2.5);
});

test('unresolved layers, invalid timing, blank output and count mismatches fail validation', async () => {
  for (const change of [
    (s) => { s.audioLayers[0].connectedLayerId = 'missing'; },
    (s) => { s.layers[0].duration = 0; },
    (s) => { s.audioLayers[0].startTime = 10; },
    (s) => { s.audioLayers[0].startTime = -1; },
  ]) {
    const session = fixture();
    change(session);
    assert.throws(() => getTranslatedSpeechSlots(session), { code: 'TRANSLATED_SPEECH_VALIDATION_FAILED' });
  }
  for (const translatedTexts of [[], ['']]) {
    await assert.rejects(validateTranslatedSpeech({
      session: fixture(), originalTexts: ['Hello'], translatedTexts, targetLanguage: 'English',
    }), { code: 'TRANSLATED_SPEECH_VALIDATION_FAILED' });
  }
});

test('repair failures and invalid repair results cannot bypass the final text bound', async () => {
  for (const repair of [async () => '', async () => 'x'.repeat(72), async () => { throw new Error('Provider unavailable'); }]) {
    await assert.rejects(validateTranslatedSpeech({
      session: fixture(), originalTexts: ['Hello'], translatedTexts: ['x'.repeat(72)], targetLanguage: 'English',
    }, { rewriteSpeechItem: repair }), { code: 'TRANSLATED_SPEECH_VALIDATION_FAILED' });
  }
});

test('validation forwards per-speech identity and awaits progress before starting the next item', async (t) => {
  const logs = [];
  const progress = [];
  t.mock.method(console, 'info', (...args) => logs.push(args));
  const session = fixture();
  session.layers.push({ _id: 'second', duration: 10, durationOffset: 10 });
  session.audioLayers.push({ connectedLayerId: 'second', generationType: 'speech', startTime: 10, duration: 10 });
  let releaseProgress;
  let repairs = 0;
  const job = validateTranslatedSpeech({
    session, originalTexts: ['Private source one.', 'Private source two.'],
    translatedTexts: ['x'.repeat(58), 'Bonjour.'], targetLanguage: 'French',
    inferenceModel: 'gemini-4-carbon', sessionId: 'translated-1',
    onProgress: async (event) => {
      progress.push(event);
      if (event.event === 'speech_validation_completed' && event.speechIndex === 0) {
        await new Promise((resolve) => { releaseProgress = resolve; });
      }
    },
  }, { rewriteSpeechItem: async ({ options }) => {
    repairs += 1;
    assert.deepEqual(options.externalRequestContext, { sessionId: 'translated-1',
      requestKey: 'retranslation:speech-repair-0', speechIndex: 0, layerIndex: 0, speechCount: 2 });
    options.onRepairAttempt(1);
    await options.onProgress({ stage: 'speech_repair', event: 'speech_repair_attempt_started',
      speechIndex: 0, layerIndex: 0, attempt: 1 });
    return 'Repaired speech.';
  } });
  await new Promise(setImmediate);
  assert.equal(repairs, 1);
  assert.equal(progress.some((event) => event.speechIndex === 1), false);
  releaseProgress();
  const result = await job;
  assert.deepEqual(result.texts, ['Repaired speech.', 'Bonjour.']);
  assert.deepEqual(progress.map((event) => event.event), [
    'speech_validation_started', 'speech_repair_attempt_started', 'speech_validation_completed',
    'speech_validation_started', 'speech_validation_completed',
  ]);
  assert.equal(progress[0].maxCharacters, 57);
  assert.equal(progress[0].translatedCharacters, 58);
  assert.equal(progress.at(-1).finalCharacters, 8);
  const diagnostics = JSON.stringify({ logs, progress });
  for (const text of ['Private source one.', 'Private source two.', 'x'.repeat(58), 'Repaired speech.', 'Bonjour.']) {
    assert.equal(diagnostics.includes(text), false);
  }
});

test('progress persistence failure cannot cause an extra repair and uncertain outcomes retain their marker', async (t) => {
  t.mock.method(console, 'info', () => {});
  t.mock.method(console, 'warn', () => {});
  let calls = 0;
  const cause = Object.assign(new Error('Private provider details'), {
    code: 'ETIMEDOUT', providerOutcomeUncertain: true, retryable: false,
  });
  await assert.rejects(validateTranslatedSpeech({
    session: fixture(), originalTexts: ['Hello.'], translatedTexts: ['x'.repeat(58)],
    targetLanguage: 'French', onProgress: async () => { throw new Error('Private persistence details'); },
  }, { rewriteSpeechItem: async () => { calls += 1; throw cause; } }), (error) => {
    assert.equal(error.code, 'TRANSLATED_SPEECH_VALIDATION_FAILED');
    assert.equal(error.providerOutcomeUncertain, true);
    assert.equal(error.retryable, false);
    assert.equal(error.cause, cause);
    return true;
  });
  assert.equal(calls, 1);
});
