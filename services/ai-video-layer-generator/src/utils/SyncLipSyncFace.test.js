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
