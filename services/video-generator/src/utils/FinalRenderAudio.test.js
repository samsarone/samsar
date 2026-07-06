import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildFinalAudioMixFilter,
  FINAL_RENDER_AUDIO_GAIN,
  FINAL_RENDER_AUDIO_LIMIT_ATTACK_MS,
  FINAL_RENDER_AUDIO_LIMIT_RELEASE_MS,
  FINAL_RENDER_AUDIO_PEAK_LIMIT,
} from './FinalRenderAudio.js';

test('buildFinalAudioMixFilter applies final render mastering after the combined mix', () => {
  const filter = buildFinalAudioMixFilter({
    inputLabels: ['[duckedmusic]', '[a1]', '[a2]'],
    duration: 12.34567,
  });

  assert.equal(FINAL_RENDER_AUDIO_GAIN, 1.5);
  assert.equal(FINAL_RENDER_AUDIO_PEAK_LIMIT, 0.95);
  assert.equal(FINAL_RENDER_AUDIO_LIMIT_ATTACK_MS, 5);
  assert.equal(FINAL_RENDER_AUDIO_LIMIT_RELEASE_MS, 50);
  assert.equal(
    filter,
    '[duckedmusic][a1][a2]amix=inputs=3:duration=longest:normalize=0,volume=1.5,alimiter=limit=0.95:attack=5:release=50:level=0:latency=1,aresample=async=1:first_pts=0,apad,atrim=duration=12.3457,asetpts=N/SR/TB[aout]'
  );
});

test('buildFinalAudioMixFilter ignores empty input labels', () => {
  assert.equal(buildFinalAudioMixFilter({ inputLabels: [], duration: 5 }), '');
});

test('buildFinalAudioMixFilter falls back to safe mastering defaults', () => {
  const filter = buildFinalAudioMixFilter({
    inputLabels: [' [a1] '],
    duration: 4,
    outputLabel: ' mastered ',
    finalRenderAudioGain: -2,
    finalRenderAudioPeakLimit: Number.NaN,
  });

  assert.equal(
    filter,
    '[a1]amix=inputs=1:duration=longest:normalize=0,volume=1.5,alimiter=limit=0.95:attack=5:release=50:level=0:latency=1,aresample=async=1:first_pts=0,apad,atrim=duration=4,asetpts=N/SR/TB[mastered]'
  );
});
