import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { getLayerFrameRange } from './utils/FrameClock.js';
import { completeVideoOutput } from './billing/VideoCompletion.js';
import { captureMovieResourceTimeline, synchronizeMovieResourceTimeline } from './utils/MovieResourceTimeline.js';
import { buildBaseAiVideoCompletionUpdate, resolveCompletedLayerDuration, resolveConnectedAudioLayerDuration,
  buildAiVideoTimelineWriteGuard } from './VideoGenerationListener.js';
const source=fs.readFileSync(new URL('./VideoGenerationListener.js',import.meta.url),'utf8');
function fn(name){const i=source.indexOf(`function ${name}(`);return source.slice(source.slice(i-6,i)==='async '?i-6:i,source.indexOf('\n}\n',i)+2);}
for(const model of ['SYNCLIPSYNC','MMAUDIOV2']) test(`${model} incomplete paid output falls back once without shifting scenes or resubmitting`,async()=>{
 const layer={_id:'layer',duration:1,durationOffset:0,aiVideoLayer:'/base.mp4',hasAiVideoLayer:true,
   lipSyncVideoLayer:'/old-lip.mp4',soundEffectVideoLayer:'/old-sfx.mp4'};
 const audio={startTime:0.25,endTime:0.75,duration:0.5};let saves=0,deletes=0,charges=0;
 const session={layers:[layer,{_id:'next',duration:1,durationOffset:1}],audioLayers:[audio],
   movieResourceList:{scenes:[{visual:'Source scene',duration:1},{visual:'Next scene',duration:1}],sounds:[]},
   save:async()=>{saves++;}};
 const originalPlan=structuredClone(session.movieResourceList);
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
 assert.deepEqual(session.movieResourceList,originalPlan);
 assert.equal(layer.aiVideoLayer,'/base.mp4');
 const prefix=model==='MMAUDIOV2'?'soundEffect':'lipSync';
 assert.equal(layer[`${prefix}VideoLayer`],null);assert.equal(layer[`${prefix}GenerationPending`],false);
 assert.equal(layer[`${prefix}VideoGenerationStatus`],'FAILED');assert.match(layer[`${prefix}VideoGenerationError`],/expected 30/);
});

for(const model of ['SYNCLIPSYNC','MMAUDIOV2']) test(`${model} successful derivative keeps speech timing while delivering the expected audio`,async()=>{
 const layer={_id:'layer',duration:1,durationOffset:0,aiVideoLayer:'/base.mp4',imageSession:{activeItemList:[]},clipEnd:true,clipEndFrames:30};
 const audio={generationType:'speech',connectedLayerId:'layer',startTime:0.1,duration:0.5,endTime:0.6};
 const session={layers:[layer],audioLayers:[audio],generations:[],totalDuration:1,isExpressGeneration:true,
   movieResourceList:{scenes:[{visual:'A speaker',duration:1}],sounds:[{type:'speech',sceneIndex:0,audio:'Hello',duration:0.5}]}};
 let audioDeliveries=0,realignments=0;
 const context={console,getCanvasDimensionsForAspectRatio:()=>({width:32,height:32}),getDBConnectionString:async()=>{},
   VideoSession:{findById:async()=>session,updateOne:async()=>({nModified:1})},getSessionFramesPerSecond:async()=>30,
   LIPSYNC_MODELS:['SYNCLIPSYNC'],SOUND_EFFECT_MODELS:['MMAUDIOV2'],isSoundEffectGenerationForLayer:()=>model==='MMAUDIOV2',
   isStaleSoundEffectGenerationForLayer:()=>false,resolveCompletedLayerDuration,
   captureMovieResourceTimeline,synchronizeMovieResourceTimeline,
   realignAudioVideoLayerToVideoLayer:async()=>{audioDeliveries++;},realignAudioLayersToLayers:async()=>{realignments++;}};
 const mark=vm.runInNewContext(fn('markVideoLayerGenerationAsComplete')+';markVideoLayerGenerationAsComplete;',context);
 await mark('/complete.mp4',{sessionId:'session',layerId:'layer',model,isAudioVideoGeneration:true,duration:1,
   durationDiff:0,generatedFrameCount:31,generatedFrameDuration:31/30,startFrameGenerationPath:'/first.png',lastFrameGenerationPath:'/last.png'});
 assert.equal(layer.duration,1);assert.equal(layer.endFrame,31);assert.equal(layer.clipEnd,false);
 assert.equal(session.movieResourceList.scenes[0].duration,1);
 assert.equal(audio.startTime,0.1);assert.equal(realignments,0);
 assert.equal(audioDeliveries,model==='MMAUDIOV2'?1:0,'SFX audio is attached while lip sync keeps original speech');
});

