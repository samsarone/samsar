import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import OpenAI from 'openai';
import { ElevenLabsClient } from 'elevenlabs';

for (const file of ['OpenAI.js', 'OpenAITTS.js', 'AvatarVoiceoverSpeech.js']) {
  for (const failure of ['503', 'ECONNRESET']) {
    test(`${file} sends one speech POST after ${failure}`, async () => {
      let posts = 0;
      const openai = new OpenAI({ apiKey: 'mock-only', fetch: async (_url, options) => {
        assert.equal(options.method, 'POST');
        posts++;
        if (failure === 'ECONNRESET') throw Object.assign(new Error('mock reset'), { code: 'ECONNRESET' });
        return new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } });
      } });
      const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
      const call = source.match(/openai\.audio\.speech\.create\([\s\S]*?\);/)[0].slice(0, -1);
      const inputPayload = { model: 'tts-1', voice: 'alloy', input: 'mock' };
      const promise = new Function('openai', 'inputPayload', 'requestPayload', 'prompt', 'speaker',
        `return (async () => ${call})()`)(openai, inputPayload, inputPayload, 'mock', 'alloy');
      await assert.rejects(promise);
      assert.equal(posts, 1);
    });
  }
}

for (const failure of ['503', 'ECONNRESET']) {
  test(`native ElevenLabs sends one speech POST after ${failure}`, async t => {
    let posts = 0;
    // The installed SDK leaves its request deadline timer alive on a rejected
    // fetch. Virtual time keeps this mocked transport test independent of it.
    t.mock.timers.enable({ apis: ['setTimeout'] });
    t.mock.method(globalThis, 'fetch', async (_url, options) => {
      assert.equal(options.method, 'POST');
      posts++;
      if (failure === 'ECONNRESET') throw Object.assign(new Error('mock reset'), { code: 'ECONNRESET' });
      return new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } });
    });
    const source = fs.readFileSync(new URL('ElevenLabs.js', import.meta.url), 'utf8');
    const call = source.match(/client\.textToSpeech\.convert\([\s\S]*?\);/)[0].slice(0, -1);
    const promise = new Function('client', 'speaker', 'prompt', 'outputFormat', 'modelID',
      `return (async () => ${call})()`)(new ElevenLabsClient({ apiKey: 'mock-only' }),
      'mock-voice', 'mock', 'mp3_44100_128', 'eleven_multilingual_v2');
    await assert.rejects(promise);
    assert.equal(posts, 1);
    t.mock.timers.runAll();
  });
}
