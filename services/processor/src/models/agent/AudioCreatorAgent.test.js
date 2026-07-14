import test from 'node:test';
import assert from 'node:assert/strict';

import { translateSpeech } from './AudioCreatorAgent.js';

test('translateSpeech uses the selected inference model and structured output', async () => {
  let capturedRequest = null;
  const translated = await translateSpeech(
    'Hello there.',
    'Thai',
    'gemini-3.1-pro',
    {
      createChatCompletion: async (_client, request) => {
        capturedRequest = request;
        return {
          choices: [{ message: { content: JSON.stringify({ translation: 'สวัสดี' }) } }],
        };
      },
    },
  );

  assert.equal(translated, 'สวัสดี');
  assert.equal(capturedRequest.model, 'gemini-3.1-pro');
  assert.equal(capturedRequest.messages[1].content, 'Hello there.');
  assert.equal(capturedRequest.response_format.type, 'json_schema');
});

test('translateSpeech accepts provider parsed output and skips empty speech', async () => {
  const translated = await translateSpeech('Welcome.', 'French', 'QWEN3.7', {
    createChatCompletion: async () => ({
      choices: [{ message: { parsed: { translation: 'Bienvenue.' } } }],
    }),
  });
  assert.equal(translated, 'Bienvenue.');

  let called = false;
  const empty = await translateSpeech('   ', 'French', 'QWEN3.7', {
    createChatCompletion: async () => {
      called = true;
    },
  });
  assert.equal(empty, '   ');
  assert.equal(called, false);
});

test('translateSpeech detects canonical source language and preserves exact same-language text', async () => {
  let capturedRequest = null;
  const original = '夜が明ける。';
  const resolved = await translateSpeech(original, 'Japanese', 'gemini-3.1-pro', {
    detectSourceLanguage: true,
    returnMetadata: true,
    targetLanguageCode: 'ja',
    createChatCompletion: async (_client, request) => {
      capturedRequest = request;
      return {
        choices: [{
          message: {
            parsed: {
              sourceLanguage: 'jpn',
              translation: 'The model changed this text, but it must be ignored.',
            },
          },
        }],
      };
    },
  });

  assert.deepEqual(resolved, {
    text: original,
    sourceLanguage: 'ja',
    translationRequired: false,
  });
  assert.equal(capturedRequest.model, 'gemini-3.1-pro');
  assert.match(capturedRequest.messages[0].content, /sourceLanguage/);
});

test('translateSpeech returns ordered subtitle mappings and a localized speaker label', async () => {
  let capturedRequest = null;
  const translated = await translateSpeech('Welcome home.', 'Thai', 'QWEN3.7', {
    includeSubtitleAlignment: true,
    speakerCharacterName: 'Narrator',
    createChatCompletion: async (_client, request) => {
      capturedRequest = request;
      return {
        choices: [{
          message: {
            parsed: {
              translation: 'ยินดีต้อนรับกลับบ้าน',
              subtitleAlignmentMap: [
                { sourceText: ' Welcome ', translatedText: ' ยินดีต้อนรับ ' },
                { sourceText: 'home.', translatedText: 'กลับบ้าน' },
              ],
              subtitleSpeakerCharacterName: 'ผู้บรรยาย',
            },
          },
        }],
      };
    },
  });

  assert.deepEqual(translated, {
    text: 'ยินดีต้อนรับกลับบ้าน',
    subtitleAlignmentMap: [
      { sourceText: 'Welcome', translatedText: 'ยินดีต้อนรับ' },
      { sourceText: 'home.', translatedText: 'กลับบ้าน' },
    ],
    subtitleSpeakerCharacterName: 'ผู้บรรยาย',
  });
  assert.equal(capturedRequest.model, 'QWEN3.7');
  assert.match(capturedRequest.messages[0].content, /subtitleAlignmentMap/);
  assert.match(capturedRequest.messages[0].content, /subtitleSpeakerCharacterName/);
  assert.deepEqual(JSON.parse(capturedRequest.messages[1].content), {
    sourceSpeechText: 'Welcome home.',
    translatedSubtitleText: 'ยินดีต้อนรับกลับบ้าน',
    speakerCharacterName: 'Narrator',
  });
});

