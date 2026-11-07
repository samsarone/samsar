import test from 'node:test';
import assert from 'node:assert/strict';
import { __testOnly__ } from './VideoSessionJoinAPI.js';
import { getLayerFrameRange } from '../../utils/FrameClock.js';
const join = sessions => __testOnly__.buildJoinedLayersAndAudioLayers(sessions);
test('joining fractional scenes preserves the original absolute frame budgets and contiguous offsets', () => {
 const layers = Array.from({length:10}, (_,i) => ({_id:`l${i}`, duration:1.03, durationOffset:i*1.03,
   hasAiVideoLayer:true, aiVideoLayer:'/source.mp4', frames:Array(31).fill('frame'), imageSession:{activeItemList:[]}}));
 const counts = layers.map(layer => getLayerFrameRange(layer,30).frameCount);
 const result = join([{framesPerSecond:30,layers,audioLayers:[]}]);
 let offset=0;
 result.layers.forEach((layer,i) => {assert.equal(layer.durationOffset,offset/30);assert.equal(layer.duration,counts[i]/30);offset+=counts[i];});
 assert.equal(result.totalDuration,309/30);
});
test('joining keeps a source video trim when its URL has not been physically trimmed', () => {
 const result=join([{framesPerSecond:30,layers:[{_id:'trimmed',duration:3,durationOffset:0,hasAiVideoLayer:true,
 aiVideoLayer:'/full-original.mp4',clipStart:true,clipStartFrames:60,clipEnd:true,clipEndFrames:30,
 startFrame:0,endFrame:180,aiLayerStartFrame:'/frames/0.png',aiLayerEndFrame:'/frames/179.png',imageSession:{activeItemList:[]}}]}]);
 const layer=result.layers[0];
 assert.equal(layer.aiVideoLayer,'/full-original.mp4');assert.equal(layer.duration,3);
 assert.equal(layer.clipStart,true);assert.equal(layer.clipStartFrames,60);
 assert.equal(layer.clipEnd,true);assert.equal(layer.clipEndFrames,30);assert.equal(layer.endFrame,180);
});

test('joining a different session FPS converts source trims and available source frames together',()=>{
 const result=join([{framesPerSecond:30,layers:[{_id:'first',duration:1,durationOffset:0,imageSession:{activeItemList:[]}}]},
 {framesPerSecond:24,layers:[{_id:'second',duration:3,durationOffset:0,hasAiVideoLayer:true,aiVideoLayer:'/original.mp4',
 clipStart:true,clipStartFrames:48,clipEnd:true,clipEndFrames:24,startFrame:0,endFrame:144,
 aiLayerStartFrame:'/frames/0.png',aiLayerEndFrame:'/frames/143.png',imageSession:{activeItemList:[]}}]}]);
 const layer=result.layers[1];assert.equal(layer.duration,3);assert.equal(layer.durationOffset,1);
 assert.equal(layer.clipStartFrames,60);assert.equal(layer.clipEndFrames,30);assert.equal(layer.endFrame,180);assert.equal(result.totalDuration,4);
});
