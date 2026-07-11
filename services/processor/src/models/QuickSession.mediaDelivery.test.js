import test from 'node:test';
import assert from 'node:assert/strict';

import { __testOnly__ } from './QuickSession.js';

test('quick session media resolution removes persisted expired CloudFront signatures', () => {
  const cdnBaseUrl = String(process.env.STATIC_CDN_URL || 'https://static.samsar.one').replace(/\/$/, '');
  const staleUrl = `${cdnBaseUrl}/assets_v2/video/output/session_123/final.mp4?Expires=1&Signature=old&Key-Pair-Id=old`;
  const resolvedUrl = __testOnly__.resolveQuickSessionMediaUrl(staleUrl);
  const parsedUrl = new URL(resolvedUrl);

  assert.equal(parsedUrl.pathname, '/assets_v2/video/output/session_123/final.mp4');
  assert.notEqual(parsedUrl.searchParams.get('Signature'), 'old');
  assert.notEqual(parsedUrl.searchParams.get('Expires'), '1');
});

test('quick session media resolution preserves third-party URLs', () => {
  const externalUrl = 'https://cdn.example.com/final.mp4?token=provider-token';
  assert.equal(__testOnly__.resolveQuickSessionMediaUrl(externalUrl), externalUrl);
});
