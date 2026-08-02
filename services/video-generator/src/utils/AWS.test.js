import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const DOCKER_LOCAL_ENV_KEYS = [
  'CURRENT_ENV',
  'SAMSAR_MEDIA_DELIVERY_MODE',
  'MEDIA_DELIVERY_MODE',
  'SAMSAR_ASSETS_V2_ROOT',
  'STATIC_CDN_URL',
  'SAMSAR_DOCKER_PUBLIC_ASSET_BASE_URL',
  'SAMSAR_DOCKER_PUBLIC_PROCESSOR_BASE_URL',
  'SAMSAR_DOCKER_LOCAL_MEDIA_BASE_URL',
  'SAMSAR_LOCAL_MEDIA_BASE_URL',
  'API_SERVER',
  'PUBLIC_API_BASE_URL',
  'PROCESSOR_API',
  'PROCESSOR_URL',
  'SAMSAR_EXTERNAL_MEDIA_PUBLISH_ENABLED',
  'EXTERNAL_MEDIA_PUBLISH_ENABLED',
  'MEDIA_BUCKET_NAME',
  'STATIC_CDN_BUCKET',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_CDN_REGION',
  'AWS_REGION',
];

function restoreEnv(snapshot) {
  for (const key of DOCKER_LOCAL_ENV_KEYS) {
    if (snapshot[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = snapshot[key];
    }
  }
}

test('uploadVideoToCDN returns a Docker-local public processor URL after persisting the final render', async (t) => {
  const envSnapshot = Object.fromEntries(DOCKER_LOCAL_ENV_KEYS.map((key) => [key, process.env[key]]));
  const assetsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'samsar-assets-v2-'));
  const renderRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'samsar-render-'));
  const sourcePath = path.join(renderRoot, 'final.mp4');
  const thumbnailSourcePath = path.join(renderRoot, 'thumbnail.png');
  await fs.writeFile(sourcePath, 'rendered-video');
  await fs.writeFile(thumbnailSourcePath, 'rendered-thumbnail');

  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_MEDIA_DELIVERY_MODE = 'docker-local';
  process.env.SAMSAR_ASSETS_V2_ROOT = assetsRoot;
  process.env.STATIC_CDN_URL = 'http://localhost:8080/';
  delete process.env.SAMSAR_DOCKER_PUBLIC_ASSET_BASE_URL;
  delete process.env.SAMSAR_DOCKER_PUBLIC_PROCESSOR_BASE_URL;
  delete process.env.SAMSAR_DOCKER_LOCAL_MEDIA_BASE_URL;
  delete process.env.SAMSAR_LOCAL_MEDIA_BASE_URL;
  delete process.env.API_SERVER;
  delete process.env.PUBLIC_API_BASE_URL;
  delete process.env.PROCESSOR_API;
  delete process.env.PROCESSOR_URL;
  delete process.env.MEDIA_DELIVERY_MODE;
  delete process.env.SAMSAR_EXTERNAL_MEDIA_PUBLISH_ENABLED;
  delete process.env.EXTERNAL_MEDIA_PUBLISH_ENABLED;

  t.after(async () => {
    restoreEnv(envSnapshot);
    await fs.rm(assetsRoot, { recursive: true, force: true });
    await fs.rm(renderRoot, { recursive: true, force: true });
  });

  const {
    buildBranchPublicationThumbnailKey,
    uploadBranchPublicationThumbnailToCDN,
    uploadVideoToCDN,
  } = await import(`./AWS.js?docker-local-${Date.now()}`);
  const remoteUrl = await uploadVideoToCDN(
    sourcePath,
    'assets_v2/video/output/session-1/final.mp4',
  );

  assert.equal(remoteUrl, 'http://localhost:3002/assets_v2/video/output/session-1/final.mp4');
  assert.equal(
    buildBranchPublicationThumbnailKey('session-1', 'root.1/alternate'),
    'published/session-1/branches/path-cm9vdC4xL2FsdGVybmF0ZQ/thumbnail.png',
  );
  assert.throws(
    () => buildBranchPublicationThumbnailKey('../session', 'root.1'),
    /storage-safe sessionId/,
  );
  assert.equal(
    await uploadBranchPublicationThumbnailToCDN(
      thumbnailSourcePath,
      'session-1',
      'root.1/alternate',
    ),
    'http://localhost:3002/assets_v2/published/session-1/branches/path-cm9vdC4xL2FsdGVybmF0ZQ/thumbnail.png',
  );
  process.env.PROCESSOR_API = 'http://localhost:3999/';
  assert.equal(
    await uploadVideoToCDN(sourcePath, 'assets_v2/video/output/session-1/final-override.mp4'),
    'http://localhost:3999/assets_v2/video/output/session-1/final-override.mp4',
  );
  assert.equal(
    await fs.readFile(path.join(assetsRoot, 'video/output/session-1/final.mp4'), 'utf8'),
    'rendered-video',
  );
  assert.equal(
    await fs.readFile(
      path.join(
        assetsRoot,
        'published/session-1/branches/path-cm9vdC4xL2FsdGVybmF0ZQ/thumbnail.png',
      ),
      'utf8',
    ),
    'rendered-thumbnail',
  );
});

