import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildNarratorAudioFfmpegArgs,
  resolveNarratorInternalMediaReference,
  resolveNarratorProviderMediaReference,
} from './NarratorAvatar.js';

test('narrator provider media references are refreshed through the canonical resolver', async () => {
  const references = [];
  const result = await resolveNarratorProviderMediaReference(
    'https://expired-tunnel.trycloudflare.com/assets_v2/audio/narration.mp3?old=1',
    'audio',
    async (reference) => {
      references.push(reference);
      return 'https://fresh-tunnel.trycloudflare.com/assets_v2/audio/narration.mp3';
    },
  );

  assert.deepEqual(references, [
    'https://expired-tunnel.trycloudflare.com/assets_v2/audio/narration.mp3?old=1',
  ]);
  assert.equal(
    result,
    'https://fresh-tunnel.trycloudflare.com/assets_v2/audio/narration.mp3',
  );
});

test('narrator image references retain supported data URLs', async () => {
  const dataUrl = 'data:image/png;base64,aW1hZ2U=';
  const result = await resolveNarratorProviderMediaReference(
    dataUrl,
    'image',
    async (reference) => reference,
  );

  assert.equal(result, dataUrl);
});

test('narrator provider media references fail closed when still local after resolution', async () => {
  await assert.rejects(
    resolveNarratorProviderMediaReference(
      '/assets_v2/audio/narration.mp3',
      'audio',
      async (reference) => reference,
    ),
    /provider-readable URL/,
  );
});

test('narrator internal ffmpeg input resolves a local processor URL to the mounted file', () => {
  const originalAssetsV2Root = process.env.SAMSAR_ASSETS_V2_ROOT;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-narrator-internal-'));
  const assetsV2Root = path.join(tempRoot, 'assets_v2');
  const mediaPath = path.join(assetsV2Root, 'video', 'audio', 'speech.mp3');
  fs.mkdirSync(path.dirname(mediaPath), { recursive: true });
  fs.writeFileSync(mediaPath, 'audio');
  process.env.SAMSAR_ASSETS_V2_ROOT = assetsV2Root;

  try {
    assert.equal(
      resolveNarratorInternalMediaReference(
        'http://localhost:3002/assets_v2/video/audio/speech.mp3',
      ),
      mediaPath,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    if (originalAssetsV2Root === undefined) {
      delete process.env.SAMSAR_ASSETS_V2_ROOT;
    } else {
      process.env.SAMSAR_ASSETS_V2_ROOT = originalAssetsV2Root;
    }
  }
});

test('narrator internal byte consumption preserves an independently hosted URL', () => {
  const providerUrl = 'https://provider.example/output/avatar.mp4?token=provider-owned';
  assert.equal(resolveNarratorInternalMediaReference(providerUrl), providerUrl);
});

test('narrator audio mix limits every decoder plus the complex filter and encoder', () => {
  const args = buildNarratorAudioFfmpegArgs({
    durationSeconds: 8,
    resolvedSegments: [
      { source: '/tmp/one.mp3', startTime: 0, duration: 3 },
      { source: '/tmp/two.mp3', startTime: 4, duration: 2 },
    ],
    outputPath: '/tmp/mix.mp3',
    ffmpegThreads: 3,
  });

  const inputIndexes = args
    .map((value, index) => value === '-i' ? index : -1)
    .filter((index) => index >= 0);
  assert.equal(inputIndexes.length, 3);
  for (const inputIndex of inputIndexes) {
    assert.deepEqual(args.slice(inputIndex - 2, inputIndex), ['-threads', '1']);
  }

  const complexFilterThreadsIndex = args.indexOf('-filter_complex_threads');
  assert.equal(args[complexFilterThreadsIndex + 1], '3');
  assert.deepEqual(args.slice(-3), ['-threads', '3', '/tmp/mix.mp3']);
});
