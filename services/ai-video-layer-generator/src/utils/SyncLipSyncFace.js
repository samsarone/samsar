import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { validateSpeakerFaceResponse } from './ExpressLipSyncPrompt.js';

const runFfmpeg = promisify(execFile);
const extractionRetryDelays = [1000, 2000, 4000];

// Decode the actual submitted video's first frame without FPS conversion or resizing.
export async function extractSyncStartingFrame(videoLink, { run = runFfmpeg, wait = delay } = {}) {
  const binary = process.env.FFMPEG_PATH || ffmpegPath;
  for (let attempt = 0; attempt <= extractionRetryDelays.length; attempt += 1) {
    try {
      return await extractFrameOnce(videoLink, binary, run);
    } catch (error) {
      // execFile's message contains the signed media URL; only log safe diagnostics.
      const details = { attempt: attempt + 1, code: error?.code ?? null, signal: error?.signal ?? null };
      if (attempt === extractionRetryDelays.length) {
        throw new Error(`Starting-frame extraction failed after ${attempt + 1} attempts (code=${details.code}, signal=${details.signal})`);
      }
      console.warn('[lip_sync][face_selection] retrying frame extraction', {
        ...details, retryDelayMs: extractionRetryDelays[attempt],
      });
      await wait(extractionRetryDelays[attempt]);
    }
  }
}

async function extractFrameOnce(videoLink, binary, run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-face-'));
  try {
    const output = path.join(directory, 'frame.png');
    await run(binary, ['-nostdin', '-v', 'error', '-i', videoLink,
      '-map', '0:v:0', '-frames:v', '1', '-threads', '1', output], { timeout: 60000 });
    const png = await fs.readFile(output);
    if (png.length < 24 || png.toString('hex', 0, 8) !== '89504e470d0a1a0a') throw new Error('Invalid extracted PNG');
    return { width: png.readUInt32BE(16), height: png.readUInt32BE(20), dataUrl: `data:image/png;base64,${png.toString('base64')}` };
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

export function buildSyncLipSyncInput(payload = {}) {
  const input = { video_url: payload.videoLink, audio_url: payload.audioLink };
  const selection = payload.lipSyncFaceSelection;
  // Bind selection to the exact submitted source; never carry it to another video/model.
  if (payload.model !== 'SYNCLIPSYNC' || !selection || selection.videoLink !== payload.videoLink || selection.frameNumber !== 0) return input;
  const result = validateSpeakerFaceResponse({ status: selection.status, face_box: selection.face_box }, selection);
  if (result?.status !== 'identified') return input;
  const [left, top, right, bottom] = result.face_box;
  input.options = { active_speaker_detection: {
    auto_detect: false, frame_number: 0,
    coordinates: [Math.round((left + right) / 2), Math.round((top + bottom) / 2)],
  } };
  return input;
}
