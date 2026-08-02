import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function readText(relativePath) {
  return fs.readFile(path.join(root, relativePath), 'utf8');
}

const storageModules = [
  'services/generator/src/utils/AWS.js',
  'services/audio-generator/src/AWS.js',
  'services/video-generator/src/utils/AWS.js',
  'services/ai-video-layer-generator/src/AWS.js',
  'services/express-video-listener/src/ai_utils/AWS.js',
  'services/express-video-listener/src/ai_video/utils/AWS.js',
  'services/express-video-listener/src/audio/AWS.js',
  'services/processor/src/models/AWS.js',
];

test('all standalone media storage clients route Backblaze master keys through Native B2', async () => {
  const modules = await Promise.all(storageModules.map(readText));
  modules.forEach((source, index) => {
    assert.match(source, /createBackblazeNativeClientFromEnv/,
      `${storageModules[index]} must create the Native B2 client`);
    assert.match(source, /shouldUseBackblazeNativeApi/,
      `${storageModules[index]} must select storage by saved key type`);
  });
});

test('large media uploads avoid S3 multipart commands for Backblaze master keys', async () => {
  const [video, layer, expressVideo, expressAudio] = await Promise.all([
    readText('services/video-generator/src/utils/AWS.js'),
    readText('services/ai-video-layer-generator/src/AWS.js'),
    readText('services/express-video-listener/src/ai_video/utils/AWS.js'),
    readText('services/express-video-listener/src/audio/AWS.js'),
  ]);
  assert.match(video, /shouldUseBackblazeNativeApi\(\)[\s\S]*PutObjectCommand/);
  assert.match(layer, /shouldUseBackblazeNativeApi\(\)[\s\S]*PutObjectCommand/);
  assert.match(expressVideo, /MULTIPART_UPLOAD_THRESHOLD_BYTES && !shouldUseBackblazeNativeApi\(\)/);
  assert.match(expressAudio, /shouldUseBackblazeNativeApi\(\)[\s\S]*PutObjectCommand/);
});

test('Docker builds and runtime configuration include the shared Native B2 adapter', async () => {
  const [dockerfile, renderer] = await Promise.all([
    readText('Dockerfile'),
    readText('scripts/generate-runtime-config.mjs'),
  ]);
  assert.match(dockerfile, /RUN npm ci[\s\S]*COPY packages\/backblaze-native-client\/ \/app\/node_modules\/@samsar\/backblaze-native-client\//);
  assert.match(renderer, /SAMSAR_BACKBLAZE_CREDENTIAL_TYPE: backblazeCredentialType/);
});
