import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSyncLipSyncInput, extractSyncStartingFrame } from './SyncLipSyncFace.js';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';

const payload = { model:'SYNCLIPSYNC', videoLink:'https://example.com/video.mp4', audioLink:'https://example.com/audio.wav' };
const selection = { status:'identified',face_box:[10,20,50,60],width:100,height:80,frameNumber:0,videoLink:payload.videoLink };
test('Sync keeps its original request without a valid source-bound box', () => {
  const expected = {video_url:payload.videoLink,audio_url:payload.audioLink};
  for (const lipSyncFaceSelection of [undefined, null, {...selection,videoLink:'other'}, {...selection,frameNumber:1}, {...selection,face_box:[0,0,200,200]}, {...selection,status:'ambiguous',face_box:null}]) {
    assert.deepEqual(buildSyncLipSyncInput({...payload,lipSyncFaceSelection}),expected);
  }
  assert.deepEqual(buildSyncLipSyncInput({...payload,model:'LATENTSYNC',lipSyncFaceSelection:selection}),expected);
});
test('Sync maps a valid frame-zero face box to manual point selection', () => {
  assert.deepEqual(buildSyncLipSyncInput({...payload,lipSyncFaceSelection:selection}).options, {
    active_speaker_detection:{auto_detect:false,frame_number:0,coordinates:[30,40]},
  });
});
test('extracts the submitted video first frame at native dimensions', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'sync-face-test-'));
  try {
    const video = path.join(dir,'video.mp4');
    execFileSync(ffmpegPath,['-v','error','-f','lavfi','-i','color=c=red:s=160x90:r=24','-t','0.2','-pix_fmt','yuv420p',video]);
    const frame = await extractSyncStartingFrame(video);
    assert.equal(frame.width,160);
    assert.equal(frame.height,90);
    assert.match(frame.dataUrl,/^data:image\/png;base64,/);
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
});

const testPng = Buffer.alloc(24);
Buffer.from('89504e470d0a1a0a', 'hex').copy(testPng);
testPng.writeUInt32BE(160, 16);
testPng.writeUInt32BE(90, 20);

test('uses configured FFmpeg, retries the same source, and cleans partial frames before backoff', async (t) => {
  const previousPath = process.env.FFMPEG_PATH;
  process.env.FFMPEG_PATH = '/configured/ffmpeg';
  t.after(() => {
    if (previousPath === undefined) delete process.env.FFMPEG_PATH;
    else process.env.FFMPEG_PATH = previousPath;
  });
  t.mock.method(console, 'warn', () => {});
  const outputs = [];
  const waits = [];
  const frame = await extractSyncStartingFrame(payload.videoLink, {
    run: async (binary, args, options) => {
      assert.equal(binary, '/configured/ffmpeg');
      assert.equal(args[args.indexOf('-i') + 1], payload.videoLink);
      assert.equal(args[args.indexOf('-frames:v') + 1], '1');
      assert.equal(options.timeout, 60000);
      const output = args.at(-1);
      outputs.push(output);
      await fs.writeFile(output, outputs.length < 3 ? 'partial output' : testPng);
      if (outputs.length < 3) throw Object.assign(new Error('temporary read error'), { code: 1 });
    },
    wait: async (ms) => {
      waits.push(ms);
      await assert.rejects(fs.stat(path.dirname(outputs.at(-1))), { code: 'ENOENT' });
    },
  });
  assert.equal(frame.width, 160);
  assert.equal(frame.height, 90);
  assert.deepEqual(waits, [1000, 2000]);
  assert.equal(new Set(outputs).size, 3);
  await assert.rejects(fs.stat(path.dirname(outputs.at(-1))), { code: 'ENOENT' });
});

test('retries invalid or missing frame output before returning a usable frame', async (t) => {
  t.mock.method(console, 'warn', () => {});
  let attempts = 0;
  const waits = [];
  const frame = await extractSyncStartingFrame(payload.videoLink, {
    run: async (_binary, args) => {
      attempts += 1;
      if (attempts === 1) return;
      await fs.writeFile(args.at(-1), attempts === 2 ? 'invalid PNG' : testPng);
    },
    wait: async (ms) => { waits.push(ms); },
  });
  assert.equal(frame.width, 160);
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [1000, 2000]);
});

test('stops after three retries, cleans temporary files, and does not log signed URLs', async (t) => {
  const warnings = [];
  t.mock.method(console, 'warn', (...args) => { warnings.push(args); });
  const outputs = [];
  const waits = [];
  await assert.rejects(extractSyncStartingFrame('https://example.com/video?token=secret', {
    run: async (_binary, args) => {
      outputs.push(args.at(-1));
      await fs.writeFile(args.at(-1), 'partial');
      throw Object.assign(new Error('Command failed: https://example.com/video?token=secret'), { signal: 'SIGSEGV' });
    },
    wait: async (ms) => { waits.push(ms); },
  }), (error) => {
    assert.match(error.message, /failed after 4 attempts/);
    assert.match(error.message, /signal=SIGSEGV/);
    assert.doesNotMatch(error.message, /secret|https:/);
    return true;
  });
  assert.equal(outputs.length, 4);
  assert.deepEqual(waits, [1000, 2000, 4000]);
  assert.equal(warnings.length, 3);
  assert.doesNotMatch(JSON.stringify(warnings), /secret|https:/);
  for (const output of outputs) {
    await assert.rejects(fs.stat(path.dirname(output)), { code: 'ENOENT' });
  }
});
