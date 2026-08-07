import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getSpeechCharacterLimitForDuration,
  getSpeechCharacterLimitsForModel,
  getSpeechDurationStringForModel,
} from './ModelUtils.js';

test('uses unified prompt and validation character boundaries for every model duration', () => {
  const limits = getSpeechCharacterLimitsForModel('HAPPYHORSEI2V', 'English');

  assert.deepEqual(
    limits.map((limit) => ({
      durationSeconds: limit.durationSeconds,
      originalMaxCharacters: limit.originalMaxCharacters,
      maxCharacters: limit.maxCharacters,
      validationMaxCharacters: limit.validationMaxCharacters,
      overshootRatio: limit.overshootRatio,
    })),
    [
      {
        durationSeconds: 5,
        originalMaxCharacters: 25,
        maxCharacters: 28,
        validationMaxCharacters: 36,
        overshootRatio: 0.3,
      },
      {
        durationSeconds: 10,
        originalMaxCharacters: 50,
        maxCharacters: 55,
        validationMaxCharacters: 71,
        overshootRatio: 0.3,
      },
      {
        durationSeconds: 15,
        originalMaxCharacters: 75,
        maxCharacters: 83,
        validationMaxCharacters: 107,
        overshootRatio: 0.3,
      },
    ],
  );
});

test('Seedance 2.5 speech boundaries follow five-second scene units through 30 seconds', () => {
  const promptRules = getSpeechDurationStringForModel('SEEDANCE2.5I2V', 'English');

  assert.match(promptRules, /Each scene must be 5, 10, 15, 20, 25, or 30 seconds long/);
  assert.match(promptRules, /28 characters or fewer for a 5-second scene/);
  assert.match(promptRules, /165 characters or fewer for a 30-second scene/);
});

test('floors model durations only when rendering shared narrative prompt boundaries', () => {
  const promptRules = getSpeechDurationStringForModel('COSMOS3SUPERI2V', 'English', 24);

  assert.equal(
    promptRules,
    '- Each scene must be either 5 or 7 seconds long.\n' +
      '- Keep each speech "audio" line within its scene\'s available speaking time: ' +
      '28 characters or fewer for a 5-second scene and 44 characters or fewer for a ' +
      '7-second scene; spaces and punctuation count toward the limit.',
  );
  assert.doesNotMatch(promptRules, /HARD SPEECH LIMIT/);
  assert.doesNotMatch(promptRules, /7\.875/);

  const limits = getSpeechCharacterLimitsForModel('COSMOS3SUPERI2V', 'English', 24);
  assert.equal(limits[1].durationSeconds, 7.875);
});

test('selects the same speech boundary used when scene durations are normalized', () => {
  assert.equal(
    getSpeechCharacterLimitForDuration('COSMOS3SUPERI2V', 5, 'English', 24).maxCharacters,
    28,
  );
  assert.equal(
    getSpeechCharacterLimitForDuration('COSMOS3SUPERI2V', 7, 'English', 24).maxCharacters,
    44,
  );
  assert.equal(
    getSpeechCharacterLimitForDuration('COSMOS3SUPERI2V', 7.875, 'English', 24).maxCharacters,
    44,
  );
});