test('translateSpeech deterministically falls back for incomplete alignment metadata', async () => {
  const missingMap = await translateSpeech('Hello.', 'French', 'gemini-3.1-pro', {
    includeSubtitleAlignment: true,
    maxValidationAttempts: 1,
    createChatCompletion: async () => ({
      choices: [{ message: { parsed: { translation: 'Bonjour.', subtitleAlignmentMap: [] } } }],
    }),
  });
  assert.deepEqual(missingMap, {
    text: 'Bonjour.',
    subtitleAlignmentMap: [{ sourceText: 'Hello.', translatedText: 'Bonjour.' }],
    subtitleSpeakerCharacterName: null,
  });

  let missingSpeakerCallCount = 0;
  const missingSpeaker = await translateSpeech('Hello.', 'French', 'gemini-3.1-pro', {
    includeSubtitleAlignment: true,
    speakerCharacterName: 'Host',
    maxValidationAttempts: 1,
    createChatCompletion: async () => {
      missingSpeakerCallCount += 1;
      const parsed = missingSpeakerCallCount === 1
        ? { translation: 'Bonjour.' }
        : missingSpeakerCallCount === 2
          ? {
            subtitleAlignmentMap: [{ sourceText: 'Hello.', translatedText: 'Bonjour.' }],
            subtitleSpeakerCharacterName: ' ',
          }
          : { translation: 'Hôte' };
      return { choices: [{ message: { parsed } }] };
    },
  });
  assert.equal(missingSpeakerCallCount, 3);
  assert.equal(missingSpeaker.subtitleSpeakerCharacterName, 'Hôte');
});

test('translateSpeech repairs a paraphrased map against the immutable translation', async () => {
  const requests = [];
  const responses = [
    {
      translation: 'The weather is lovely.',
    },
    {
      subtitleAlignmentMap: [
        { sourceText: '天气', translatedText: 'It is' },
        { sourceText: '很好。', translatedText: 'nice outside.' },
      ],
    },
  ];

  const translated = await translateSpeech('天气很好。', 'English', 'gemini-3.1-pro', {
    includeSubtitleAlignment: true,
    createChatCompletion: async (_client, request) => {
      requests.push(request);
      return {
        choices: [{ message: { parsed: responses[requests.length - 1] } }],
      };
    },
  });

  assert.equal(requests.length, 2);
  assert.deepEqual(translated, {
    text: 'The weather is lovely.',
    subtitleAlignmentMap: [
      { sourceText: '天气', translatedText: 'The weather' },
      { sourceText: '很好。', translatedText: 'is lovely.' },
    ],
    subtitleSpeakerCharacterName: null,
  });
  assert.equal(requests[0].response_format.json_schema.name, 'speech_translation');
  assert.equal(
    requests[1].response_format.json_schema.name,
    'speech_translation_alignment',
  );
  assert.equal(requests[0].messages[1].content, '天气很好。');
  assert.deepEqual(JSON.parse(requests[1].messages[1].content), {
    sourceSpeechText: '天气很好。',
    translatedSubtitleText: 'The weather is lovely.',
  });
});

test('translateSpeech retries invalid source segmentation and accepts a corrected map', async () => {
  const requests = [];
  const responses = [
    {
      translation: 'Bonjour le monde.',
    },
    {
      subtitleAlignmentMap: [
        { sourceText: 'Hello', translatedText: 'Bonjour le monde.' },
      ],
    },
    {
      subtitleAlignmentMap: [
        { sourceText: 'Hello', translatedText: 'Bonjour' },
        { sourceText: 'world.', translatedText: 'le monde.' },
      ],
    },
  ];

  const translated = await translateSpeech('Hello world.', 'French', 'gemini-3.1-pro', {
    includeSubtitleAlignment: true,
    createChatCompletion: async (_client, request) => {
      requests.push(request);
      return {
        choices: [{ message: { parsed: responses[requests.length - 1] } }],
      };
    },
  });

  assert.equal(requests.length, 3);
  assert.deepEqual(translated, {
    text: 'Bonjour le monde.',
    subtitleAlignmentMap: [
      { sourceText: 'Hello', translatedText: 'Bonjour' },
      { sourceText: 'world.', translatedText: 'le monde.' },
    ],
    subtitleSpeakerCharacterName: null,
  });
  assert.equal(requests[2].messages.length, 3);
  assert.match(
    requests[2].messages[1].content,
    /does not completely cover the source speech/,
  );
});

test('translateSpeech falls back after three invalid source-alignment attempts', async () => {
  let callCount = 0;

  const translated = await translateSpeech('Hello world.', 'French', 'gemini-3.1-pro', {
    includeSubtitleAlignment: true,
    maxValidationAttempts: 99,
    createChatCompletion: async () => {
      callCount += 1;
      return {
        choices: [{
          message: {
            parsed: callCount === 1
              ? { translation: 'Bonjour le monde.' }
              : {
                subtitleAlignmentMap: [
                  { sourceText: 'Hello', translatedText: 'Bonjour le monde.' },
                ],
              },
          },
        }],
      };
    },
  });

  assert.equal(callCount, 4);
  assert.deepEqual(translated.subtitleAlignmentMap, [
    { sourceText: 'Hello world.', translatedText: 'Bonjour le monde.' },
  ]);
});

