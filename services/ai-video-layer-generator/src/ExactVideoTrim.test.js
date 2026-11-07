import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { clipVideoToDuration } from './VideoProcessor.js';
const binary=process.env.FFMPEG_PATH || 'ffmpeg';
function fixture(t,count=90) { const dir=fs.mkdtempSync(path.join(os.tmpdir(),'samsar-trim-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'source.mp4');
 execFileSync(binary,['-v','error','-y','-f','lavfi','-i',"nullsrc=s=32x32:r=30,geq=lum='20+N*2':cb=128:cr=128",'-frames:v',String(count),'-c:v','libx264','-bf','3',file]);return file; }
for (const count of [30,31]) test(`B-frame video trim produces exactly ${count} moving frames`,async t=>{
 const file=fixture(t);await clipVideoToDuration(file,count/30,30);
 const raw=execFileSync(binary,['-v','error','-i',file,'-pix_fmt','gray','-f','rawvideo','-']);
 assert.equal(raw.length/1024,count);
 const means=Array.from({length:count},(_,i)=>raw.subarray(i*1024,(i+1)*1024).reduce((a,b)=>a+b,0)/1024);
 assert.ok(means.at(-1)>means.at(-2),'last frame must move rather than clone');
});
test('a short source cannot be padded to pretend that an exact trim succeeded',async t=>{
 const file=fixture(t,20);const original=fs.readFileSync(file);
 await assert.rejects(clipVideoToDuration(file,1,30),/frame|short/i);
 assert.deepEqual(fs.readFileSync(file),original);
});

test('short derivatives are rejected; long derivatives trim to the original scene budget',async t=>{
 const {prepareTimelineDerivative}=await import('./VideoProcessor.js');
 const short=fixture(t,20);const original=fs.readFileSync(short);
 await assert.rejects(prepareTimelineDerivative(short,30,30),{code:'VIDEO_FRAME_BUDGET_MISMATCH'});
 assert.deepEqual(fs.readFileSync(short),original);
 const long=fixture(t,90);await prepareTimelineDerivative(long,31,30);
 const raw=execFileSync(binary,['-v','error','-i',long,'-pix_fmt','gray','-f','rawvideo','-']);
 assert.equal(raw.length/1024,31);assert.ok(raw[30*1024]>raw[29*1024]);
});

test('WebM derivatives retain their supported container and exact frame budget',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'samsar-webm-trim-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'source.webm');
 execFileSync(binary,['-v','error','-y','-f','lavfi','-i',"nullsrc=s=32x32:r=30,geq=lum='20+N*5':cb=128:cr=128",'-frames:v','40','-c:v','libvpx-vp9',file]);
 await clipVideoToDuration(file,31/30,30);
 const raw=execFileSync(binary,['-v','error','-i',file,'-pix_fmt','gray','-fps_mode','passthrough','-f','rawvideo','-']);
 assert.equal(raw.length/1024,31);for(let i=1;i<31;i++)assert.ok(raw[i*1024]>raw[(i-1)*1024]);
});

test('exact trimming preserves delayed audio against a nonzero video timestamp origin',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'samsar-av-trim-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'source.mov');
 execFileSync(binary,['-v','error','-y','-f','lavfi','-i',"nullsrc=s=32x32:r=30:d=2,geq=lum='20+N*3':cb=128:cr=128",
 '-itsoffset','0.25','-f','lavfi','-i','sine=frequency=1000:sample_rate=48000:duration=1.75',
 '-map','0:v','-map','1:a','-c:v','libx264','-c:a','pcm_s16le','-output_ts_offset','5',file]);
 await clipVideoToDuration(file,31/30,30);
 const video=execFileSync(binary,['-v','error','-i',file,'-map','0:v','-pix_fmt','gray','-f','rawvideo','-']);
 assert.equal(video.length/1024,31);assert.ok(video[30*1024]>video[29*1024]);
 const pcm=execFileSync(binary,['-v','error','-i',file,'-map','0:a','-ac','1','-ar','48000','-f','s16le','-']);
 let first=-1;for(let i=0;i<pcm.length/2;i++){if(Math.abs(pcm.readInt16LE(i*2))>100){first=i;break;}}
 assert.ok(Math.abs(first/48000-0.25)<0.015,`audio moved to ${first/48000}`);
});
