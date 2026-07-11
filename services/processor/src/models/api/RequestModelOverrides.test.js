import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSpeakerOptionsForTTSModel,
  getSpeakerOptionsFromPayload,
  normalizeBackingTrackModelFromPayload,
  normalizeInferenceModelFromPayload,
  normalizeTTSModelFromPayload,
  omitCustomTextToSpeechAdapterForTTSModel,
  resolveEffectiveInferenceModel,
} from './RequestModelOverrides.js';

function buildNarrative() {
  return {
    scenes: [
      { type: 'narration', speaker: 'Narrator' },
      { type: 'character', speaker: 'Marcus' },
    ],
    sounds: [
      {
        type: 'speech',
        subType: 'narration',
        actor: 'Narrator',
        gender: 'F',
        sceneIndex: 0,
        audio: 'Welcome.',
      },
      {
        type: 'speech',
        subType: 'character',
        actor: 'Marcus',
        gender: 'M',
        sceneIndex: 1,
        audio: 'Follow me.',
      },
    ],
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('normalizes request backing track aliases', () => {
  assert.equal(
    normalizeBackingTrackModelFromPayload({ backingtrack_model: 'ElevenLabs music' }),
    'ELEVENLABS_MUSIC',
  );
  assert.equal(
    normalizeBackingTrackModelFromPayload({ backing_track_model: 'elevenlabs_music' }),
    'ELEVENLABS_MUSIC',
  );
  assert.equal(
    normalizeBackingTrackModelFromPayload({ backingTrackModel: 'Lyria 3' }),
    'LYRIA3',
  );
  assert.equal(
    normalizeBackingTrackModelFromPayload({ musicProvider: 'Lyria 2' }),
    'LYRIA3',
  );
  assert.equal(normalizeBackingTrackModelFromPayload({}), null);
});

test('normalizes request TTS model aliases', () => {
  assert.equal(normalizeTTSModelFromPayload({ tts_model: 'OpenAI' }), 'OPENAI');
  assert.equal(normalizeTTSModelFromPayload({ ttsModel: 'eleven labs' }), 'ELEVENLABS');
  assert.equal(normalizeTTSModelFromPayload({ tts_provider: 'Google TTS' }), 'GOOGLE');
  assert.equal(normalizeTTSModelFromPayload({}), null);
});

test('normalizes request inference model aliases', () => {
  assert.equal(normalizeInferenceModelFromPayload({ inference_model: 'GPT 5.6 Sol' }), 'gpt-5.6-sol');
  assert.equal(normalizeInferenceModelFromPayload({ inferenceModel: 'gpt-5.6-sol' }), 'gpt-5.6-sol');
  assert.equal(normalizeInferenceModelFromPayload({ inferenceModel: 'gpt-5.6' }), 'gpt-5.6-sol');
  assert.equal(normalizeInferenceModelFromPayload({ inference_model: 'Gemini 3.1 Pro' }), 'gemini-3.1-pro');
  assert.equal(normalizeInferenceModelFromPayload({ inferenceModel: 'gemini-3-pro-preview' }), 'gemini-3.1-pro');
  assert.equal(normalizeInferenceModelFromPayload({}), null);
});

test('rejects unsupported request inference model aliases', () => {
  assert.throws(
    () => normalizeInferenceModelFromPayload({ inference_model: 'gpt-5' }),
    /inference_model must be one of: gpt-5\.6-sol, gemini-3\.1-pro/,
  );
  assert.throws(
    () => normalizeInferenceModelFromPayload({ inference_model: 'claude' }),
    /inference_model must be one of: gpt-5\.6-sol, gemini-3\.1-pro/,
  );
});

test('resolves effective inference model from request override or account setting', () => {
  assert.equal(
    resolveEffectiveInferenceModel({ inference_model: 'GPT 5.6 Sol' }, 'gemini-3.1-pro'),
    'gpt-5.6-sol',
  );
  assert.equal(
    resolveEffectiveInferenceModel({}, 'gemini-3.1-pro'),
    'gemini-3.1-pro',
  );
  assert.equal(resolveEffectiveInferenceModel({}, null), 'gpt-5.6-sol');
});

test('reads request speaker options aliases', () => {
  const speakerOptions = { googleSpeakers: ['en-US-Standard-F'] };

  assert.equal(getSpeakerOptionsFromPayload({ speakerOptions }), speakerOptions);
  assert.equal(getSpeakerOptionsFromPayload({ speaker_options: speakerOptions }), speakerOptions);
  assert.equal(getSpeakerOptionsFromPayload({}), null);
});

test('request TTS provider limits speaker assignment to ElevenLabs', async () => {
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
  const { assignSpeakersToScenes } = await import('../movie_session/MovieGeneratorUtils.js');

  const speakerOptions = buildSpeakerOptionsForTTSModel('ELEVENLABS', {
    allowOpenAI: true,
    openAISpeakers: ['nova'],
  });
  const result = assignSpeakersToScenes(clone(buildNarrative()), {
    language: 'en',
    speakerOptions,
  });

  const speechSounds = result.sounds.filter((sound) => sound.type === 'speech');
  assert.equal(speechSounds.length, 2);
  assert.ok(speechSounds.every((sound) => sound.provider === 'ELEVENLABS'));
});

test('request Google TTS requires user Google speaker details', () => {
  assert.throws(
    () => buildSpeakerOptionsForTTSModel('GOOGLE', null),
    /requires configured Google TTS speaker details/,
  );
});

test('request Google TTS accepts payload Google speaker details without user settings', () => {
  const speakerOptions = buildSpeakerOptionsForTTSModel('GOOGLE', {
    googleSpeakers: ['en-US-Standard-F', 'en-US-Standard-D'],
    googleSpeakerDetails: [
      {
        value: 'en-US-Standard-F',
        languageCode: 'en-US',
        languageCodes: ['en-US'],
        ssmlGender: 'SSML_VOICE_GENDER_FEMALE',
      },
      {
        value: 'en-US-Standard-D',
        languageCode: 'en-US',
        languageCodes: ['en-US'],
        ssmlGender: 'SSML_VOICE_GENDER_MALE',
      },
    ],
  });

  assert.equal(speakerOptions.allowGoogle, true);
  assert.equal(speakerOptions.allowOpenAI, false);
  assert.equal(speakerOptions.allowElevenLabs, false);
  assert.deepEqual(speakerOptions.googleSpeakers, ['en-US-Standard-F', 'en-US-Standard-D']);
  assert.equal(speakerOptions.googleSpeakerDetails.length, 2);
  assert.equal(speakerOptions.googleSpeakerDetails[0].provider, 'GOOGLE');
  assert.equal(speakerOptions.googleSpeakerDetails[0].voiceId, 'en-US-Standard-F');
  assert.equal(speakerOptions.googleSpeakerDetails[0].languageCode, 'en-US');
  assert.deepEqual(speakerOptions.googleSpeakerDetails[0].languageCodes, ['en-US']);
  assert.equal(speakerOptions.googleSpeakerDetails[0].Gender, 'F');
  assert.equal(speakerOptions.googleSpeakerDetails[1].Gender, 'M');
});

test('request TTS speaker options override user speaker settings', () => {
  const userSpeakerOptions = {
    googleSpeakers: ['en-US-Standard-D'],
    googleSpeakerDetails: [
      {
        value: 'en-US-Standard-D',
        languageCode: 'en-US',
        ssmlGender: 'SSML_VOICE_GENDER_MALE',
      },
    ],
  };

  const speakerOptions = buildSpeakerOptionsForTTSModel(
    'GOOGLE',
    {
      googleSpeakers: ['en-US-Standard-F'],
      googleSpeakerDetails: [
        {
          value: 'en-US-Standard-F',
          languageCode: 'en-US',
          ssmlGender: 'SSML_VOICE_GENDER_FEMALE',
        },
      ],
    },
    userSpeakerOptions,
  );

  assert.deepEqual(speakerOptions.googleSpeakers, ['en-US-Standard-F']);
  assert.equal(speakerOptions.googleSpeakerDetails[0].value, 'en-US-Standard-F');
  assert.equal(speakerOptions.googleSpeakerDetails[0].Gender, 'F');
});

test('request TTS model falls back to user speaker settings when payload speakers are omitted', () => {
  const speakerOptions = buildSpeakerOptionsForTTSModel(
    'GOOGLE',
    null,
    {
      googleSpeakers: ['en-US-Standard-D'],
      googleSpeakerDetails: [
        {
          value: 'en-US-Standard-D',
          languageCode: 'en-US',
          ssmlGender: 'SSML_VOICE_GENDER_MALE',
        },
      ],
    },
  );

  assert.deepEqual(speakerOptions.googleSpeakers, ['en-US-Standard-D']);
  assert.equal(speakerOptions.googleSpeakerDetails[0].value, 'en-US-Standard-D');
  assert.equal(speakerOptions.googleSpeakerDetails[0].Gender, 'M');
});

test('request Google TTS payload speaker options drive speaker assignment', async () => {
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
  const { assignSpeakersToScenes } = await import('../movie_session/MovieGeneratorUtils.js');
  const speakerOptions = buildSpeakerOptionsForTTSModel('GOOGLE', {
    googleSpeakers: ['en-US-Standard-F', 'en-US-Standard-D'],
    googleSpeakerDetails: [
      {
        value: 'en-US-Standard-F',
        languageCode: 'en-US',
        ssmlGender: 'SSML_VOICE_GENDER_FEMALE',
      },
      {
        value: 'en-US-Standard-D',
        languageCode: 'en-US',
        ssmlGender: 'SSML_VOICE_GENDER_MALE',
      },
    ],
  });

  const result = assignSpeakersToScenes(clone(buildNarrative()), {
    language: 'en',
    speakerOptions,
  });

  const narration = result.sounds.find((sound) => sound.subType === 'narration');
  const character = result.sounds.find((sound) => sound.subType === 'character');
  assert.equal(narration.provider, 'GOOGLE');
  assert.equal(narration.speaker, 'en-US-Standard-F');
  assert.equal(narration.speakerDetails.Gender, 'F');
  assert.equal(character.provider, 'GOOGLE');
  assert.equal(character.speaker, 'en-US-Standard-D');
  assert.equal(character.speakerDetails.Gender, 'M');
});

test('request TTS model suppresses custom text-to-speech adapter only', () => {
  assert.deepEqual(
    omitCustomTextToSpeechAdapterForTTSModel({
      base_url: 'https://example.test',
      text_to_speech: '/speech',
      text_to_music: '/music',
    }, 'OPENAI'),
    {
      base_url: 'https://example.test',
      text_to_music: '/music',
    },
  );
  assert.equal(
    omitCustomTextToSpeechAdapterForTTSModel({
      base_url: 'https://example.test',
      text_to_speech: '/speech',
    }, 'OPENAI'),
    null,
  );
});