test('measured base-video completion synchronizes scene and final speech timing in the existing writes',async()=>{
 const actualDuration=121/24;
 const sourceSceneRef={version:1,sourceSessionId:'original',sceneIndex:0,
   scene:{visual:'A speaker',duration:10},sounds:[{type:'speech',sceneIndex:0,audio:'Hello',duration:8}]};
 const frozenReference=structuredClone(sourceSceneRef);
 const layer={_id:'speaker',duration:10,durationOffset:0,layerAiVideoType:'character',
   layerBaseAiImageType:'character',sourceSceneIndex:0,sourceSceneRef,
   imageSession:{activeItemList:[],sourceSceneRef:structuredClone(sourceSceneRef)}};
 const audio={_id:'speech',generationType:'speech',connectedLayerId:'speaker',connectedLayerIndex:0,
   prompt:'Hello',duration:8,startTime:0,endTime:8};
 const next={_id:'next',duration:5,durationOffset:10,layerBaseAiImageType:'scene',imageSession:{activeItemList:[]}};
 const outro={_id:'outro',duration:8,durationOffset:15,layerBaseAiImageType:'none',skipAiVideoGeneration:true};
 const session={_id:'original',framesPerSecond:24,layers:[layer,next,outro],audioLayers:[audio],
   generations:[],totalDuration:23,isExpressGeneration:true,
   movieResourceList:{duration:15,totalDuration:23,scenes:[{visual:'A speaker',duration:10},{visual:'Next',duration:5}],
     sounds:[{type:'speech',sceneIndex:0,audio:'Hello',duration:8}]}};
 const writes=[];
 const context={console,getCanvasDimensionsForAspectRatio:()=>({width:32,height:32}),
   getDBConnectionString:async()=>{},getSessionFramesPerSecond:async()=>24,
   VideoSession:{findById:async()=>session,updateOne:async(_filter,update)=>{writes.push(structuredClone(update.$set));return{nModified:1};}},
   LIPSYNC_MODELS:['SYNCLIPSYNC'],SOUND_EFFECT_MODELS:['MMAUDIOV2'],
   isSoundEffectGenerationForLayer:()=>false,isStaleSoundEffectGenerationForLayer:()=>false,
   buildBaseAiVideoCompletionUpdate,resolveCompletedLayerDuration,resolveConnectedAudioLayerDuration,
   captureMovieResourceTimeline,synchronizeMovieResourceTimeline,buildAiVideoTimelineWriteGuard};
 const mark=vm.runInNewContext(['staleTimelineWrite','realignAudioLayersToLayers','markVideoLayerGenerationAsComplete'].map(fn).join('\n')+
   ';markVideoLayerGenerationAsComplete;',context);
 await mark('/new-base.mp4',{_id:'request',sessionId:'original',layerId:'speaker',model:'COSMOS3SUPERI2V',
   isAudioVideoGeneration:false,clipLayerToAiVideo:true,duration:actualDuration,durationDiff:actualDuration-10,
   generatedFrameCount:121,generatedFrameDuration:actualDuration,remoteAIVideoLink:'https://cdn.example/new-base.mp4'});
 assert.equal(writes.length,2,'completion and existing final-audio update are the only writes');
 assert.equal(writes[0].movieResourceList.scenes[0].duration,actualDuration);
 assert.equal(writes[0].layers[1].durationOffset,actualDuration);
 assert.equal(writes[0].totalDuration,actualDuration+13);
 assert.equal(session.totalDuration,actualDuration+13);
 assert.equal(writes[1].movieResourceList.totalDuration,actualDuration+13);
 assert.equal(writes[1].movieResourceList.duration,actualDuration+5);
 assert.equal(writes[1].audioLayers[0].duration,actualDuration);
 assert.equal(writes[1].audioLayers[0].startTime,0);
 assert.equal(writes[1].audioLayers[0].endTime,actualDuration);
 assert.equal(writes[1].movieResourceList.sounds[0].duration,actualDuration);
 assert.equal(writes[1].movieResourceList.scenes.length,2,'the outro is not a narrative scene');
 assert.deepEqual(layer.sourceSceneRef,frozenReference);
 assert.deepEqual(layer.imageSession.sourceSceneRef,frozenReference);
});