test('translateSpeech does not retry alignment provider failures', async () => {
  const providerError = new Error('provider unavailable');
  let callCount = 0;

  await assert.rejects(
    translateSpeech('Hello.', 'French', 'gemini-3.1-pro', {
      includeSubtitleAlignment: true,
      createChatCompletion: async () => {
        callCount += 1;
        if (callCount === 1) {
          return {
            choices: [{ message: { parsed: { translation: 'Bonjour.' } } }],
          };
        }
        throw providerError;
      },
    }),
    (error) => error === providerError,
  );

  assert.equal(callCount, 2);
});

test('translateSpeech ignores alignment metadata when detected speech already uses the target language', async () => {
  const original = 'Bonjour.';
  const resolved = await translateSpeech(original, 'French', 'gemini-3.1-pro', {
    detectSourceLanguage: true,
    returnMetadata: true,
    targetLanguageCode: 'fr',
    includeSubtitleAlignment: true,
    speakerCharacterName: 'Narrator',
    createChatCompletion: async () => ({
      choices: [{
        message: {
          parsed: {
            sourceLanguage: 'fra',
            translation: 'The model changed it.',
            subtitleAlignmentMap: [],
            subtitleSpeakerCharacterName: '',
          },
        },
      }],
    }),
  });

  assert.deepEqual(resolved, {
    text: original,
    sourceLanguage: 'fr',
    translationRequired: false,
    subtitleAlignmentMap: [],
    subtitleSpeakerCharacterName: null,
  });
});

test('translateSpeech repairs or falls back from missing and extra mapping coverage', async () => {
  const scenarios = [
    {
      name: 'missing source',
      map: [{ sourceText: 'Hello', translatedText: 'Bonjour le monde.' }],
    },
    {
      name: 'extra source',
      map: [{ sourceText: 'Hello world extra', translatedText: 'Bonjour le monde.' }],
    },
    {
      name: 'missing translation',
      map: [{ sourceText: 'Hello world.', translatedText: 'Bonjour' }],
    },
    {
      name: 'extra translation',
      map: [{ sourceText: 'Hello world.', translatedText: 'Bonjour le monde extra' }],
    },
  ];

  for (const scenario of scenarios) {
    const translated = await translateSpeech('Hello world.', 'French', 'gemini-3.1-pro', {
      includeSubtitleAlignment: true,
      maxValidationAttempts: 1,
      createChatCompletion: async () => ({
        choices: [{
          message: {
            parsed: {
              translation: 'Bonjour le monde.',
              subtitleAlignmentMap: scenario.map,
            },
          },
        }],
      }),
    });
    assert.deepEqual(
      translated.subtitleAlignmentMap,
      [{ sourceText: 'Hello world.', translatedText: 'Bonjour le monde.' }],
      scenario.name,
    );
  }
});

test('translateSpeech accepts complete mappings across punctuation, case, spacing, and no-space scripts', async () => {
  const thai = await translateSpeech('HELLO, world!', 'Thai', 'gemini-3.1-pro', {
    includeSubtitleAlignment: true,
    createChatCompletion: async () => ({
      choices: [{
        message: {
          parsed: {
            translation: 'สวัสดี โลก!',
            subtitleAlignmentMap: [
              { sourceText: 'hello', translatedText: 'สวัสดี' },
              { sourceText: 'WORLD', translatedText: 'โลก' },
            ],
          },
        },
      }],
    }),
  });
  assert.equal(thai.text, 'สวัสดี โลก!');

  const japanese = await translateSpeech('夜が明ける。', 'English', 'QWEN3.7', {
    includeSubtitleAlignment: true,
    createChatCompletion: async () => ({
      choices: [{
        message: {
          parsed: {
            translation: 'Dawn breaks.',
            subtitleAlignmentMap: [
              { sourceText: '夜が', translatedText: 'Dawn' },
              { sourceText: '明ける', translatedText: 'breaks' },
            ],
          },
        },
      }],
    }),
  });
  assert.equal(japanese.text, 'Dawn breaks.');
});

test('translateSpeech coverage repair preserves semantically significant combining marks', async () => {
  const translated = await translateSpeech('Water', 'Thai', 'gemini-3.1-pro', {
    includeSubtitleAlignment: true,
    createChatCompletion: async () => ({
      choices: [{
        message: {
          parsed: {
            translation: 'น้ำ',
            subtitleAlignmentMap: [{ sourceText: 'Water', translatedText: 'นำ' }],
          },
        },
      }],
    }),
  });

  assert.deepEqual(translated.subtitleAlignmentMap, [
    { sourceText: 'Water', translatedText: 'น้ำ' },
  ]);
});
