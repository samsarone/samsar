import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  collectSubtitleAudioSourceReferences,
  normalizeTrustedSubtitleAudioObjectKey,
  resolveSubtitleAudioSource,
  shouldUseSubtitleObjectStorageRecovery,
} from './SubtitleAudioSource.js';

async function makeTempDirectory(prefix) {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), prefix));
}

test('collects selected and fallback remote audio references before local keys', () => {
  const references = collectSubtitleAudioSourceReferences({
    selectedLocalAudioLink: 'video/audio/session/layer/speech.mp3',
    selectedRemoteAudioLink: 'https://static.samsar.one/assets_v2/temp_audio/selected.mp3',
    remoteAudioLinks: [
      'https://static.samsar.one/assets_v2/temp_audio/selected.mp3',
      'https://static.samsar.one/assets_v2/temp_audio/fallback.mp3',
    ],
    remoteAudioData: [{ audio_url: 'https://static.samsar.one/assets_v2/temp_audio/data.mp3' }],
  });

  assert.deepEqual(references, [
    'https://static.samsar.one/assets_v2/temp_audio/selected.mp3',
    'https://static.samsar.one/assets_v2/temp_audio/fallback.mp3',
    'https://static.samsar.one/assets_v2/temp_audio/data.mp3',
    'video/audio/session/layer/speech.mp3',
  ]);
});

test('normalizes expired private CDN audio URLs without retaining their signature', () => {
  const key = normalizeTrustedSubtitleAudioObjectKey(
    'https://static.samsar.one/assets_v2/temp_audio/speech.mp3' +
      '?Expires=1&Signature=expired&Key-Pair-Id=old',
  );

  assert.equal(key, 'assets_v2/temp_audio/speech.mp3');
});

test('rejects arbitrary remote URLs and traversal-like media keys', () => {
  assert.equal(
    normalizeTrustedSubtitleAudioObjectKey(
      'https://attacker.example/assets_v2/temp_audio/speech.mp3',
    ),
    null,
  );
  assert.equal(
    normalizeTrustedSubtitleAudioObjectKey(
      'https://static.samsar.one/assets_v2/temp_audio/%2e%2e/private.key',
    ),
    null,
  );
  assert.equal(
    normalizeTrustedSubtitleAudioObjectKey('assets_v2/temp_images/not-audio.png'),
    null,
  );
});

test('uses an existing audio file under a trusted local asset root without copying it', async (t) => {
  const assetRoot = await makeTempDirectory('samsar-subtitle-local-');
  t.after(() => fs.promises.rm(assetRoot, { recursive: true, force: true }));
  const audioPath = path.join(assetRoot, 'video', 'audio', 'session', 'speech.mp3');
  await fs.promises.mkdir(path.dirname(audioPath), { recursive: true });
  await fs.promises.writeFile(audioPath, Buffer.from('local-audio'));

  let objectReadCount = 0;
  const result = await resolveSubtitleAudioSource({
    audioLayer: {
      selectedLocalAudioLink: 'video/audio/session/speech.mp3',
      selectedRemoteAudioLink: 'https://static.samsar.one/assets_v2/temp_audio/remote.mp3',
    },
    preferredLocalFilePath: audioPath,
    trustedLocalRoots: [assetRoot],
    getObject: async () => {
      objectReadCount += 1;
      throw new Error('should not read storage');
    },
  });

  assert.equal(result.filePath, await fs.promises.realpath(audioPath));
  assert.equal(result.isTemporary, false);
  assert.equal(objectReadCount, 0);
  await result.cleanup();
  assert.equal(await fs.promises.readFile(audioPath, 'utf8'), 'local-audio');
});