test('bulk audio alignment retries a fresh compacted timeline instead of restoring deleted scenes or audio',async()=>{
 const old={_id:'session',updatedAt:new Date('2026-11-08T01:00:00Z'),__v:1,
   layers:[{_id:'failed',duration:10,durationOffset:0},{_id:'kept',duration:5,durationOffset:10}],
   audioLayers:[{_id:'removed-audio',generationType:'speech',connectedLayerId:'failed',duration:10,startTime:0},
     {_id:'kept-audio',generationType:'speech',connectedLayerId:'kept',duration:4,startTime:10}],
   movieResourceList:{scenes:[{visual:'Failed',duration:10},{visual:'Kept',duration:5}],sounds:[]}};
 captureMovieResourceTimeline(old);
 const fresh=structuredClone(old);fresh.updatedAt=new Date('2026-11-08T01:00:01Z');fresh.__v=2;
 fresh.layers.shift();fresh.layers[0].durationOffset=0;fresh.audioLayers.shift();
 fresh.audioLayers[0].startTime=0.5;fresh.audioLayers[0].endTime=4.5;
 synchronizeMovieResourceTimeline(fresh);
 let reads=0,writes=0,applied=0;
 const context={console,getDBConnectionString:async()=>{},captureMovieResourceTimeline,synchronizeMovieResourceTimeline,
   resolveConnectedAudioLayerDuration,buildAiVideoTimelineWriteGuard,
   VideoSession:{findById:async()=>++reads===1?old:fresh,updateOne:async(filter,update)=>{
     writes++;
     if(writes===1){assert.equal(filter.__v,1);assert.equal(filter.layers.$size,2);return{matchedCount:0};}
     assert.equal(filter.__v,2);assert.equal(filter.layers.$size,1);assert.equal(filter['layers.0._id'],'kept');
     assert.equal(filter['layers.0.durationOffset'],0);
     fresh.audioLayers=structuredClone(update.$set.audioLayers);
     fresh.movieResourceList=structuredClone(update.$set.movieResourceList);applied++;
     return{matchedCount:1};
   }}};
 const align=vm.runInNewContext(['staleTimelineWrite','realignAudioLayersToLayers'].map(fn).join('\n')+';realignAudioLayersToLayers;',context);
 await align({sessionId:'session'});
 assert.equal(reads,2);assert.equal(writes,2);assert.equal(applied,1);
 assert.deepEqual(fresh.movieResourceList.scenes.map(scene=>scene.timelineLayerId),['kept']);
 assert.deepEqual(fresh.audioLayers.map(audio=>audio._id),['kept-audio']);
 assert.equal(fresh.audioLayers[0].startTime,0.5);
 assert.equal(fresh.movieResourceList.sounds[0].startTime,0.5);
});
