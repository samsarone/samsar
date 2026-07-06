import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ELEVENLABS_TTS_SPEAKERS,
  OPENAI_TTS_SPEAKERS,
  normalizeTTSSpeakerGender,
} from '../../consts/TTSSpeakers.js';
import {
  isOpenAITTSForcedLanguage,
  resolveCustomAdaptersForTTSLanguagePolicy,
  resolveTTSProviderForLanguage,
} from './TTSLanguagePolicy.js';

const openAISpeakerValues = new Set(OPENAI_TTS_SPEAKERS.map((speaker) => speaker.value));
const elevenLabsSpeakerValues = new Set(ELEVENLABS_TTS_SPEAKERS.map((speaker) => speaker.value));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function withEnv(overrides, callback) {
  const previous = {};
  for (const key of Object.keys(overrides)) {
    previous[key] = process.env[key];
    const nextValue = overrides[key];
    if (nextValue === undefined || nextValue === null) {
      delete process.env[key];
    } else {
      process.env[key] = nextValue;
    }
  }

  try {
    return await callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function buildNarrative() {
  return {
    scenes: [
      {
        type: 'narration',
        speaker: 'Narrator',
      },
      {
        type: 'character',
        speaker: 'Marcus',
      },
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

test('Sanskrit and Latin force OpenAI TTS providers', () => {
  assert.equal(isOpenAITTSForcedLanguage('sa'), true);
  assert.equal(isOpenAITTSForcedLanguage('LA'), true);
  assert.equal(isOpenAITTSForcedLanguage('Sanskrit'), true);
  assert.equal(resolveTTSProviderForLanguage('la', 'CUSTOM_TEXT_TO_SPEECH'), 'OPENAI');
  assert.equal(resolveTTSProviderForLanguage('hi', 'CUSTOM_TEXT_TO_SPEECH'), 'CUSTOM_TEXT_TO_SPEECH');
});

test('TTS gender normalization accepts Google enum-style structured values', () => {
  assert.equal(normalizeTTSSpeakerGender('Gender.MALE'), 'M');
  assert.equal(normalizeTTSSpeakerGender('SSML_VOICE_GENDER_FEMALE'), 'F');
  assert.equal(normalizeTTSSpeakerGender({ ssmlGender: 'SSML_VOICE_GENDER_MALE' }), 'M');
  assert.equal(normalizeTTSSpeakerGender({ value: 'FEMALE' }), 'F');
});

test('forced OpenAI languages omit custom text-to-speech adapters only', () => {
  const customAdapters = {
    base_url: 'https://example.test',
    text_to_speech: '/speech',
    image_to_video: '/video',
  };

  assert.deepEqual(resolveCustomAdaptersForTTSLanguagePolicy(customAdapters, 'sa'), {
    base_url: 'https://example.test',
    image_to_video: '/video',
  });
  assert.deepEqual(resolveCustomAdaptersForTTSLanguagePolicy(customAdapters, 'fr'), customAdapters);
  assert.equal(
    resolveCustomAdaptersForTTSLanguagePolicy({
      base_url: 'https://example.test',
      text_to_speech: '/speech',
    }, 'la'),
    null,
  );
});

test('Sanskrit speaker assignment ignores ElevenLabs-only user preferences', async () => {
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
  const { assignSpeakersToScenes } = await import('./MovieGeneratorUtils.js');

  const result = assignSpeakersToScenes(clone(buildNarrative()), {
    language: 'sa',
    speakerOptions: {
      allowOpenAI: false,
      allowElevenLabs: true,
      elevenLabsSpeakers: ['EXAVITQu4vr4xnSDxMaL', 'CwhRBWXzGAHq8TQ4Fs17'],
    },
  });

  const speechSounds = result.sounds.filter((sound) => sound.type === 'speech');
  assert.equal(speechSounds.length, 2);
  assert.ok(speechSounds.every((sound) => sound.provider === 'OPENAI'));
  assert.ok(speechSounds.every((sound) => openAISpeakerValues.has(sound.speaker)));
});

test('female OpenAI assignment avoids neutral alloy voice', async () => {
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
  const { assignSpeakersToScenes } = await import('./MovieGeneratorUtils.js');

  const result = assignSpeakersToScenes({
    scenes: [
      {
        type: 'character',
        speaker: 'Dr. Aris',
      },
    ],
    sounds: [
      {
        type: 'speech',
        subType: 'character',
        actor: 'Dr. Aris',
        gender: 'F',
        sceneIndex: 0,
        audio: 'Trust the future.',
      },
    ],
  }, {
    language: 'en',
  });

  const character = result.sounds[0];
  assert.equal(character.provider, 'OPENAI');
  assert.notEqual(character.speaker, 'alloy');
  assert.ok(['nova', 'shimmer'].includes(character.speaker));
});

test('other languages still honor ElevenLabs speaker preferences', async () => {
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
  const { assignSpeakersToScenes } = await import('./MovieGeneratorUtils.js');

  const result = assignSpeakersToScenes(clone(buildNarrative()), {
    language: 'hi',
    speakerOptions: {
      allowOpenAI: false,
      allowElevenLabs: true,
      elevenLabsSpeakers: ['EXAVITQu4vr4xnSDxMaL', 'CwhRBWXzGAHq8TQ4Fs17'],
    },
  });

  const speechSounds = result.sounds.filter((sound) => sound.type === 'speech');
  assert.equal(speechSounds.length, 2);
  assert.ok(speechSounds.every((sound) => sound.provider === 'ELEVENLABS'));
});

test('docker speaker assignment replaces unavailable OpenAI-only preferences with an available provider', async () => {
  const { assignSpeakersToScenes } = await import('./MovieGeneratorUtils.js');

  await withEnv({
    CURRENT_ENV: 'docker',
    SAMSAR_DOCKER_AUDIO_PROVIDER_ROUTING_ENABLED: 'true',
    OPENAI_API_KEY: undefined,
    SAMSAR_API_KEY: undefined,
    ELEVENLABS_API_TOKEN: undefined,
    ELEVENLABS_API_KEY: undefined,
    FAL_API_KEY: 'test-fal-key',
    GOOGLE_APPLICATION_CREDENTIALS_JSON: '{}',
  }, async () => {
    const result = assignSpeakersToScenes(clone(buildNarrative()), {
      language: 'en',
      speakerOptions: {
        allowOpenAI: true,
        allowElevenLabs: false,
        allowGoogle: false,
        openAISpeakers: [],
        elevenLabsSpeakers: [],
        googleSpeakers: [],
        googleSpeakerDetails: [],
      },
    });

    const speechSounds = result.sounds.filter((sound) => sound.type === 'speech');
    assert.equal(speechSounds.length, 2);
    assert.ok(speechSounds.every((sound) => sound.provider === 'ELEVENLABS'));
    assert.ok(speechSounds.every((sound) => elevenLabsSpeakerValues.has(sound.speaker)));
  });
});

test('Google speaker preferences assign gender-matching voices with synthesis metadata', async () => {
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
  const { assignSpeakersToScenes } = await import('./MovieGeneratorUtils.js');

  const result = assignSpeakersToScenes(clone(buildNarrative()), {
    language: 'en',
    speakerOptions: {
      allowOpenAI: false,
      allowElevenLabs: false,
      allowGoogle: true,
      googleSpeakers: ['en-US-Standard-F', 'en-US-Standard-D'],
      googleSpeakerDetails: [
        {
          provider: 'GOOGLE',
          value: 'en-US-Standard-F',
          voiceId: 'en-US-Standard-F',
          label: 'en-US Standard F',
          languageCode: 'en-US',
          languageCodes: ['en-US'],
          Gender: 'FEMALE',
        },
        {
          provider: 'GOOGLE',
          value: 'en-US-Standard-D',
          voiceId: 'en-US-Standard-D',
          label: 'en-US Standard D',
          languageCode: 'en-US',
          languageCodes: ['en-US'],
          Gender: 'MALE',
        },
      ],
    },
  });

  const narration = result.sounds.find((sound) => sound.subType === 'narration');
  const character = result.sounds.find((sound) => sound.subType === 'character');

  assert.equal(narration.provider, 'GOOGLE');
  assert.equal(narration.speaker, 'en-US-Standard-F');
  assert.equal(narration.speakerVoiceId, 'en-US-Standard-F');
  assert.equal(narration.languageCode, 'en-US');
  assert.deepEqual(narration.languageCodes, ['en-US']);
  assert.equal(narration.speakerDetails.Gender, 'F');

  assert.equal(character.provider, 'GOOGLE');
  assert.equal(character.speaker, 'en-US-Standard-D');
  assert.equal(character.speakerVoiceId, 'en-US-Standard-D');
  assert.equal(character.languageCode, 'en-US');
  assert.deepEqual(character.languageCodes, ['en-US']);
  assert.equal(character.speakerDetails.Gender, 'M');
});

test('Google-only speaker preferences skip OpenAI TTS instruction metadata', async () => {
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
  const { assignCharactersAndInstructionsToScenes } = await import('./MovieGeneratorUtils.js');

  const result = await assignCharactersAndInstructionsToScenes(
    'Create a concise narrated story.',
    clone(buildNarrative()),
    'grounded',
    {
      language: 'en',
      inferenceModel: 'gemini-3.1-pro',
      speakerOptions: {
        allowOpenAI: false,
        allowElevenLabs: false,
        allowGoogle: true,
        googleSpeakers: ['en-US-Standard-F', 'en-US-Standard-D'],
        googleSpeakerDetails: [
          {
            provider: 'GOOGLE',
            value: 'en-US-Standard-F',
            voiceId: 'en-US-Standard-F',
            label: 'en-US Standard F',
            languageCode: 'en-US',
            languageCodes: ['en-US'],
            Gender: 'FEMALE',
          },
          {
            provider: 'GOOGLE',
            value: 'en-US-Standard-D',
            voiceId: 'en-US-Standard-D',
            label: 'en-US Standard D',
            languageCode: 'en-US',
            languageCodes: ['en-US'],
            Gender: 'MALE',
          },
        ],
      },
    },
  );

  const speechSounds = result.sounds.filter((sound) => sound.type === 'speech');
  assert.equal(speechSounds.length, 2);
  assert.ok(speechSounds.every((sound) => sound.provider === 'GOOGLE'));
  assert.deepEqual(
    speechSounds.map((sound) => sound.speaker),
    ['en-US-Standard-F', 'en-US-Standard-D'],
  );

  for (const sound of speechSounds) {
    assert.equal(sound.instructions, undefined);
    assert.equal(sound.Affect, undefined);
    assert.equal(sound.Tone, undefined);
    assert.equal(sound.Emotion, undefined);
    assert.equal(sound.Pronunciation, undefined);
    assert.equal(sound.Pause, undefined);
    assert.equal(sound.AudioEffects, undefined);
  }
});
