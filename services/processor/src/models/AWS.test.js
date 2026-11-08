import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  __testOnly__,
  buildSecureMediaDeliveryUrl,
  getPublicationsMediaConfig,
} from './AWS.js';

const ENV_KEYS = [
  'CURRENT_ENV',
  'SAMSAR_MEDIA_DELIVERY_MODE',
  'MEDIA_DELIVERY_MODE',
  'PROCESSOR_API',
  'PROCESSOR_URL',
  'API_SERVER',
  'SAMSAR_DOCKER_PUBLIC_PROCESSOR_BASE_URL',
  'SAMSAR_DOCKER_PUBLIC_ASSET_BASE_URL',
  'MEDIA_BUCKET_NAME',
  'STATIC_CDN_BUCKET',
  'STATIC_CDN_URL',
  'SAMSAR_EXTERNAL_MEDIA_BUCKET',
  'SAMSAR_EXTERNAL_MEDIA_PUBLIC_BASE_URL',
  'SAMSAR_PUBLIC_MEDIA_BASE_URL',
  'SAMSAR_S3_OBJECT_TAGGING_SUPPORTED',
  'SAMSAR_ASSETS_V2_ROOT',
];

function withEnv(overrides, callback) {
  const snapshot = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  ENV_KEYS.forEach((key) => delete process.env[key]);
  Object.assign(process.env, overrides);
  try {
    return callback();
  } finally {
    ENV_KEYS.forEach((key) => {
      if (snapshot[key] === undefined) delete process.env[key];
      else process.env[key] = snapshot[key];
    });
  }
}

test('Docker-local persistence returns the stable processor URL and never the provider tunnel', () => {
  withEnv({
    CURRENT_ENV: 'docker',
    SAMSAR_MEDIA_DELIVERY_MODE: 'docker-local',
    PROCESSOR_URL: 'http://localhost:3002',
    API_SERVER: 'https://temporary-provider-tunnel.example',
  }, () => {
    assert.equal(
      __testOnly__.buildMediaDeliveryUrl('assets_v2/user_resources/user-1/video.mp4'),
      'http://localhost:3002/assets_v2/user_resources/user-1/video.mp4',
    );
    assert.deepEqual(getPublicationsMediaConfig(), {
      bucketName: 'samsar-resources',
      cdnUrl: 'http://localhost:3002',
      region: 'us-west-2',
      keyPrefix: 'published',
      configured: true,
      deliveryMode: 'docker-local',
      externalStorageConfigured: false,
    });
  });
});

test('Docker external-S3 delivery fails closed without explicit bucket and HTTPS CDN', () => {
  withEnv({
    CURRENT_ENV: 'docker',
    SAMSAR_MEDIA_DELIVERY_MODE: 'external-s3',
  }, () => {
    assert.equal(getPublicationsMediaConfig().configured, false);
    assert.throws(
      () => __testOnly__.buildMediaDeliveryUrl('assets_v2/user_resources/user-1/video.mp4'),
      /requires an explicit bucket and public HTTPS CDN URL/,
    );
  });
});

test('Docker external-S3 delivery uses only the explicitly configured CDN', () => {
  withEnv({
    CURRENT_ENV: 'docker',
    SAMSAR_MEDIA_DELIVERY_MODE: 'external-s3',
    MEDIA_BUCKET_NAME: 'customer-media',
    STATIC_CDN_URL: 'https://media.customer.example/',
  }, () => {
    assert.equal(
      __testOnly__.buildMediaDeliveryUrl('assets_v2/user_resources/user-1/video.mp4'),
      'https://media.customer.example/assets_v2/user_resources/user-1/video.mp4',
    );
    assert.equal(getPublicationsMediaConfig().externalStorageConfigured, true);
  });
});

test('Backblaze path-prefixed public URLs remain idempotent', () => {
  withEnv({
    CURRENT_ENV: 'docker',
    SAMSAR_MEDIA_DELIVERY_MODE: 'external-s3',
    MEDIA_BUCKET_NAME: 'my-bucket',
    STATIC_CDN_URL: 'https://f000.backblazeb2.com/file/my-bucket/',
  }, () => {
    const publicUrl = 'https://f000.backblazeb2.com/file/my-bucket/assets_v2/session/image.png';
    assert.equal(buildSecureMediaDeliveryUrl(publicUrl), publicUrl);
    assert.equal(
      buildSecureMediaDeliveryUrl('assets_v2/session/image one.png'),
      'https://f000.backblazeb2.com/file/my-bucket/assets_v2/session/image%20one.png',
    );
  });
});

