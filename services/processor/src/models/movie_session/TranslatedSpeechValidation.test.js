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
    inferenceModel: 'claude-fable-5.1', inferenceEffort: 'xhigh', sessionId: 'translated',
  }, { rewriteSpeechItem: async (request) => {
    assert.equal(request.maxCharacters, 57);
    assert.equal(request.inferenceModel, 'claude-fable-5.1');
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
