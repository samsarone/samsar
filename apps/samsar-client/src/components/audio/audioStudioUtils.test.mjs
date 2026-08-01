import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUDIO_TYPE_MUSIC,
  AUDIO_TYPE_SOUND_EFFECT,
  flattenAudioStudioArtifacts,
  formatAudioStudioDuration,
  resolveAudioStudioUrl,
  resolveAudioStudioUrls,
} from './audioStudioUtils.mjs';

test('flattens categorized Audio Studio artifacts in recency order', () => {
  const items = flattenAudioStudioArtifacts({
    music: [{
      projectId: 'project-1',
      projectName: 'Launch film',
      items: [{ _id: 'music-1', url: 'music.mp3', createdAt: '2026-01-01T00:00:00Z' }],
    }],
    soundEffect: [{
      projectId: 'project-2',
      projectName: 'Audio Studio',
      items: [{ _id: 'sound-1', url: 'sound.mp3', createdAt: '2026-02-01T00:00:00Z' }],
    }],
  });

  assert.deepEqual(items.map((item) => item._id), ['sound-1', 'music-1']);
  assert.equal(items[0].libraryType, AUDIO_TYPE_SOUND_EFFECT);
  assert.equal(items[1].libraryType, AUDIO_TYPE_MUSIC);
  assert.equal(items[1].projectName, 'Launch film');
});

test('resolves local and remote audio URLs', () => {
  assert.equal(
    resolveAudioStudioUrl({ url: 'assets_v2/audio/example.mp3' }, 'http://localhost:3002/'),
    'http://localhost:3002/assets_v2/audio/example.mp3'
  );
  assert.equal(
    resolveAudioStudioUrl({ url: 'https://cdn.example/audio.mp3' }, 'http://localhost:3002'),
    'https://cdn.example/audio.mp3'
  );
  assert.deepEqual(
    resolveAudioStudioUrls({
      playbackUrl: 'https://fresh.example/audio.mp3',
      url: 'assets_v2/audio/fallback.mp3',
      selectedLocalAudioLink: 'assets_v2/audio/fallback.mp3',
    }, 'http://localhost:3002'),
    [
      'https://fresh.example/audio.mp3',
      'http://localhost:3002/assets_v2/audio/fallback.mp3',
    ]
  );
});

test('formats audio duration for compact cards', () => {
  assert.equal(formatAudioStudioDuration(65.9), '1:05');
  assert.equal(formatAudioStudioDuration(null), '--:--');
});
