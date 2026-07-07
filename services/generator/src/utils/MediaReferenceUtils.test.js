import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { getAccessibleMediaUrlForProvider } from './MediaReferenceUtils.js';

test('docker media URLs can prefer the internal media gateway for local provider fetches', async () => {
  const previousEnv = {
    CURRENT_ENV: process.env.CURRENT_ENV,
    SAMSAR_ASSETS_V2_ROOT: process.env.SAMSAR_ASSETS_V2_ROOT,
    MEDIA_PUBLIC_URL: process.env.MEDIA_PUBLIC_URL,
    SAMSAR_INTERNAL_MEDIA_BASE_URL: process.env.SAMSAR_INTERNAL_MEDIA_BASE_URL,
  };
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'samsar-media-ref-'));

  try {
    process.env.CURRENT_ENV = 'docker';
    process.env.SAMSAR_ASSETS_V2_ROOT = tempRoot;
    process.env.MEDIA_PUBLIC_URL = 'http://localhost:8080/';
    process.env.SAMSAR_INTERNAL_MEDIA_BASE_URL = 'http://media-gateway';

    const mediaPath = path.join(tempRoot, 'generations', 'session-id', 'frame.png');
    await fs.mkdir(path.dirname(mediaPath), { recursive: true });
    await fs.writeFile(mediaPath, Buffer.from([0]));

    const resolved = await getAccessibleMediaUrlForProvider(
      'http://localhost:8080/assets_v2/generations/session-id/frame.png',
      { preferInternalDockerUrl: true },
    );

    assert.equal(resolved, 'http://media-gateway/assets_v2/generations/session-id/frame.png');
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test('docker media URLs can prefer inline data URLs for vision requests', async () => {
  const previousEnv = {
    CURRENT_ENV: process.env.CURRENT_ENV,
    SAMSAR_ASSETS_V2_ROOT: process.env.SAMSAR_ASSETS_V2_ROOT,
    MEDIA_PUBLIC_URL: process.env.MEDIA_PUBLIC_URL,
    SAMSAR_INTERNAL_MEDIA_BASE_URL: process.env.SAMSAR_INTERNAL_MEDIA_BASE_URL,
  };
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'samsar-media-ref-'));

  try {
    process.env.CURRENT_ENV = 'docker';
    process.env.SAMSAR_ASSETS_V2_ROOT = tempRoot;
    process.env.MEDIA_PUBLIC_URL = 'http://localhost:8080/';
    process.env.SAMSAR_INTERNAL_MEDIA_BASE_URL = 'http://media-gateway';

    const mediaPath = path.join(tempRoot, 'generations', 'session-id', 'frame.png');
    await fs.mkdir(path.dirname(mediaPath), { recursive: true });
    await fs.writeFile(mediaPath, Buffer.from([1, 2, 3]));

    const resolved = await getAccessibleMediaUrlForProvider(
      'http://localhost:8080/assets_v2/generations/session-id/frame.png',
      { preferDataUrl: true, preferInternalDockerUrl: true },
    );

    assert.equal(resolved, 'data:image/png;base64,AQID');
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test('docker provider media URLs use configured public IP processor paths', async () => {
  const previousEnv = {
    CURRENT_ENV: process.env.CURRENT_ENV,
    SAMSAR_ASSETS_V2_ROOT: process.env.SAMSAR_ASSETS_V2_ROOT,
    SAMSAR_DOCKER_PUBLIC_PROCESSOR_BASE_URL: process.env.SAMSAR_DOCKER_PUBLIC_PROCESSOR_BASE_URL,
    MEDIA_PUBLIC_URL: process.env.MEDIA_PUBLIC_URL,
    SAMSAR_INTERNAL_MEDIA_BASE_URL: process.env.SAMSAR_INTERNAL_MEDIA_BASE_URL,
  };
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'samsar-media-ref-'));

  try {
    process.env.CURRENT_ENV = 'docker';
    process.env.SAMSAR_ASSETS_V2_ROOT = tempRoot;
    process.env.SAMSAR_DOCKER_PUBLIC_PROCESSOR_BASE_URL = 'http://203.0.113.10/api';
    process.env.MEDIA_PUBLIC_URL = 'http://localhost:8080/';
    process.env.SAMSAR_INTERNAL_MEDIA_BASE_URL = 'http://media-gateway';

    const mediaPath = path.join(tempRoot, 'generations', 'session-id', 'frame.png');
    await fs.mkdir(path.dirname(mediaPath), { recursive: true });
    await fs.writeFile(mediaPath, Buffer.from([0]));

    const resolved = await getAccessibleMediaUrlForProvider(
      'http://localhost:8080/assets_v2/generations/session-id/frame.png',
    );

    assert.equal(resolved, 'http://203.0.113.10/api/assets_v2/generations/session-id/frame.png');
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test('docker provider media URLs do not use private IP bases for external providers', async () => {
  const previousEnv = {
    CURRENT_ENV: process.env.CURRENT_ENV,
    SAMSAR_ASSETS_V2_ROOT: process.env.SAMSAR_ASSETS_V2_ROOT,
    SAMSAR_DOCKER_PUBLIC_PROCESSOR_BASE_URL: process.env.SAMSAR_DOCKER_PUBLIC_PROCESSOR_BASE_URL,
    MEDIA_PUBLIC_URL: process.env.MEDIA_PUBLIC_URL,
  };
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'samsar-media-ref-'));

  try {
    process.env.CURRENT_ENV = 'docker';
    process.env.SAMSAR_ASSETS_V2_ROOT = tempRoot;
    process.env.SAMSAR_DOCKER_PUBLIC_PROCESSOR_BASE_URL = 'http://192.168.1.25';
    process.env.MEDIA_PUBLIC_URL = 'http://localhost:8080/';

    const mediaPath = path.join(tempRoot, 'generations', 'session-id', 'frame.png');
    await fs.mkdir(path.dirname(mediaPath), { recursive: true });
    await fs.writeFile(mediaPath, Buffer.from([0]));

    const resolved = await getAccessibleMediaUrlForProvider(
      'http://localhost:8080/assets_v2/generations/session-id/frame.png',
    );

    assert.equal(resolved, '/assets_v2/generations/session-id/frame.png');
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});