test('Backblaze-compatible storage disables unsupported S3 object tagging explicitly', () => {
  withEnv({ SAMSAR_S3_OBJECT_TAGGING_SUPPORTED: 'false' }, () => {
    assert.equal(__testOnly__.shouldUseS3ObjectTagging(), false);
  });
  withEnv({}, () => {
    assert.equal(__testOnly__.shouldUseS3ObjectTagging(), true);
  });
});

test('CloudFront signing caps the refresh bucket below a short configured TTL', () => {
  const ttlSeconds = 15 * 60;
  const refreshIntervalSeconds = __testOnly__.resolveCloudFrontSignedUrlRefreshIntervalSeconds({
    ttlSeconds,
    configuredRefreshIntervalSeconds: Number.NaN,
  });

  assert.equal(refreshIntervalSeconds, ttlSeconds / 2);

  const nowSeconds = (60 * 60) + ttlSeconds + 147;
  const expiresAt = __testOnly__.getCloudFrontSignedUrlExpirationSeconds(nowSeconds, {
    ttlSeconds,
    refreshIntervalSeconds,
  });

  assert.ok(expiresAt > nowSeconds);
  assert.ok(expiresAt - nowSeconds >= ttlSeconds / 2);
});

async function mediaFixture(t, value = 'copied-video-bytes') {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cloned-media-publication-'));
  t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'clip.mp4');
  await fs.promises.writeFile(filePath, value);
  return { directory, filePath };
}

function setTestMediaEnv(t, overrides) {
  const snapshot = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  ENV_KEYS.forEach((key) => delete process.env[key]);
  Object.assign(process.env, overrides);
  t.after(() => ENV_KEYS.forEach((key) => {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }));
}

test('copied media is streamed to its secure remote key before CDN readiness is checked', async (t) => {
  const { filePath } = await mediaFixture(t);
  const objects = new Map();
  const events = [];
  const key = 'assets_v2/user_resources/owner/ai_videos/new-session/new-layer/clip.mp4';
  const publish = __testOnly__.createMediaFilePublisher({
    useLocalMedia: () => false,
    bucketName: 'configured-media-bucket',
    getClient: () => ({ async send(command) {
      const input = command.input;
      assert.equal(input.Bucket, 'configured-media-bucket');
      assert.equal(input.Key, key);
      assert.equal(input.ContentType, 'video/mp4');
      assert.equal(input.ContentLength, Buffer.byteLength('copied-video-bytes'));
      assert.equal(typeof input.Body.pipe, 'function');
      const chunks = [];
      for await (const chunk of input.Body) chunks.push(chunk);
      objects.set(input.Key, Buffer.concat(chunks).toString());
      events.push('uploaded');
    } }),
    buildUrl: (objectKey) => `https://configured-cdn.example/${objectKey}`,
    primeUrl: async (url) => {
      assert.equal(url, `https://configured-cdn.example/${key}`);
      assert.equal(objects.get(key), 'copied-video-bytes');
      events.push('readable');
    },
  });
  assert.equal(await publish({ filePath, key: key.slice('assets_v2/'.length) }),
    `https://configured-cdn.example/${key}`);
  assert.deepEqual(events, ['uploaded', 'readable']);
  assert.equal(await fs.promises.readFile(filePath, 'utf8'), 'copied-video-bytes');
  // Canonical secure keys are idempotent, without a second assets_v2 prefix.
  await publish({ filePath, key });
  assert.equal(objects.size, 1);
});

