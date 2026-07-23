import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';
import ffmpeg from 'fluent-ffmpeg';

import {
  buildFrameExtractionThreadOptions,
  extractAudioFromVideoIfPresent,
  extractVideoBoundaryFrames,
  getVideoMetadata,
  processVideoAsFrames,
} from './VideoProcessor.js';

const execFileAsync = promisify(execFile);

ffmpeg.setFfmpegPath(ffmpegPath);

test('frame extraction applies the CPU cap to decoder, filter, and encoder threads', () => {
  assert.deepEqual(
    buildFrameExtractionThreadOptions(3),
    {
      inputOptions: ['-threads', '3'],
      outputOptions: [
        '-filter_threads', '3',
        '-threads', '3',
      ],
    },
  );
  assert.deepEqual(
    buildFrameExtractionThreadOptions(0),
    {
      inputOptions: ['-threads', '1'],
      outputOptions: [
        '-filter_threads', '1',
        '-threads', '1',
      ],
    },
  );
});

test('custom video audio extraction preserves a delayed audio stream on the video timeline', async (t) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-video-audio-timeline-'));
  const assetsRoot = path.join(temporaryRoot, 'assets_v2');
  const sourceVideoPath = path.join(temporaryRoot, 'delayed-audio.mp4');
  const previousAssetsRoot = process.env.SAMSAR_ASSETS_V2_ROOT;

  fs.mkdirSync(assetsRoot, { recursive: true });
  process.env.SAMSAR_ASSETS_V2_ROOT = assetsRoot;

  t.after(() => {
    if (previousAssetsRoot === undefined) {
      delete process.env.SAMSAR_ASSETS_V2_ROOT;
    } else {
      process.env.SAMSAR_ASSETS_V2_ROOT = previousAssetsRoot;
    }
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  });

  await execFileAsync(ffmpegPath, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=black:s=32x32:r=10:d=4',
    '-itsoffset',
    '2',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=1000:sample_rate=48000:duration=1',
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-t',
    '4',
    '-y',
    sourceVideoPath,
  ]);

  const sourceMetadata = await getVideoMetadata(sourceVideoPath);
  const sourceAudioStream = sourceMetadata.streams.find((stream) => stream.codec_type === 'audio');

  assert.ok(sourceAudioStream, 'expected the fixture to contain an audio stream');
  assert.ok(
    Number(sourceAudioStream.start_time) >= 1.9 && Number(sourceAudioStream.start_time) <= 2.1,
    `expected the fixture audio stream to start around two seconds, got ${sourceAudioStream.start_time}`
  );

  const boundaryFrames = await extractVideoBoundaryFrames(
    sourceVideoPath,
    'thread-cap-boundary-session',
    'thread-cap-boundary-layer',
    { width: 32, height: 32 },
    { durationSeconds: 4 },
  );
  assert.equal(fs.existsSync(boundaryFrames.firstFrame), true);
  assert.equal(fs.existsSync(boundaryFrames.lastFrame), true);

  const extractedFrames = await processVideoAsFrames(
    sourceVideoPath,
    'thread-cap-frames-session',
    'thread-cap-frames-layer',
    { width: 32, height: 32 },
    1,
  );
  assert.ok(extractedFrames.frameCount > 0);

  const extraction = await extractAudioFromVideoIfPresent(sourceVideoPath, {
    sessionId: 'test-session',
    layerId: 'test-layer',
    prefix: 'user_video',
    trimUploadedAudioEdgeSilence: true,
    preserveVideoTimeline: true,
  });

  assert.ok(extraction.audioPath);
  assert.equal(extraction.leadingSilenceTrimSeconds, 0);
  assert.equal(extraction.trailingSilenceTrimSeconds, 0);

  const extractedMetadata = await getVideoMetadata(extraction.audioPath);
  const extractedDurationSeconds = Number(extractedMetadata?.format?.duration);

  assert.ok(
    extractedDurationSeconds >= 3.9 && extractedDurationSeconds <= 4.2,
    `expected audio to retain the four-second video timeline, got ${extractedDurationSeconds} seconds`
  );

  const { stderr } = await execFileAsync(ffmpegPath, [
    '-hide_banner',
    '-i',
    extraction.audioPath,
    '-af',
    'silencedetect=noise=-50dB:d=0.1',
    '-f',
    'null',
    '-',
  ]);

  const leadingSilenceStartMatch = stderr.match(/silence_start:\s*([0-9.]+)/);
  const leadingSilenceEndMatch = stderr.match(/silence_end:\s*([0-9.]+)/);
  const silenceStarts = [...stderr.matchAll(/silence_start:\s*([0-9.]+)/g)]
    .map((match) => Number(match[1]));
  const silenceEnds = [...stderr.matchAll(/silence_end:\s*([0-9.]+)/g)]
    .map((match) => Number(match[1]));

  assert.ok(leadingSilenceStartMatch, 'expected the extracted audio to begin with silence');
  assert.equal(Number(leadingSilenceStartMatch[1]), 0);
  assert.ok(leadingSilenceEndMatch, 'expected leading silence before the delayed audio stream');
  assert.ok(
    Number(leadingSilenceEndMatch[1]) >= 1.9 && Number(leadingSilenceEndMatch[1]) <= 2.1,
    `expected audio to begin around two seconds, got ${leadingSilenceEndMatch[1]} seconds`
  );
  assert.ok(
    silenceStarts.some((value) => value >= 2.9 && value <= 3.1),
    'expected silence padding after the source audio ends'
  );
  assert.ok(
    silenceEnds.some((value) => value >= 3.9 && value <= 4.1),
    'expected trailing silence to extend to the video duration'
  );
});
