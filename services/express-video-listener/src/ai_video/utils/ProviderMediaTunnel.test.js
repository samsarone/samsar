import assert from 'node:assert/strict';
import test from 'node:test';

import { probeExactMediaUrl } from './ProviderMediaTunnel.js';

function response(url, contentType = 'image/png') {
  return {
    ok: true,
    status: 206,
    url,
    headers: { get: () => contentType },
    body: { cancel: async () => {} },
  };
}

test('exact media probe requires matching MIME and a public HTTPS final redirect', async () => {
  const source = 'https://fresh.trycloudflare.com/assets_v2/generations/frame.png';
  assert.equal(await probeExactMediaUrl(source, 'image/', {
    fetchImpl: async () => response(source, 'image/png'),
  }), true);
  assert.equal(await probeExactMediaUrl(source, 'image/', {
    fetchImpl: async () => response(source, 'video/mp4'),
  }), false);
  assert.equal(await probeExactMediaUrl(source, 'image/', {
    fetchImpl: async () => response('http://localhost:3002/assets_v2/generations/frame.png'),
  }), false);
});