test('copied media publication propagates upload and CDN readiness failures', async (t) => {
  const { filePath } = await mediaFixture(t);
  let primed = false;
  const failedUpload = __testOnly__.createMediaFilePublisher({
    useLocalMedia: () => false,
    getClient: () => ({ send: async () => { throw new Error('upload rejected'); } }),
    buildUrl: () => 'https://configured-cdn.example/clip.mp4',
    primeUrl: async () => { primed = true; },
  });
  await assert.rejects(failedUpload({ filePath, key: 'user_resources/owner/clip.mp4' }), /upload rejected/);
  assert.equal(primed, false);
  const failedCdn = __testOnly__.createMediaFilePublisher({
    useLocalMedia: () => false,
    getClient: () => ({ send: async (command) => {
      for await (const chunk of command.input.Body) { assert.ok(chunk.length); }
    } }),
    buildUrl: () => 'https://configured-cdn.example/clip.mp4',
    primeUrl: async () => { throw new Error('CDN cache prime returned status 403'); },
  });
  await assert.rejects(failedCdn({ filePath, key: 'user_resources/owner/clip.mp4' }), /status 403/);
});

test('Docker-local copied media uses the new mounted object and stable processor URL without remote calls', async (t) => {
  const { directory, filePath } = await mediaFixture(t);
  const assetsRoot = path.join(directory, 'assets_v2');
  setTestMediaEnv(t, {
    CURRENT_ENV: 'docker', SAMSAR_MEDIA_DELIVERY_MODE: 'docker-local',
    PROCESSOR_URL: 'http://localhost:3002',
    API_SERVER: 'https://temporary-provider-tunnel.example',
    SAMSAR_ASSETS_V2_ROOT: assetsRoot,
  });
  const publish = __testOnly__.createMediaFilePublisher({
    getClient: () => { throw new Error('S3 must not be called'); },
    primeUrl: async () => { throw new Error('CDN must not be called'); },
  });
  const key = 'user_resources/owner/ai_videos/new-session/new-layer/clip.mp4';
  assert.equal(await publish({ filePath, key }), `http://localhost:3002/assets_v2/${key}`);
  assert.equal(await fs.promises.readFile(path.join(assetsRoot, key), 'utf8'), 'copied-video-bytes');
  assert.equal(await fs.promises.readFile(filePath, 'utf8'), 'copied-video-bytes');
});

test('explicit external bucket and CDN publish mounted Docker input remotely', async (t) => {
  const { filePath } = await mediaFixture(t);
  setTestMediaEnv(t, {
    CURRENT_ENV: 'docker', MEDIA_BUCKET_NAME: 'configured-media-bucket',
    STATIC_CDN_URL: 'https://configured-cdn.example',
  });
  let uploads = 0;
  const publish = __testOnly__.createMediaFilePublisher({
    getClient: () => ({ send: async (command) => {
      for await (const chunk of command.input.Body) { assert.ok(chunk.length); }
      uploads++;
    } }),
    persistLocalFile: async () => { throw new Error('Must publish to configured remote storage'); },
    buildUrl: (key) => `https://configured-cdn.example/${key}`,
    primeUrl: async () => {},
  });
  assert.match(await publish({ filePath, key: 'user_resources/owner/clip.mp4' }), /^https:\/\/configured-cdn\.example\//);
  assert.equal(uploads, 1);
});

test('missing, empty and unsafe copied-media inputs fail before publication', async (t) => {
  const { directory, filePath } = await mediaFixture(t, '');
  let calls = 0;
  const publish = __testOnly__.createMediaFilePublisher({
    getClient: () => { calls++; throw new Error('must not upload'); },
    useLocalMedia: () => false,
  });
  await assert.rejects(publish({ filePath, key: 'user_resources/owner/empty.mp4' }), /nonempty file/);
  await assert.rejects(publish({ filePath: path.join(directory, 'missing.mp4'), key: 'user_resources/owner/missing.mp4' }), { code: 'ENOENT' });
  for (const key of ['../escape.mp4', 'user_resources/../escape.mp4', 'user_resources\\escape.mp4', 'clip.mp4?query=1']) {
    await assert.rejects(publish({ filePath, key }), /safe media object key/);
  }
  assert.equal(calls, 0);
});

test('CloudFront signing retains shorter explicit and safe default refresh intervals', () => {
  assert.equal(
    __testOnly__.resolveCloudFrontSignedUrlRefreshIntervalSeconds({
      ttlSeconds: 15 * 60,
      configuredRefreshIntervalSeconds: 5 * 60,
    }),
    5 * 60,
  );
  assert.equal(
    __testOnly__.resolveCloudFrontSignedUrlRefreshIntervalSeconds({
      ttlSeconds: 7 * 24 * 60 * 60,
      configuredRefreshIntervalSeconds: Number.NaN,
    }),
    60 * 60,
  );
});
