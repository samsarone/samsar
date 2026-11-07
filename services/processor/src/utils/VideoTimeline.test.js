import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'fluent-ffmpeg';
import { getVideoTimeline } from './VideoTimeline.js';
import { extractAudio } from '../models/video/VideoProcessor.js';
const binary = process.env.FFMPEG_PATH || 'ffmpeg';
ffmpeg.setFfmpegPath(binary);
const run=args=>execFileSync(binary,['-v','error','-y',...args],{maxBuffer:8*1024*1024});
function dir(t){const value=fs.mkdtempSync(path.join(os.tmpdir(),'samsar-av-clock-'));t.after(()=>fs.rmSync(value,{recursive:true,force:true}));return value;}
for (const origin of [0,5]) test(`audio keeps its quarter-second delay relative to video origin ${origin}`,async t=>{
 const root=dir(t),input=path.join(root,'av.mov'),output=path.join(root,'audio.mp3');
 run(['-f','lavfi','-i','testsrc2=s=32x32:r=30:d=2','-itsoffset','0.25','-f','lavfi','-i','sine=frequency=1000:sample_rate=48000:duration=1.75',
 '-map','0:v','-map','1:a','-c:v','libx264','-c:a','pcm_s16le','-output_ts_offset',String(origin),input]);
 const timeline=await getVideoTimeline(input,30);assert.equal(timeline.frameCount,60);assert.equal(timeline.startTime,origin);
 await extractAudio(input,output,{ framesPerSecond:30 });
 const pcm=run(['-i',output,'-ar','48000','-ac','1','-f','s16le','-']);
 let first=-1;for(let i=0;i<pcm.length/2;i++){if(Math.abs(pcm.readInt16LE(i*2))>100){first=i;break;}}
 assert.ok(Math.abs(first/48000-0.25)<0.015,`first sound at ${first/48000}`);
 assert.ok(Math.abs(pcm.length/2/48000-2)<0.005,'audio length follows the video grid');
});
for(const [fps,count] of [[24,29],[30,31]]) test(`${count} frames at ${fps} fps retain exact import duration even with longer audio`,async t=>{
 const root=dir(t),input=path.join(root,'source.mp4');
 run(['-f','lavfi','-i',`testsrc2=s=32x32:r=${fps}:d=${count/fps}`,'-f','lavfi','-i','sine=duration=2','-map','0:v','-map','1:a','-c:v','libx264','-c:a','aac',input]);
 const timing=await getVideoTimeline(input,fps);assert.equal(timing.frameCount,count);assert.equal(timing.duration,count/fps);
});
test('Matroska video duration is measured from its presentation timestamps',async t=>{
 const root=dir(t),input=path.join(root,'source.mkv');
 run(['-f','lavfi','-i','testsrc2=s=32x32:r=24','-frames:v','29','-c:v','ffv1',input]);
 const timing=await getVideoTimeline(input,24);assert.equal(timing.frameCount,29);assert.equal(timing.duration,29/24);
});

test('normalizing a video with nonzero timestamps retains its frame count and resets its video origin',async t=>{
 const {normalizeVideoAssetToMp4WithoutAudio}=await import('../models/video/VideoProcessor.js');
 const root=dir(t),input=path.join(root,'source.mov');const oldRoot=process.env.SAMSAR_ASSETS_V2_ROOT;
 process.env.SAMSAR_ASSETS_V2_ROOT=root;t.after(()=>{if(oldRoot===undefined)delete process.env.SAMSAR_ASSETS_V2_ROOT;else process.env.SAMSAR_ASSETS_V2_ROOT=oldRoot;});
 run(['-f','lavfi','-i','testsrc2=s=32x32:r=24','-frames:v','29','-c:v','libx264','-output_ts_offset','5',input]);
 const output=await normalizeVideoAssetToMp4WithoutAudio(input,{sessionId:'s',layerId:'l'});
 const timing=await getVideoTimeline(output,24);assert.equal(timing.frameCount,29);assert.equal(timing.startTime,0);assert.equal(timing.duration,29/24);
});
