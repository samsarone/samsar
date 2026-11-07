import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { getLayerFrameRange, frameCountToSeconds } from '../utils/FrameClock.js';
const source=fs.readFileSync(new URL('./VideoSession.js',import.meta.url),'utf8');
const start=source.indexOf('export async function addAiVideoLayerToSession(');
const implementation=source.slice(start,source.indexOf('\n}\n',start)+2).replace('export ','');
function harness({derivative=false,frameCount=20,clipStart=0}={}) {
 const layer={_id:'layer',duration:1,durationOffset:0,imageSession:{activeItemList:[]},
   clipStart:clipStart>0,clipStartFrames:clipStart,clipEnd:true,clipEndFrames:15};
 let extractions=0,saves=0;
 const session={layers:[layer],save:async()=>{saves++;throw new Error('SAVE_CHECKPOINT');}};
 const extract=async()=>{extractions++;return {frameCount,duration:frameCount/30,frameDuration:frameCount/30,firstFrame:'/frames/0.png',lastFrame:`/frames/${frameCount-1}.png`};};
 const context={getDBConnectionString:async()=>{},requireVideoSessionForStudioAccess:async()=>session,
   resetLayerVideoEditState(){},prepareLayerActiveItemsForVideoReplacement(){},getCanvasDimensionsForAspectRatio:()=>({width:32,height:32}),
   resolveProcessorAssetAbsolutePath:x=>x,fs:{existsSync:()=>true},getModelType:()=>({isAudioVideoModel:derivative,isLipSyncModel:derivative,isSoundEffectModel:false}),
   getSessionFramesPerSecondWithLog:()=>30,getLayerFrameRange,getVideoTimeline:async()=>({frameCount}),
   processVideoAsFrames:extract,processVideoAsFramesAndAudio:extract,getFrameSafeDurationSecondsFromFrameCount:frameCountToSeconds,
   getRelativeAssetPathFromAbsolute:x=>x};
 const apply=vm.runInNewContext(implementation+';addAiVideoLayerToSession;',context);
 return {layer,apply:()=>apply('user',{sessionId:'session',layerId:'layer',videoURL:'/source.mp4'}),extractions:()=>extractions,saves:()=>saves};
}
test('manual short derivative fails before replacing cached frames or saving the scene',async()=>{
 const h=harness({derivative:true});await assert.rejects(h.apply(),/expected 30 frames, received 20/);
 assert.equal(h.extractions(),0);assert.equal(h.saves(),0);assert.equal(h.layer.duration,1);
});
test('manual longer derivative preserves the scene duration and source start trim',async()=>{
 const h=harness({derivative:true,frameCount:90,clipStart:30});await assert.rejects(h.apply(),/SAVE_CHECKPOINT/);
 assert.equal(h.layer.duration,1);assert.equal(h.layer.clipStartFrames,30);assert.equal(h.extractions(),1);
});
test('manual base replacement uses its real motion length without adding a last-frame image',async()=>{
 const h=harness({frameCount:20,clipStart:30});await assert.rejects(h.apply(),/SAVE_CHECKPOINT/);
 assert.equal(h.layer.duration,20/30);assert.equal(h.layer.endFrame,20);
 assert.equal(h.layer.clipStart,false);assert.equal(h.layer.clipEnd,false);assert.equal(h.layer.imageSession.activeItemList.length,0);
});
