import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import OpenAI from 'openai';

import VideoSession from '../schema/VideoSession.js';
import { createMetaForSession } from './Publication.js';

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

test('Vidgenie Sol metadata generation keeps the baseline GPT 5.6 Luna xhigh request', async (t) => {
  forceNativeOpenAIForTest(t);
  const originalReadyState = mongoose.connection.readyState;
  mongoose.connection.readyState = 1;
  t.after(() => {
    mongoose.connection.readyState = originalReadyState;
  });

  const sessionId = '507f1f77bcf86cd799439012';
  t.mock.method(VideoSession, 'findById', async (id) => {
    assert.equal(id, sessionId);
    return {
      _id: sessionId,
      userId: '507f1f77bcf86cd799439011',
      expressGenerationInferenceModel: 'gpt-5.6-sol',
      inputPrompt: 'A careful walk through a difficult engineering concept.',
      movieResourceList: {
        scenes: [{ visual: 'An engineer annotates a blueprint.' }],
        sounds: [{ type: 'speech', sceneIndex: 0, audio: 'Start with the constraints.' }],
      },
    };
  });

  let requestBody = null;
  t.mock.method(OpenAI.prototype, 'post', async (path, options) => {
    assert.equal(path, '/responses');
    requestBody = options.body;
    return {
      id: 'publication-meta-response',
      model: 'gpt-5.6-luna',
      output_text: JSON.stringify({
        title: 'Blueprint First',
        description: 'An engineer explains how constraints guide a sound design.',
      }),
    };
  });

  const result = await createMetaForSession(
    '507f1f77bcf86cd799439011',
    { sessionId },
  );

  assert.deepEqual(result, {
    title: 'Blueprint First',
    description: 'An engineer explains how constraints guide a sound design.',
  });
  assert.equal(requestBody.model, 'gpt-5.6-luna');
  assert.deepEqual(requestBody.reasoning, { effort: 'xhigh' });
});
