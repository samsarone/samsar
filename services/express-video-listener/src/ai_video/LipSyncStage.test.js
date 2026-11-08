import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assessLipSyncFallback,
  assessLipSyncStage,
  findConnectedSpeechAudioLayer,
  hasUsableBaseAiVideo,
  hasLipSyncOutput,
  isCharacterLipSyncLayer,
} from './LipSyncStage.js';

function characterLayer(id, overrides = {}) {
  return {
    _id: id,
    layerAiVideoType: 'character',
    layerBaseAiImageType: 'character',
    hasAiVideoLayer: true,
    aiVideoLayer: `/assets_v2/ai_video/${id}.mp4`,
    aiVideoGenerationStatus: 'COMPLETED',
    lipSyncGenerationPending: true,
    lipSyncVideoGenerationStatus: 'INIT',
    ...overrides,
  };
}

test('lip sync falls back only to a usable local base video', () => {
  const base = characterLayer('base');
  assert.equal(hasUsableBaseAiVideo(base), true);
  assert.equal(hasUsableBaseAiVideo({ ...base, aiVideoLayer: '', aiVideoRemoteLink: '' }), false);
  assert.equal(hasUsableBaseAiVideo({ ...base, hasAiVideoLayer: false }), false);
  assert.equal(hasUsableBaseAiVideo({ ...base, aiVideoGenerationStatus: 'FAILED' }), false);
  assert.equal(hasUsableBaseAiVideo({ ...base, aiVideoGenerationStatus: 'PENDING' }), false);
  assert.equal(hasUsableBaseAiVideo({ ...base, aiVideoGenerationPending: true }), false);
  assert.equal(hasUsableBaseAiVideo({ ...base, aiVideoGenerationStatus: 'INIT' }), true);
  assert.equal(hasUsableBaseAiVideo({ ...base, aiVideoGenerationStatus: undefined }), true);
  assert.equal(hasUsableBaseAiVideo({ ...base, aiVideoLayer: '', aiVideoRemoteLink: 'https://cdn.example/base.mp4' }), false);
});

test('terminal lip-sync failure uses the base video after all other layers finish', () => {
  const failed = characterLayer('failed', {
    lipSyncGenerationPending: false,
    lipSyncVideoGenerationStatus: 'FAILED',
  });
  const pending = characterLayer('pending', {
    lipSyncVideoGenerationStatus: 'PENDING',
  });
  const audio = [
    speechLayer('speech-failed', 'failed', 0),
    speechLayer('speech-pending', 'pending', 1),
  ];

  assert.equal(assessLipSyncFallback(assessLipSyncStage([failed, pending], audio)).state, 'WAIT');
  const allFinished = assessLipSyncStage([
    failed,
    { ...pending, lipSyncGenerationPending: false, lipSyncVideoGenerationStatus: 'COMPLETED',
      hasLipSyncVideoLayer: true, lipSyncVideoLayer: '/lip/pending.mp4' },
  ], audio);
  assert.equal(assessLipSyncFallback(allFinished).state, 'FALLBACK');
  assert.equal(assessLipSyncFallback(allFinished).assessment.layerId, 'failed');
  assert.equal(assessLipSyncFallback(assessLipSyncStage([
    { ...failed, aiVideoLayer: '', aiVideoRemoteLink: '' },
  ], [audio[0]])).state, 'NO_BASE_VIDEO');
  const failedWithoutBase = {
    ...failed,
    hasAiVideoLayer: false,
    aiVideoLayer: '',
    aiVideoRemoteLink: '',
  };
  const missingBaseAssessment = assessLipSyncStage([failedWithoutBase], [audio[0]]);
  assert.equal(missingBaseAssessment.required.length, 1);
  assert.equal(assessLipSyncFallback(missingBaseAssessment).state, 'NO_BASE_VIDEO');
});

test('missing lip-sync output waits through enqueue window and falls back after request is gone', () => {
  const init = characterLayer('missing', { lipSyncGenerationPending: false });
  const completedWithoutOutput = characterLayer('empty', {
    lipSyncGenerationPending: false,
    lipSyncVideoGenerationStatus: 'COMPLETED',
    hasLipSyncVideoLayer: false,
  });
  const initAssessment = assessLipSyncStage([init], [speechLayer('speech-init', 'missing', 0)]);
  const emptyAssessment = assessLipSyncStage([completedWithoutOutput], [speechLayer('speech-empty', 'empty', 0)]);

  assert.equal(assessLipSyncFallback(initAssessment).state, 'WAIT');
  assert.equal(assessLipSyncFallback(initAssessment, { missingRequestTimedOut: true }).state, 'FALLBACK');
  assert.equal(assessLipSyncFallback(emptyAssessment).state, 'FALLBACK');
});

test('a stage with no character speech layers has no required lip-sync work', () => {
  const assessment = assessLipSyncStage([], []);
  assert.equal(assessment.state, 'NOT_REQUIRED');
  assert.equal(assessLipSyncFallback(assessment).state, 'COMPLETE');
});

function speechLayer(id, connectedLayerId, connectedLayerIndex) {
  return {
    _id: id,
    generationType: 'speech',
    generationStatus: 'COMPLETED',
    connectedLayerId,
    connectedLayerIndex,
  };
}

