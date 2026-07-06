import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveGoogleTTSInputVolume,
  resolveGoogleTTSVolumeGainDb,
} from './GoogleTTS.js';

const originalExpressGain = process.env.GOOGLE_TTS_EXPRESS_VOLUME_GAIN_DB;

test.afterEach(() => {
  if (originalExpressGain === undefined) {
    delete process.env.GOOGLE_TTS_EXPRESS_VOLUME_GAIN_DB;
  } else {
    process.env.GOOGLE_TTS_EXPRESS_VOLUME_GAIN_DB = originalExpressGain;
  }
});

test('uses express Google TTS gain when no explicit volume is provided', () => {
  delete process.env.GOOGLE_TTS_EXPRESS_VOLUME_GAIN_DB;

  assert.equal(resolveGoogleTTSVolumeGainDb({}, { isExpressGeneration: true }), 6);
});

test('uses configured express Google TTS gain when present', () => {
  process.env.GOOGLE_TTS_EXPRESS_VOLUME_GAIN_DB = '8';

  assert.equal(resolveGoogleTTSVolumeGainDb({}, { isExpressGeneration: true }), '8');
});

test('keeps explicit Google TTS gain ahead of express default', () => {
  process.env.GOOGLE_TTS_EXPRESS_VOLUME_GAIN_DB = '8';

  assert.equal(
    resolveGoogleTTSVolumeGainDb(
      { googleTTSVolumeGainDb: 2 },
      { isExpressGeneration: true }
    ),
    2
  );
});

test('does not apply express gain when caller supplied app volume', () => {
  process.env.GOOGLE_TTS_EXPRESS_VOLUME_GAIN_DB = '8';

  assert.equal(
    resolveGoogleTTSVolumeGainDb(
      { ttsVolume: 150 },
      { isExpressGeneration: true }
    ),
    undefined
  );
  assert.equal(resolveGoogleTTSInputVolume({ ttsVolume: 150 }), 150);
});

test('does not apply express gain outside express generation', () => {
  assert.equal(resolveGoogleTTSVolumeGainDb({}, { isExpressGeneration: false }), undefined);
});
