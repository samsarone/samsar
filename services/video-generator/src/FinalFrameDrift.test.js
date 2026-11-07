import { buildFinalAudioMixFilter } from './utils/FinalRenderAudio.js';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import ffmpeg from 'fluent-ffmpeg';
import { secondsToFrameCount, frameCountToSeconds } from './utils/FrameClock.js';

const binary = process.env.FFMPEG_PATH || 'ffmpeg';
ffmpeg.setFfmpegPath(binary);
const source = fs.readFileSync(new URL('./GenerationProcessor.js', import.meta.url), 'utf8');
const start = source.indexOf('function renderAndSaveVideoOnce(payload)');
const implementation = source.slice(start, source.indexOf('\n}', start) + 2);
const context = vm.createContext({
  ffmpeg, fs, console, buildFinalAudioMixFilter,
  isMusicDuckingTargetTrack:()=>false, isConnectedForegroundTrack:()=>false,
  secondsToFrameCount, frameCountToSeconds,
  DEFAULT_FRAMES_PER_SECOND: 24,
  normalizeFramesPerSecond: value => [16,24,30].includes(Number(value)) ? Number(value) : null,
  shouldUseStudioPeakSidechainDucking: () => false,
  resolveFinalRenderFfmpegThreads: () => 1,
  attachFFmpegProcess: () => {},
  formatFFmpegNumber: value => String(Number(Number(value).toFixed(6))),
});
const render = vm.runInContext(`${implementation}\n;renderAndSaveVideoOnce;`, context);
function run(args) {
  return execFileSync(binary, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { maxBuffer: 8 * 1024 * 1024 });
}
for (const fps of [16,24,30]) {
  test(`P2P final ${fps} fps renderer retains frame identities over repeated studio renders`, async t => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-final-frame-drift-'));
    t.after(() => fs.rmSync(temporaryRoot, {recursive:true,force:true}));
    const count = fps + 1;
    let framePath = path.join(temporaryRoot,'source');
    fs.mkdirSync(framePath);
    run(['-f','lavfi','-i',`nullsrc=s=32x32:r=${fps},geq=lum='20+N*5':cb=128:cr=128`,
      '-frames:v',String(count),'-start_number','0',path.join(framePath,'%d.png')]);
    for(let stage=0;stage<4;stage+=1) {
      const outputPath=path.join(temporaryRoot,`render-${stage}.mp4`);
      await render({duration:count/fps,framePath,outputPath,audioList:[],framesPerSecond:fps,
        applyAudioDucking:false,isExpressGeneration:false,outroImagePath:null});
      const metadata = await new Promise((resolve,reject) => ffmpeg.ffprobe(outputPath,(error,value)=>error?reject(error):resolve(value)));
      const stream=metadata.streams.find(item=>item.codec_type==='video');
      assert.equal(Number(stream.nb_frames),count);
      assert.equal(stream.avg_frame_rate,`${fps}/1`);
      assert.ok(Math.abs(Number(stream.duration)-count/fps)<1/(fps*1000));
      const pixels=run(['-i',outputPath,'-map','0:v:0','-f','rawvideo','-pix_fmt','gray','pipe:1']);
      const pixelsPerFrame=32*32;
      assert.equal(pixels.length,count*pixelsPerFrame);
      const identities=Array.from({length:count},(_,i)=>pixels[i*pixelsPerFrame+16]);
      for(let index=1;index<count;index+=1) assert.ok(identities[index]>identities[index-1],
        `frame ${index} was duplicated or reordered at stage ${stage}`);
      framePath=path.join(temporaryRoot,`frames-${stage}`);fs.mkdirSync(framePath);
      run(['-i',outputPath,'-vf',`setpts=PTS-STARTPTS,fps=${fps}:start_time=0:round=near:eof_action=round`,
        '-fps_mode','passthrough','-start_number','0',path.join(framePath,'%d.png')]);
    }
  });
}

test('final rendering rejects a short frame sequence instead of cloning its last frame', async t => {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'samsar-short-final-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 run(['-f','lavfi','-i','testsrc2=s=32x32:r=30','-frames:v','29','-start_number','0',path.join(root,'%d.png')]);
 await assert.rejects(async()=>render({duration:1,framePath:root,outputPath:path.join(root,'final.mp4'),
   audioList:[],framesPerSecond:30,applyAudioDucking:false,isExpressGeneration:false,outroImagePath:null}),/frame|incomplete/i);
});

for(const fps of [16,24,30]) test(`final ${fps} fps A/V render retains motion and delayed audio through its fractional last second`,async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'samsar-final-av-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const count=fps+1,duration=count/fps,audioPath=path.join(root,'sound.wav'),outputPath=path.join(root,'final.mp4');
 run(['-f','lavfi','-i',`nullsrc=s=32x32:r=${fps},geq=lum='20+N*5':cb=128:cr=128`,'-frames:v',String(count),'-start_number','0',path.join(root,'%d.png')]);
 run(['-f','lavfi','-i',`sine=frequency=1000:sample_rate=48000:duration=${duration-0.25}`,'-af','adelay=250',audioPath]);
 await render({duration,framePath:root,outputPath,framesPerSecond:fps,applyAudioDucking:false,isExpressGeneration:false,
   audioList:[{path:audioPath,startTime:0,endTime:duration,volume:1,fadeOnEdges:false}]});
 const meta=await new Promise((resolve,reject)=>ffmpeg.ffprobe(outputPath,(e,m)=>e?reject(e):resolve(m)));
 const video=meta.streams.find(s=>s.codec_type==='video'),audio=meta.streams.find(s=>s.codec_type==='audio');
 assert.equal(Number(video.nb_frames),count);assert.ok(Math.abs(Number(audio.duration)-duration)<1/fps);
 const pixels=run(['-i',outputPath,'-map','0:v:0','-pix_fmt','gray','-f','rawvideo','-']);
 assert.equal(pixels.length/1024,count);for(let i=1;i<count;i++)assert.ok(pixels[i*1024]>pixels[(i-1)*1024]);
 const pcm=run(['-i',outputPath,'-map','0:a:0','-ar','48000','-ac','1','-f','s16le','-']);
 let first=-1;for(let i=0;i<pcm.length/2;i++){if(Math.abs(pcm.readInt16LE(i*2))>100){first=i;break;}}
 assert.ok(Math.abs(first/48000-0.25)<0.015,`audio moved to ${first/48000}`);
});

test('an explicit audio-only timeline extension retains the complete source motion before its intentional hold',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'samsar-final-hold-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 run(['-f','lavfi','-i',"nullsrc=s=32x32:r=30,geq=lum='20+N*5':cb=128:cr=128",'-frames:v','30','-start_number','0',path.join(root,'%d.png')]);
 const outputPath=path.join(root,'final.mp4');
 await render({duration:2,framePath:root,outputPath,framesPerSecond:30,audioList:[],allowVideoTailPadding:true});
 const pixels=run(['-i',outputPath,'-map','0:v:0','-pix_fmt','gray','-f','rawvideo','-']);
 assert.equal(pixels.length/1024,60);for(let i=1;i<30;i++)assert.ok(pixels[i*1024]>pixels[(i-1)*1024]);
 assert.ok(Math.abs(pixels[59*1024]-pixels[29*1024])<=1);
});
