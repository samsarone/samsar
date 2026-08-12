import assert from 'node:assert/strict';
import test from 'node:test';

import { createStudioSession } from './studioSessionApi.js';

test('Studio creation preserves the processor-created initial layer', async () => {
  const calls = [];
  const session = { _id: 'studio-1', layers: [{ _id: 'layer-1' }] };
  const httpClient = {
    async post(...args) {
      calls.push(args);
      return { data: session };
    },
  };

  const result = await createStudioSession({
    processorServer: 'http://processor',
    headers: { headers: { Authorization: 'Bearer test' } },
    payload: { prompts: [] },
    httpClient,
  });

  assert.equal(result, session);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'http://processor/video_sessions/create_video_session');
});

test('Studio creation repairs an empty create response before navigation', async () => {
  const calls = [];
  const httpClient = {
    async post(url, payload, headers) {
      calls.push({ url, payload, headers });
      if (url.endsWith('/create_video_session')) {
        return { data: { _id: 'studio-2', layers: [], defaultSceneDuration: 4 } };
      }
      return {
        data: {
          session: {
            _id: 'studio-2',
            layers: [{ _id: 'layer-2' }],
          },
        },
      };
    },
  };

  const result = await createStudioSession({
    processorServer: 'http://processor',
    headers: { headers: { Authorization: 'Bearer test' } },
    payload: { prompts: [] },
    httpClient,
  });

  assert.equal(result.layers.length, 1);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].payload, {
    sessionId: 'studio-2',
    duration: 4,
    position: 'end',
  });
});

test('Studio creation verifies persisted details when the response omits layers', async () => {
  let getCount = 0;
  const httpClient = {
    async post() {
      return { data: { _id: 'studio-3' } };
    },
    async get() {
      getCount += 1;
      return { data: { _id: 'studio-3', layers: [{ _id: 'layer-3' }] } };
    },
  };

  const result = await createStudioSession({
    processorServer: 'http://processor',
    headers: {},
    httpClient,
  });

  assert.equal(result.layers.length, 1);
  assert.equal(getCount, 1);
});
