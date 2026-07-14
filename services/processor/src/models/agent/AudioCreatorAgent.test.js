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
