import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildStudioSessionDetailsFromStatus,
  fetchDetailedVideoGenerationStatus,
} from './videoGenerationStatus.mjs';

test('detailed status falls back from the step route to the generic route', async () => {
  const calls = [];
  const axiosClient = {
    async get(url) {
      calls.push(url);
      if (calls.length === 1) {
        const error = new Error('not a step request');
        error.response = { status: 404 };
        throw error;
      }
      return { data: { status: 'PENDING' } };
    },
  };

  const result = await fetchDetailedVideoGenerationStatus({
    axiosClient,
    apiServer: 'https://api.example.test/',
    requestId: 'session id',
    headers: { headers: { Authorization: 'test' } },
  });

  assert.equal(result.status, 'PENDING');
  assert.match(calls[0], /\/v2\/video\/step\/session%20id\/status_detailed$/);
  assert.match(calls[1], /\/v2\/status_detailed\?request_id=session\+id$/);
});

test('status preview is converted into Studio layers with partial image and video assets', () => {
  const session = buildStudioSessionDetailsFromStatus({
    session_id: 'session-1',
    status: 'FAILED',
    expressGenerationError: 'provider rejected one clip',
    expressGenerationStatus: { ai_video_generation: 'FAILED' },
    session: {
      aspectRatio: '16:9',
      layers: [{
        id: 'layer-1',
        startTime: 3,
        duration: 5,
        image: {
          status: 'COMPLETED',
          url: 'https://static.example/image.png',
          items: [{ id: 'image-1', url: 'https://static.example/image.png', isPrimary: true }],
        },
        aiVideo: { status: 'COMPLETED', url: 'https://static.example/video.mp4' },
      }],
    },
  });

  assert.equal(session._id, 'session-1');
  assert.equal(session.expressGenerationFailed, true);
  assert.equal(session.layers[0]._id, 'layer-1');
  assert.equal(session.layers[0].durationOffset, 3);
  assert.equal(session.layers[0].imageSession.activeItemList[0].src, 'https://static.example/image.png');
  assert.equal(session.layers[0].aiVideoRemoteLink, 'https://static.example/video.mp4');
});
