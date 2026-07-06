import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveVisionImageUrl } from './VisionUtils.js';

function restoreEnv(previousEnv) {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

test('docker vision resolves local media references to the public tunnel URL', async () => {
  const previousEnv = {
    CURRENT_ENV: process.env.CURRENT_ENV,
    MEDIA_PUBLIC_URL: process.env.MEDIA_PUBLIC_URL,
    STATIC_CDN_URL: process.env.STATIC_CDN_URL,
    SAMSAR_INTERNAL_MEDIA_BASE_URL: process.env.SAMSAR_INTERNAL_MEDIA_BASE_URL,
  };

  try {
    process.env.CURRENT_ENV = 'docker';
    process.env.MEDIA_PUBLIC_URL = 'https://public-tunnel.example.com';
    process.env.STATIC_CDN_URL = 'http://localhost:8080/';
    process.env.SAMSAR_INTERNAL_MEDIA_BASE_URL = 'http://media-gateway';

    assert.equal(
      await resolveVisionImageUrl('/assets_v2/generations/session/frame.png'),
      'https://public-tunnel.example.com/assets_v2/generations/session/frame.png',
    );
    assert.equal(
      await resolveVisionImageUrl('http://localhost:8080/assets_v2/generations/session/frame.png'),
      'https://public-tunnel.example.com/assets_v2/generations/session/frame.png',
    );
    assert.equal(
      await resolveVisionImageUrl('http://media-gateway/assets_v2/generations/session/frame.png'),
      'https://public-tunnel.example.com/assets_v2/generations/session/frame.png',
    );
  } finally {
    restoreEnv(previousEnv);
  }
});

test('docker vision keeps already public image URLs unchanged', async () => {
  const previousEnv = {
    CURRENT_ENV: process.env.CURRENT_ENV,
    MEDIA_PUBLIC_URL: process.env.MEDIA_PUBLIC_URL,
  };

  try {
    process.env.CURRENT_ENV = 'docker';
    process.env.MEDIA_PUBLIC_URL = 'https://public-tunnel.example.com';

    assert.equal(
      await resolveVisionImageUrl('https://public-tunnel.example.com/assets_v2/generations/session/frame.png'),
      'https://public-tunnel.example.com/assets_v2/generations/session/frame.png',
    );
    assert.equal(
      await resolveVisionImageUrl('https://bucket.s3.amazonaws.com/assets_v2/generations/session/frame.png'),
      'https://bucket.s3.amazonaws.com/assets_v2/generations/session/frame.png',
    );
  } finally {
    restoreEnv(previousEnv);
  }
});
