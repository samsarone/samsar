import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildExpressLipSyncPromptMessages,
  validateSpeakerFaceResponse,
  shouldPrepareExpressLipSyncFace,
  SPEAKER_FACE_RESPONSE_FORMAT,
  resolveExpressLipSyncPromptContext,
} from './ExpressLipSyncPrompt.js';

test('resolves the connected speech speaker and selected starting-frame description', () => {
  const context = resolveExpressLipSyncPromptContext({
    layers: [
      {
        _id: 'layer-1',
        prompt: 'A tense discussion unfolds beside the conference table.',
        activeImageCandidate: {
          description: 'Maya in a blue jacket sits on the left; Arun in a grey shirt stands close to camera.',
        },
      },
    ],
    audioLayers: [
      {
        _id: 'audio-1',
        generationType: 'speech',
        connectedLayerId: 'layer-1',
        speakerCharacterName: 'Maya',
        prompt: 'We need to reconsider the launch date.',
      },
    ],
  }, {
    layerId: 'layer-1',
    audioPrompt: 'We need to reconsider the launch date.',
  });

  assert.deepEqual(context, {
    layerId: 'layer-1',
    audioLayerId: 'audio-1',
    startingFrameDescription: 'Maya in a blue jacket sits on the left; Arun in a grey shirt stands close to camera.',
    sceneDescription: 'A tense discussion unfolds beside the conference table.',
    speechText: 'We need to reconsider the launch date.',
    speakerName: 'Maya',
    speakerDescription: '',
  });
});

test('falls back to the connected layer index for legacy speech bindings', () => {
  const context = resolveExpressLipSyncPromptContext({
    layers: [{ _id: 'layer-1' }, { _id: 'layer-2', activeImageDescription: 'Two people at a cafe.' }],
    audioLayers: [{
      _id: 'audio-2',
      generationType: 'speech',
      connectedLayerIndex: 1,
      speaker: 'The barista',
      prompt: 'Your order is ready.',
    }],
  }, { layerId: 'layer-2' });

  assert.equal(context.audioLayerId, 'audio-2');
  assert.equal(context.speakerName, 'The barista');
  assert.equal(context.speechText, 'Your order is ready.');
});

test('face response rejects malformed, out-of-bounds and inconsistent selections', () => {
  const dimensions = { width: 100, height: 80 };
  for (const value of ['bad', null, [], {}, {status:'identified',face_box:[0,0,100,80]},
    {status:'identified',face_box:[20,10,10,30]}, {status:'identified',face_box:[0,0,1.5,3]},
    {status:'ambiguous',face_box:[0,0,10,10]}, {status:'identified',face_box:null},
    {status:'identified',face_box:[0,0,10,10],extra:true}]) {
    assert.equal(validateSpeakerFaceResponse(value, dimensions), null);
  }
  assert.deepEqual(validateSpeakerFaceResponse('{"status":"identified","face_box":[1,2,30,40]}', dimensions), {status:'identified',face_box:[1,2,30,40]});
  assert.deepEqual(validateSpeakerFaceResponse({status:'not_visible',face_box:null}, dimensions), {status:'not_visible',face_box:null});
});

test('face inference is gated to Express Sync only', () => {
  assert.equal(shouldPrepareExpressLipSyncFace({model:'SYNCLIPSYNC',isExpressGeneration:true}), true);
  for (const model of ['SYNCLIPSYNC','HUMMINGBIRDLIPSYNC','LATENTSYNC','KLINGLIPSYNC','CREATIFYLIPSYNC']) {
    assert.equal(shouldPrepareExpressLipSyncFace({model}), false);
    if (model !== 'SYNCLIPSYNC') assert.equal(shouldPrepareExpressLipSyncFace({model,isExpressGeneration:true}), false);
  }
});

test('face request includes actual frame, dimensions and strict response schema', () => {
  const messages = buildExpressLipSyncPromptMessages({speechItem:{characterName:'Maya'}, frame:{width:100,height:80,dataUrl:'data:image/png;base64,example'}});
  assert.match(messages[0].content, /actual image/);
  assert.equal(JSON.parse(messages[1].content[0].text).image_width,100);
  assert.equal(messages[1].content[1].image_url.url,'data:image/png;base64,example');
  assert.equal(SPEAKER_FACE_RESPONSE_FORMAT.json_schema.strict,true);
});