test('path-prefixed Backblaze URLs do not become duplicated storage keys', async (t) => {
  const envSnapshot = Object.fromEntries(DOCKER_LOCAL_ENV_KEYS.map((key) => [key, process.env[key]]));
  const assetsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'samsar-b2-video-assets-'));
  const renderRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'samsar-b2-video-render-'));
  const sourcePath = path.join(renderRoot, 'final.mp4');
  await fs.writeFile(sourcePath, 'rendered-video');

  Object.assign(process.env, {
    CURRENT_ENV: 'docker',
    SAMSAR_MEDIA_DELIVERY_MODE: 'docker-local',
    MEDIA_DELIVERY_MODE: 'docker-local',
    SAMSAR_ASSETS_V2_ROOT: assetsRoot,
    SAMSAR_DOCKER_PUBLIC_PROCESSOR_BASE_URL: 'http://localhost:3002',
    STATIC_CDN_URL: 'https://f000.backblazeb2.com/file/my-bucket/',
  });
  t.after(async () => {
    restoreEnv(envSnapshot);
    await fs.rm(assetsRoot, { recursive: true, force: true });
    await fs.rm(renderRoot, { recursive: true, force: true });
  });

  const { uploadVideoToCDN } = await import(`./AWS.js?b2-prefix-${Date.now()}-${Math.random()}`);
  const publicB2Url = 'https://f000.backblazeb2.com/file/my-bucket/assets_v2/video/output/session-1/final.mp4';
  assert.equal(
    await uploadVideoToCDN(sourcePath, publicB2Url),
    'http://localhost:3002/assets_v2/video/output/session-1/final.mp4',
  );
  assert.equal(
    await fs.readFile(path.join(assetsRoot, 'video/output/session-1/final.mp4'), 'utf8'),
    'rendered-video',
  );
});

test('standalone external video uploads reject an implicit production bucket', async (t) => {
  const envSnapshot = Object.fromEntries(DOCKER_LOCAL_ENV_KEYS.map((key) => [key, process.env[key]]));
  const renderRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'samsar-external-video-render-'));
  const sourcePath = path.join(renderRoot, 'final.mp4');
  await fs.writeFile(sourcePath, 'rendered-video');

  Object.assign(process.env, {
    CURRENT_ENV: 'docker',
    SAMSAR_MEDIA_DELIVERY_MODE: 'external-s3',
    MEDIA_DELIVERY_MODE: 'external-s3',
    SAMSAR_EXTERNAL_MEDIA_PUBLISH_ENABLED: 'true',
    AWS_ACCESS_KEY_ID: 'test-access-key',
    AWS_SECRET_ACCESS_KEY: 'test-secret-key',
    AWS_CDN_REGION: 'us-east-1',
  });
  delete process.env.MEDIA_BUCKET_NAME;
  delete process.env.STATIC_CDN_BUCKET;
  delete process.env.STATIC_CDN_URL;

  t.after(async () => {
    restoreEnv(envSnapshot);
    await fs.rm(renderRoot, { recursive: true, force: true });
  });

  const { uploadVideoToCDN } = await import(`./AWS.js?external-no-bucket-${Date.now()}-${Math.random()}`);
  await assert.rejects(
    () => uploadVideoToCDN(sourcePath, 'assets_v2/video/output/session-1/final.mp4'),
    (error) => error?.code === 'SAMSAR_EXTERNAL_S3_CONFIG_INVALID' && error?.retryable === false,
  );
});