test('Docker-local subtitle recovery never falls through to the implicit hosted bucket', async () => {
  const envKeys = [
    'CURRENT_ENV',
    'SAMSAR_MEDIA_DELIVERY_MODE',
    'MEDIA_DELIVERY_MODE',
    'MEDIA_BUCKET_NAME',
    'STATIC_CDN_BUCKET',
    'STATIC_CDN_URL',
  ];
  const snapshot = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_MEDIA_DELIVERY_MODE = 'docker-local';
  delete process.env.MEDIA_BUCKET_NAME;
  delete process.env.STATIC_CDN_BUCKET;
  delete process.env.STATIC_CDN_URL;
  let objectReadCount = 0;
  try {
    assert.equal(shouldUseSubtitleObjectStorageRecovery(), false);
    await assert.rejects(
      resolveSubtitleAudioSource({
        audioLayer: {
          _id: { toString: () => 'audio-local-missing' },
          selectedRemoteAudioLink: 'https://static.samsar.one/assets_v2/temp_audio/missing.mp3',
        },
        trustedLocalRoots: [],
        getObject: async () => {
          objectReadCount += 1;
          return { Body: Buffer.from('unexpected') };
        },
      }),
      (error) => error?.code === 'SAMSAR_SUBTITLE_LOCAL_MEDIA_UNAVAILABLE',
    );
    assert.equal(objectReadCount, 0);
  } finally {
    envKeys.forEach((key) => {
      if (snapshot[key] === undefined) delete process.env[key];
      else process.env[key] = snapshot[key];
    });
  }
});

test('Docker subtitle object recovery requires explicit bucket and HTTPS CDN', () => {
  assert.equal(shouldUseSubtitleObjectStorageRecovery({
    CURRENT_ENV: 'docker',
    SAMSAR_MEDIA_DELIVERY_MODE: 'external-s3',
  }), false);
  assert.equal(shouldUseSubtitleObjectStorageRecovery({
    CURRENT_ENV: 'docker',
    SAMSAR_MEDIA_DELIVERY_MODE: 'external-s3',
    MEDIA_BUCKET_NAME: 'customer-media',
    STATIC_CDN_URL: 'https://media.customer.example',
  }), true);
});

test('canonicalizes an assets_v2 local link instead of nesting it below the legacy assets root', async (t) => {
  const processorRoot = await makeTempDirectory('samsar-subtitle-assets-v2-');
  t.after(() => fs.promises.rm(processorRoot, { recursive: true, force: true }));
  const assetsV2Root = path.join(processorRoot, 'assets_v2');
  const legacyAssetsRoot = path.join(processorRoot, 'assets');
  const relativeAudioPath = path.join('video', 'audio', 'session', 'audio-1', 'speech.mp3');
  const canonicalAudioPath = path.join(assetsV2Root, relativeAudioPath);
  const incorrectlyNestedPath = path.join(
    legacyAssetsRoot,
    'assets_v2',
    relativeAudioPath,
  );
  await fs.promises.mkdir(path.dirname(canonicalAudioPath), { recursive: true });
  await fs.promises.mkdir(legacyAssetsRoot, { recursive: true });
  await fs.promises.writeFile(canonicalAudioPath, Buffer.from('v2-audio'));

  let objectReadCount = 0;
  const result = await resolveSubtitleAudioSource({
    audioLayer: {
      selectedLocalAudioLink: `assets_v2/${relativeAudioPath.split(path.sep).join('/')}`,
    },
    // This is the path TranscriptGenerator historically constructed.
    preferredLocalFilePath: incorrectlyNestedPath,
    trustedLocalRoots: [assetsV2Root, legacyAssetsRoot],
    getObject: async () => {
      objectReadCount += 1;
      throw new Error('should not read storage');
    },
  });

  assert.equal(result.filePath, await fs.promises.realpath(canonicalAudioPath));
  assert.equal(result.isTemporary, false);
  assert.equal(objectReadCount, 0);
});

