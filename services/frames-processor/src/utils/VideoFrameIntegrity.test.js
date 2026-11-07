import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { getFramesPerSecondFromValue } from './FpsUtils.js';
const main=fs.readFileSync(new URL('../main.js',import.meta.url),'utf8');
const worker=fs.readFileSync(new URL('../frameWorker.js',import.meta.url),'utf8');
function fn(source,name) {const i=source.indexOf(`function ${name}(`);assert.ok(i>=0,name);return source.slice(source.slice(i-6,i)==='async '?i-6:i,source.indexOf('\n}\n',i)+2);}
function fixture(t) {const dir=fs.mkdtempSync(path.join(os.tmpdir(),'samsar-integrity-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
function resolver() {return vm.runInNewContext(fn(worker,'resolveNarratorAvatarFramePath')+';resolveNarratorAvatarFramePath;',
 {fs,path,getFramesPerSecondFromValue,resolveExistingOrNearestFramePath:p=>fs.existsSync(p)?p:path.join(path.dirname(p),'29.png')});}
test('adjacent avatar segments select frame zero of the new segment at the exact boundary',t=>{
 const dir=fixture(t);const a=path.join(dir,'a'),b=path.join(dir,'b');fs.mkdirSync(a);fs.mkdirSync(b);fs.writeFileSync(path.join(b,'0.png'),'png');
 assert.equal(resolver()({enabled:true,segments:[{framesDir:a,startTime:0,endTime:1,framesPerSecond:30},{framesDir:b,startTime:1,endTime:2,framesPerSecond:30}]},1000),path.join(b,'0.png'));
});
test('an avatar ends at its actual frame count rather than freezing its last frame',t=>{
 const dir=fixture(t);fs.writeFileSync(path.join(dir,'29.png'),'png');
 assert.equal(resolver()({enabled:true,framesDir:dir,framesPerSecond:30,frameCount:30},1000),null);
});
test('source cache checks every frame, including gaps and empty files',t=>{
 const dir=fixture(t);const count=vm.runInNewContext(fn(main,'getCompleteFrameCount')+';getCompleteFrameCount;',{fs,path});
 fs.writeFileSync(path.join(dir,'0.png'),'png');fs.writeFileSync(path.join(dir,'2.png'),'png');assert.equal(count(dir),0);
 fs.writeFileSync(path.join(dir,'1.png'),'');assert.equal(count(dir),0);
 fs.writeFileSync(path.join(dir,'1.png'),'png');assert.equal(count(dir),3);
});

function cacheHarness(root) {
 let extractions=0;
 const context={fs,path,console,getFramesPerSecondFromValue,AI_VIDEO_FRAME_SOURCE_MANIFEST:'.source.json',
   extractAiVideoFramesWithFfmpeg:async({aiFramesDir})=>{extractions++;for(let i=0;i<3;i++)fs.writeFileSync(path.join(aiFramesDir,`${i}.png`),`frame-${i}`);}};
 const names=['getCompleteFrameCount','getFrameSourceIdentity','readFrameSourceManifest','writeFrameSourceManifest',
   'isFrameSourceManifestCurrent','ensureOverlayFrameCache'];
 const prepare=vm.runInNewContext(names.map(name=>fn(main,name)).join('\n')+';ensureOverlayFrameCache;',context);
 const videoPath=path.join(root,'source.mp4');fs.writeFileSync(videoPath,'source');
 return {prepare,extractions:()=>extractions,options:{videoPath,normalizedVideoPath:'/source.mp4',framesDir:path.join(root,'frames'),
   framesPerSecond:24,canvasDimensions:{width:32,height:32}}};
}
test('avatar cache re-extracts on FPS, size, source, dimension, and interior-gap changes',async t=>{
 const h=cacheHarness(fixture(t));let options=h.options;
 assert.equal(await h.prepare(options),3);assert.equal(await h.prepare(options),3);assert.equal(h.extractions(),1);
 options={...options,framesPerSecond:30};await h.prepare(options);assert.equal(h.extractions(),2);
 fs.writeFileSync(options.videoPath,'replacement-source');await h.prepare(options);assert.equal(h.extractions(),3);
 options={...options,normalizedVideoPath:'/other.mp4'};await h.prepare(options);assert.equal(h.extractions(),4);
 options={...options,canvasDimensions:{width:64,height:32}};await h.prepare(options);assert.equal(h.extractions(),5);
 fs.unlinkSync(path.join(options.framesDir,'1.png'));await h.prepare(options);assert.equal(h.extractions(),6);
 assert.equal(fs.existsSync(path.join(options.framesDir,'1.png')),true);
 assert.equal(fs.existsSync(path.join(options.framesDir,'3.png')),false,'never manufacture a held tail');
});
test('missing or corrupt source video frames fail composition without writing a blank result',async t=>{
 const root=fixture(t);const results=[];
 const processFrame=vm.runInNewContext(fn(worker,'processFrameAtIndex')+';processFrameAtIndex;',{
   fs,path,console:{error(){}},framesPerSecond:30,frameDuration:1000/30,applyCanvasTransformations(){},
   loadImage:async()=>{throw new Error('Invalid PNG');}});
 const layer={_id:'scene',imageSession:{activeItemList:[]}};
 const ctx={clearRect(){},save(){}};
 const call=()=>processFrame({},0,{},ctx,layer,results,0,1,'render',path.join(root,'out'),true,root,false,{width:32,height:32},[]);
 await assert.rejects(call(),/Missing source video frame/);assert.equal(results.length,0);
 fs.writeFileSync(path.join(root,'0.png'),'corrupt');
 fs.writeFileSync(path.join(root,'.source.json'),'{}');
 await assert.rejects(call(),/Invalid PNG/);assert.equal(results.length,0);assert.equal(fs.existsSync(path.join(root,'out')),false);
 assert.equal(fs.existsSync(path.join(root,'.source.json')),false,'retry must rebuild the corrupt source cache');
});

for(const type of ['ai_video','lip_sync','sound_effect']) test(`${type} cache repairs interior loss and rejects a truly short source without padding`,async t=>{
 const root=fixture(t),video=path.join(root,'source.mp4');fs.writeFileSync(video,'source');let extractions=0;
 const context={fs,path,console:{log(){},error(){}},getFramesPerSecondFromValue,AI_VIDEO_FRAME_SOURCE_MANIFEST:'.source.json',
   FatalFrameGenerationError:Error,normalizeAssetPath:x=>x,resolveAssetAbsolutePath:()=>video,
   resolveSamsarProcessorAssetsRoot:version=>path.join(root,version),
   extractAiVideoFramesWithFfmpeg:async({aiFramesDir})=>{extractions++;for(let i=0;i<3;i++)fs.writeFileSync(path.join(aiFramesDir,`${i}.png`),`frame-${i}`);}};
 const names=['getCompleteFrameCount','getFrameSourceIdentity','getLayerVideoSourceType','readFrameSourceManifest','writeFrameSourceManifest',
   'isFrameSourceManifestCurrent','ensureAiVideoFramesAvailable'];
 const ensure=vm.runInNewContext(names.map(name=>fn(main,name)).join('\n')+';ensureAiVideoFramesAvailable;',context);
 const layer={aiVideoLayer:'/source.mp4',...(type==='lip_sync'?{lipSyncVideoLayer:'/lip.mp4'}:type==='sound_effect'?{soundEffectVideoLayer:'/sfx.mp4'}:{})};
 const options={layer,sessionId:'s',layerId:'l',canvasDimensions:{width:32,height:32},framesPerSecond:30,requiredFrameCount:3};
 await ensure(options);await ensure(options);assert.equal(extractions,1);
 const frames=path.join(root,'v2','ai_video','frames','s','l',...(type==='ai_video'?[]:['audio_video']));
 fs.unlinkSync(path.join(frames,'1.png'));await ensure(options);assert.equal(extractions,2);
 assert.equal(fs.readFileSync(path.join(frames,'1.png'),'utf8'),'frame-1');
 await assert.rejects(ensure({...options,requiredFrameCount:5}),/expected 5 frames, received 3/);
 assert.equal(fs.existsSync(path.join(frames,'3.png')),false);
});
