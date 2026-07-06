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
  await fs.writeFile(sourcePath, 'rendered-video');

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

  const { uploadVideoToCDN } = await import(`./AWS.js?docker-local-${Date.now()}`);
  const remoteUrl = await uploadVideoToCDN(
    sourcePath,
    'assets_v2/video/output/session-1/final.mp4',
  );

  assert.equal(remoteUrl, 'http://localhost:3002/assets_v2/video/output/session-1/final.mp4');
  process.env.PROCESSOR_API = 'http://localhost:3999/';
  assert.equal(
    await uploadVideoToCDN(sourcePath, 'assets_v2/video/output/session-1/final-override.mp4'),
    'http://localhost:3999/assets_v2/video/output/session-1/final-override.mp4',
  );
  assert.equal(
    await fs.readFile(path.join(assetsRoot, 'video/output/session-1/final.mp4'), 'utf8'),
    'rendered-video',
  );
});