test('recovers a missing local audio file from its expired CloudFront reference and cleans up', async (t) => {
  const tempRoot = await makeTempDirectory('samsar-subtitle-temp-root-');
  const missingAssetRoot = await makeTempDirectory('samsar-subtitle-missing-root-');
  t.after(async () => {
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
    await fs.promises.rm(missingAssetRoot, { recursive: true, force: true });
  });
  const reads = [];
  const result = await resolveSubtitleAudioSource({
    audioLayer: {
      _id: { toString: () => 'audio-1' },
      selectedLocalAudioLink: 'video/audio/session/audio-1/speech.mp3',
      selectedRemoteAudioLink:
        'https://static.samsar.one/assets_v2/temp_audio/speech.mp3' +
        '?Expires=1&Signature=expired&Key-Pair-Id=old',
    },
    preferredLocalFilePath: path.join(missingAssetRoot, 'does-not-exist.mp3'),
    trustedLocalRoots: [missingAssetRoot],
    tempRoot,
    getObject: async (request) => {
      reads.push(request);
      return {
        ContentLength: 12,
        Body: Buffer.from('remote-audio'),
      };
    },
  });

  assert.deepEqual(reads, [{
    bucketName: 'samsar-resources',
    key: 'assets_v2/temp_audio/speech.mp3',
  }]);
  assert.equal(result.isTemporary, true);
  assert.equal(result.objectKey, 'assets_v2/temp_audio/speech.mp3');
  assert.equal(await fs.promises.readFile(result.filePath, 'utf8'), 'remote-audio');
  const recoveryDirectory = path.dirname(result.filePath);

  await result.cleanup();
  await result.cleanup();
  await assert.rejects(fs.promises.stat(recoveryDirectory), { code: 'ENOENT' });
});

test('falls through an unavailable selected remote object to another trusted audio object', async (t) => {
  const tempRoot = await makeTempDirectory('samsar-subtitle-fallback-root-');
  t.after(() => fs.promises.rm(tempRoot, { recursive: true, force: true }));
  const attemptedKeys = [];
  const result = await resolveSubtitleAudioSource({
    audioLayer: {
      selectedRemoteAudioLink: 'https://static.samsar.one/assets_v2/temp_audio/missing.mp3',
      remoteAudioLinks: ['https://static.samsar.one/assets_v2/temp_audio/available.wav'],
    },
    trustedLocalRoots: [],
    tempRoot,
    getObject: async ({ key }) => {
      attemptedKeys.push(key);
      if (key.endsWith('/missing.mp3')) {
        throw new Error('NoSuchKey');
      }
      return { Body: Buffer.from('available-audio') };
    },
  });

  assert.deepEqual(attemptedKeys, [
    'assets_v2/temp_audio/missing.mp3',
    'assets_v2/temp_audio/available.wav',
  ]);
  assert.equal(path.extname(result.filePath), '.wav');
  assert.equal(await fs.promises.readFile(result.filePath, 'utf8'), 'available-audio');
  await result.cleanup();
});

test('does not fetch an untrusted URL and reports unavailable alignment audio', async () => {
  let objectReadCount = 0;
  await assert.rejects(
    resolveSubtitleAudioSource({
      audioLayer: {
        _id: { toString: () => 'audio-untrusted' },
        selectedRemoteAudioLink: 'http://127.0.0.1:8080/private.mp3',
      },
      trustedLocalRoots: [],
      getObject: async () => {
        objectReadCount += 1;
        return { Body: Buffer.from('unexpected') };
      },
    }),
    /audio layer audio-untrusted/,
  );
  assert.equal(objectReadCount, 0);
});

test('rejects oversized stored audio and removes partial temporary files', async (t) => {
  const tempRoot = await makeTempDirectory('samsar-subtitle-oversized-root-');
  t.after(() => fs.promises.rm(tempRoot, { recursive: true, force: true }));

  await assert.rejects(
    resolveSubtitleAudioSource({
      audioLayer: {
        selectedRemoteAudioLink: 'https://static.samsar.one/assets_v2/temp_audio/large.mp3',
      },
      trustedLocalRoots: [],
      tempRoot,
      maxAudioBytes: 4,
      getObject: async () => ({ Body: Buffer.from('too-large') }),
    }),
    /no existing trusted local file or readable stored audio object/,
  );

  assert.deepEqual(await fs.promises.readdir(tempRoot), []);
});