test('branched canonical lip sync completes only when every required layer has output', () => {
  const layers = [
    characterLayer('shared', {
      lipSyncGenerationPending: false,
      lipSyncVideoGenerationStatus: 'COMPLETED',
      hasLipSyncVideoLayer: true,
      lipSyncVideoLayer: '/assets_v2/lip/shared.mp4',
    }),
    characterLayer('branch-a', {
      lipSyncGenerationPending: false,
      lipSyncVideoGenerationStatus: 'COMPLETED',
      hasLipSyncVideoLayer: true,
      lipSyncRemoteLink: 'https://static.example/lip/branch-a.mp4',
    }),
  ];
  const audioLayers = [
    speechLayer('audio-shared', 'shared', 0),
    speechLayer('audio-branch-a', 'branch-a', 1),
  ];

  const result = assessLipSyncStage(layers, audioLayers);
  assert.equal(result.state, 'COMPLETED');
  assert.equal(result.required.length, 2);
  assert.equal(result.completed.length, 2);
});

test('one failed branch layer fails the aggregate instead of looking completed', () => {
  const layers = [
    characterLayer('shared', {
      lipSyncGenerationPending: false,
      lipSyncVideoGenerationStatus: 'COMPLETED',
      hasLipSyncVideoLayer: true,
      lipSyncVideoLayer: '/assets_v2/lip/shared.mp4',
    }),
    characterLayer('branch-b', {
      lipSyncGenerationPending: false,
      lipSyncVideoGenerationStatus: 'FAILED',
      lipSyncVideoGenerationError: 'Provider rejected the audio input.',
    }),
  ];
  const audioLayers = [
    speechLayer('audio-shared', 'shared', 0),
    speechLayer('audio-branch-b', 'branch-b', 1),
  ];

  const result = assessLipSyncStage(layers, audioLayers);
  assert.equal(result.state, 'FAILED');
  assert.equal(result.failed[0].layerId, 'branch-b');
});

test('does not track a layer whose current scene type is no longer character', () => {
  const layer = characterLayer('branch-c', {
    layerAiVideoType: 'ai_video',
    lipSyncGenerationPending: false,
  });
  const result = assessLipSyncStage(
    [layer],
    [speechLayer('audio-branch-c', 'branch-c', 0)],
  );

  assert.equal(result.state, 'NOT_REQUIRED');
  assert.equal(result.required.length, 0);
});

test('narration scenes never qualify from a character-style base image', () => {
  const layer = characterLayer('narrator', {
    layerAiVideoType: 'narration',
  });

  assert.equal(isCharacterLipSyncLayer(layer), false);
  assert.equal(
    assessLipSyncStage(
      [layer],
      [speechLayer('narrator-audio', 'narrator', 0)],
    ).state,
    'NOT_REQUIRED',
  );
});

test('current character scene type remains authoritative over the base image type', () => {
  assert.equal(isCharacterLipSyncLayer(characterLayer('speaker', {
    layerBaseAiImageType: 'scene',
  })), true);
});

test('character scenes without connected speech do not enter lip sync', () => {
  const result = assessLipSyncStage(
    [characterLayer('silent-character')],
    [{
      _id: 'music',
      generationType: 'music',
      connectedLayerId: 'silent-character',
      connectedLayerIndex: 0,
    }],
  );

  assert.equal(result.state, 'NOT_REQUIRED');
  assert.equal(result.required.length, 0);
});

test('connected audio selection ignores music and falls back to canonical layer index', () => {
  const layer = characterLayer('branch-d');
  const audioLayers = [
    {
      _id: 'music',
      generationType: 'music',
      connectedLayerId: 'branch-d',
      connectedLayerIndex: 0,
    },
    speechLayer('speech', null, 0),
  ];

  assert.equal(
    findConnectedSpeechAudioLayer(audioLayers, layer, 0)?._id,
    'speech',
  );
});

test('lip sync output requires the completion flag and a persisted media reference', () => {
  assert.equal(hasLipSyncOutput({ lipSyncVideoLayer: '/lip.mp4' }), false);
  assert.equal(hasLipSyncOutput({ hasLipSyncVideoLayer: true }), false);
  assert.equal(
    hasLipSyncOutput({ hasLipSyncVideoLayer: true, lipSyncVideoLayer: '/lip.mp4' }),
    true,
  );
});

test('exhausted infrastructure recovery fails lip sync even while other layers remain pending', () => {
  const layers = [
    characterLayer('failed', { lipSyncGenerationPending: false, lipSyncVideoGenerationStatus: 'FAILED', lipSyncInfrastructureFailure: true }),
    characterLayer('pending', { lipSyncVideoGenerationStatus: 'PENDING' }),
  ];
  const result = assessLipSyncFallback(assessLipSyncStage(layers, [speechLayer('a', 'failed', 0), speechLayer('b', 'pending', 1)]));
  assert.equal(result.state, 'INFRASTRUCTURE_FAILURE');
  assert.equal(result.assessment.layerId, 'failed');
});

test('late completed lip sync output ignores a stale infrastructure layer flag', () => {
  const layer = characterLayer('completed', { lipSyncGenerationPending: false, lipSyncVideoGenerationStatus: 'COMPLETED', hasLipSyncVideoLayer: true, lipSyncVideoLayer: '/lip.mp4', lipSyncInfrastructureFailure: true });
  assert.equal(assessLipSyncFallback(assessLipSyncStage([layer], [speechLayer('speech', 'completed', 0)])).state, 'COMPLETE');
});
