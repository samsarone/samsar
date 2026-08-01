import assert from 'node:assert/strict';
import { promises as fsPromises } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';

import {
  __testOnly__,
  normalizeAudioLibraryType,
  normalizeAudioStudioLibraryQuery,
  parseAudioStudioItemId,
  validateJoinAudioPayload,
} from './AudioStudio.js';
import { getAudioDurationSeconds } from './AudioUtils.js';

const SESSION_ID = '66a000000000000000000001';
const AUDIO_LAYER_ID = '66a000000000000000000002';
const GENERATED_MUSIC_ID = '66a000000000000000000003';

test('normalizes the Audio Studio library categories', () => {
  assert.equal(normalizeAudioLibraryType('background_music'), 'music');
  assert.equal(normalizeAudioLibraryType('recorded_speech'), 'speech');
  assert.equal(normalizeAudioLibraryType('sound'), 'sound_effect');
  assert.equal(normalizeAudioLibraryType('video'), '');
});

test('parses generated and session audio library ids', () => {
  assert.deepEqual(
    parseAudioStudioItemId(`generated_music:${GENERATED_MUSIC_ID}`),
    {
      kind: 'generated_music',
      itemId: `generated_music:${GENERATED_MUSIC_ID}`,
      generatedMusicId: GENERATED_MUSIC_ID,
    }
  );
  assert.deepEqual(
    parseAudioStudioItemId(`${SESSION_ID}:${AUDIO_LAYER_ID}`),
    {
      kind: 'session_audio_layer',
      itemId: `${SESSION_ID}:${AUDIO_LAYER_ID}`,
      sessionId: SESSION_ID,
      audioLayerId: AUDIO_LAYER_ID,
    }
  );
  assert.equal(parseAudioStudioItemId('not-a-library-id'), null);
});

test('validates ordered join selections and their category', () => {
  const payload = validateJoinAudioPayload({
    audioItemIds: [
      `generated_music:${GENERATED_MUSIC_ID}`,
      `${SESSION_ID}:${AUDIO_LAYER_ID}`,
    ],
    libraryType: 'sound',
    title: '  Joined ambience  ',
    fadeAudioAtEnds: true,
  });

  assert.deepEqual(payload.itemIds, [
    `generated_music:${GENERATED_MUSIC_ID}`,
    `${SESSION_ID}:${AUDIO_LAYER_ID}`,
  ]);
  assert.equal(payload.requestedLibraryType, 'sound_effect');
  assert.equal(payload.title, 'Joined ambience');
  assert.equal(payload.fadeAudioAtEnds, true);
});

test('normalizes bounded server-side audio library pagination', () => {
  assert.deepEqual(
    normalizeAudioStudioLibraryQuery({
      page: '3',
      limit: '500',
      type: 'background_music',
      search: '  newest cue  ',
    }),
    {
      page: 3,
      limit: 50,
      libraryType: 'music',
      search: 'newest cue',
    }
  );
  assert.throws(
    () => normalizeAudioStudioLibraryQuery({ libraryType: 'video' }),
    /valid audio library category/i
  );
});

test('builds per-clip edge fades only when requested', () => {
  const fadedFilters = __testOnly__.buildJoinedAudioFilters(2, [2, 0.2], true);
  assert.match(fadedFilters[0], /afade=t=in/);
  assert.match(fadedFilters[0], /afade=t=out:st=1\.650:d=0\.350/);
  assert.match(fadedFilters[1], /afade=t=out:st=0\.150:d=0\.050/);
  assert.doesNotMatch(
    __testOnly__.buildJoinedAudioFilters(2, [], false)[0],
    /afade/
  );
});

test('orders paginated audio library items by creation date descending', () => {
  const orderedItems = __testOnly__.sortAudioStudioLibraryItemsByCreationDate([
    { _id: 'older', createdAt: '2026-01-01T00:00:00Z' },
    { _id: 'newest', createdAt: '2026-03-01T00:00:00Z' },
    { _id: 'middle', createdAt: '2026-02-01T00:00:00Z' },
  ]);
  assert.deepEqual(orderedItems.map((item) => item._id), ['newest', 'middle', 'older']);
});

test('returns a delivery URL for stored audio and preserves provider URLs', () => {
  const storedAudioUrl = __testOnly__.buildAudioStudioPlaybackUrl(
    'assets_v2/audio_studio/user/joined.mp3'
  );
  assert.match(storedAudioUrl, /assets_v2\/audio_studio\/user\/joined\.mp3/);
  assert.match(storedAudioUrl, /^https?:\/\//);
  assert.equal(
    __testOnly__.buildAudioStudioPlaybackUrl('https://provider.example/result.mp3'),
    'https://provider.example/result.mp3'
  );
});

test('rejects duplicate and undersized join selections', () => {
  assert.throws(
    () => validateJoinAudioPayload({ audioItemIds: [`generated_music:${GENERATED_MUSIC_ID}`] }),
    /at least two/i
  );
  assert.throws(
    () => validateJoinAudioPayload({
      audioItemIds: [
        `generated_music:${GENERATED_MUSIC_ID}`,
        `generated_music:${GENERATED_MUSIC_ID}`,
      ],
    }),
    /only be selected once/i
  );
});

function createTestTone(outputPath, frequency) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(`sine=frequency=${frequency}:duration=0.2`)
      .inputFormat('lavfi')
      .audioCodec('libmp3lame')
      .on('end', resolve)
      .on('error', reject)
      .save(outputPath);
  });
}

test('renders selected audio inputs into one ordered MP3', async (t) => {
  ffmpeg.setFfmpegPath(ffmpegPath);
  const testDirectory = await fsPromises.mkdtemp(path.join(tmpdir(), 'audio-studio-test-'));
  t.after(() => fsPromises.rm(testDirectory, { recursive: true, force: true }));

  const firstInput = path.join(testDirectory, 'first.mp3');
  const secondInput = path.join(testDirectory, 'second.mp3');
  const outputPath = path.join(testDirectory, 'joined.mp3');
  const normalizedOutputPath = path.join(testDirectory, 'normalized.mp3');
  await Promise.all([
    createTestTone(firstInput, 440),
    createTestTone(secondInput, 880),
  ]);

  await __testOnly__.renderJoinedAudio(
    [firstInput, secondInput],
    outputPath,
    { fadeAudioAtEnds: true }
  );
  const outputStats = await fsPromises.stat(outputPath);
  const outputDuration = await getAudioDurationSeconds(outputPath);

  assert.ok(outputStats.size > 0);
  assert.ok(outputDuration >= 0.35);
  assert.ok(outputDuration < 0.8);

  await __testOnly__.renderJoinedAudio([firstInput], normalizedOutputPath);
  const normalizedDuration = await getAudioDurationSeconds(normalizedOutputPath);
  assert.ok(normalizedDuration >= 0.15);
  assert.ok(normalizedDuration < 0.5);
});
