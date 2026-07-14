import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getVideoPostProcessingRequestUrls,
  isMissingVideoPostProcessingRoute,
} from './videoPostProcessingApi.mjs';

test('builds v2 and legacy video post-processing URLs without duplicate slashes', () => {
  assert.deepEqual(
    getVideoPostProcessingRequestUrls('https://processor.example/', '/add_subtitles/'),
    {
      primaryUrl: 'https://processor.example/v2/add_subtitles',
      legacyUrl: 'https://processor.example/v1/video/add_subtitles',
    },
  );
});

test('only retries a legacy endpoint for an Express missing-route 404', () => {
  const primaryUrl = 'https://processor.example/v2/add_subtitles';
  const missingRouteError = {
    response: {
      status: 404,
      data: '<pre>Cannot POST /v2/add_subtitles</pre>',
    },
  };

  assert.equal(isMissingVideoPostProcessingRoute(missingRouteError, primaryUrl), true);
  assert.equal(isMissingVideoPostProcessingRoute({
    response: { status: 404, data: '{"message":"Cannot POST /v2/add_subtitles"}' },
  }, primaryUrl), true);
  assert.equal(isMissingVideoPostProcessingRoute({
    response: { status: 404, data: { message: 'Video session not found.' } },
  }, primaryUrl), false);
  assert.equal(isMissingVideoPostProcessingRoute({
    response: { status: 500, data: '<pre>Cannot POST /v2/add_subtitles</pre>' },
  }, primaryUrl), false);
});
