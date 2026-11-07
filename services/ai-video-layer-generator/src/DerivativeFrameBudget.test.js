import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { getLayerFrameRange } from './utils/FrameClock.js';
import { completeVideoOutput } from './billing/VideoCompletion.js';
const source=fs.readFileSync(new URL('./VideoGenerationListener.js',import.meta.url),'utf8');
function fn(name){const i=source.indexOf(`function ${name}(`);return source.slice(source.slice(i-6,i)==='async '?i-6:i,source.indexOf('\n}\n',i)+2);}
for(const model of ['SYNCLIPSYNC','MMAUDIOV2']) test(`${model} incomplete paid output falls back once without shifting scenes or resubmitting`,async()=>{
 const layer={_id:'layer',duration:1,durationOffset:0,aiVideoLayer:'/base.mp4',hasAiVideoLayer:true,
   lipSyncVideoLayer:'/old-lip.mp4',soundEffectVideoLayer:'/old-sfx.mp4'};
 const audio={startTime:0.25,endTime:0.75,duration:0.5};let saves=0,deletes=0,charges=0;
 const session={layers:[layer,{_id:'next',duration:1,durationOffset:1}],audioLayers:[audio],save:async()=>{saves++;}};
 const payload={_id:'queue',sessionId:'session',layerId:'layer',model,isAudioVideoGeneration:true,
   retryOnFail:true,numRetries:0,generationType:model==='MMAUDIOV2'?'sound_effect':'lip_sync',
   videoBillingPolicy:'adapter',submittedAdapter:'native',videoBillingSavedResult:{localVideoLink:'/short.mp4'}};
 const context={console:{error(){}},getLayerFrameRange,getCanvasDimensionsForAspectRatio:()=>({width:32,height:32}),
   getDBConnectionString:async()=>{},VideoSession:{findById:async()=>session},getSessionFramesPerSecond:async()=>30,
   LIPSYNC_MODELS:['SYNCLIPSYNC'],SOUND_EFFECT_MODELS:['MMAUDIOV2'],isSoundEffectGenerationForLayer:()=>model==='MMAUDIOV2',
   MAX_LIPSYNC_PROVIDER_PENDING_MS:60000,
   AIVideoLayerGeneration:{findByIdAndDelete:async()=>{deletes++;}},
   prepareTimelineDerivative:async()=>{throw Object.assign(new Error('Incomplete derivative: expected 30 frames, received 20.'),{code:'VIDEO_FRAME_BUDGET_MISMATCH'});}};
 const deliver=vm.runInNewContext(['getProviderFailureMessage','processLipSyncGenerationFailed','processVideoGenerationCompletion']
   .map(fn).join('\n')+';processVideoGenerationCompletion;',context);
 await completeVideoOutput(payload,{}, {env:{SAMSAR_DEPLOYMENT_EDITION:'standalone'},
   bill:async()=>({id:'charge'}),recordCharge:async()=>{charges++;},deliver});
 assert.equal(saves,1);assert.equal(deletes,1);assert.equal(charges,1);
 assert.equal(layer.duration,1);assert.equal(session.layers[1].durationOffset,1);assert.equal(audio.startTime,0.25);
 assert.equal(layer.aiVideoLayer,'/base.mp4');
 const prefix=model==='MMAUDIOV2'?'soundEffect':'lipSync';
 assert.equal(layer[`${prefix}VideoLayer`],null);assert.equal(layer[`${prefix}GenerationPending`],false);
 assert.equal(layer[`${prefix}VideoGenerationStatus`],'FAILED');assert.match(layer[`${prefix}VideoGenerationError`],/expected 30/);
});

for(const model of ['SYNCLIPSYNC','MMAUDIOV2']) test(`${model} successful derivative keeps speech timing while delivering the expected audio`,async()=>{
 const layer={_id:'layer',duration:1,durationOffset:0,aiVideoLayer:'/base.mp4',imageSession:{activeItemList:[]},clipEnd:true,clipEndFrames:30};
 const audio={generationType:'speech',connectedLayerId:'layer',startTime:0.1,duration:0.5,endTime:0.6};
 const session={layers:[layer],audioLayers:[audio],generations:[],totalDuration:1,isExpressGeneration:true};
 let audioDeliveries=0,realignments=0;
 const context={console,getCanvasDimensionsForAspectRatio:()=>({width:32,height:32}),getDBConnectionString:async()=>{},
   VideoSession:{findById:async()=>session,updateOne:async()=>({nModified:1})},getSessionFramesPerSecond:async()=>30,
   LIPSYNC_MODELS:['SYNCLIPSYNC'],SOUND_EFFECT_MODELS:['MMAUDIOV2'],isSoundEffectGenerationForLayer:()=>model==='MMAUDIOV2',
   isStaleSoundEffectGenerationForLayer:()=>false,resolveCompletedLayerDuration:({currentLayerDuration})=>currentLayerDuration,
   realignAudioVideoLayerToVideoLayer:async()=>{audioDeliveries++;},realignAudioLayersToLayers:async()=>{realignments++;}};
 const mark=vm.runInNewContext(fn('markVideoLayerGenerationAsComplete')+';markVideoLayerGenerationAsComplete;',context);
 await mark('/complete.mp4',{sessionId:'session',layerId:'layer',model,isAudioVideoGeneration:true,duration:1,
   durationDiff:0,generatedFrameCount:30,generatedFrameDuration:1,startFrameGenerationPath:'/first.png',lastFrameGenerationPath:'/last.png'});
 assert.equal(layer.duration,1);assert.equal(layer.endFrame,30);assert.equal(layer.clipEnd,false);
 assert.equal(audio.startTime,0.1);assert.equal(realignments,0);
 assert.equal(audioDeliveries,model==='MMAUDIOV2'?1:0,'SFX audio is attached while lip sync keeps original speech');
});
