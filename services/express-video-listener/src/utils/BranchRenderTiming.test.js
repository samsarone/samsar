import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildBranchDurationSessionMetadata,
  normalizeBranchRenderPathTimings,
  retimeBranchRenderPathsForSharedLayer,
} from './BranchRenderTiming.js';

function buildPaths() {
  return [
    {
      pathId: 'root.1',
      duration: 10,
      selectionTrail: [{ divergenceSceneIndex: 0, switchAtSeconds: 4 }],
      timeline: [
        {
          assetKey: 'asset:shared',
          layerId: 'layer-shared',
          sequenceIndex: 0,
          sceneIndex: 0,
          duration: 4,
          durationOffset: 0,
          startTime: 0,
          endTime: 4,
        },
        {
          assetKey: 'asset:left',
          layerId: 'layer-left',
          sequenceIndex: 1,
          sceneIndex: 1,
          duration: 6,
          durationOffset: 4,
          startTime: 4,
          endTime: 10,
        },
      ],
      audioTimeline: [
        {
          audioLayerId: 'audio-speech',
          connectedLayerId: 'layer-shared',
          duration: 4,
          startTime: 0,
          endTime: 4,
        },
        {
          audioLayerId: 'audio-effect',
          connectedLayerId: 'layer-left',
          duration: 6,
          startTime: 4,
          endTime: 10,
        },
        { audioLayerId: 'audio-music', duration: 10, startTime: 0, endTime: 10 },
        { audioLayerId: 'audio-global', duration: 10, startTime: 0, endTime: 10 },
      ],
    },
    {
      pathId: 'root.2',
      duration: 12,
      selectionTrail: [{ divergenceSceneIndex: 0, switchAtSeconds: 4 }],
      timeline: [
        {
          assetKey: 'asset:shared',
          layerId: 'layer-shared',
          sequenceIndex: 0,
          sceneIndex: 0,
          duration: 4,
          durationOffset: 0,
          startTime: 0,
          endTime: 4,
        },
        {
          assetKey: 'asset:right',
          layerId: 'layer-right',
          sequenceIndex: 1,
          sceneIndex: 1,
          duration: 8,
          durationOffset: 4,
          startTime: 4,
          endTime: 12,
        },
      ],
      audioTimeline: [
        {
          audioLayerId: 'audio-speech',
          connectedLayerId: 'layer-shared',
          duration: 4,
          startTime: 0,
          endTime: 4,
        },
        { audioLayerId: 'audio-music', duration: 12, startTime: 0, endTime: 12 },
      ],
    },
    {
      pathId: 'root.unaffected',
      duration: 5,
      selectionTrail: [],
      timeline: [{
        assetKey: 'asset:other',
        layerId: 'layer-other',
        sequenceIndex: 0,
        sceneIndex: 0,
        duration: 5,
        durationOffset: 0,
        startTime: 0,
        endTime: 5,
      }],
      audioTimeline: [],
    },
  ];
}

function buildLayers() {
  return [
    { _id: 'layer-shared', duration: 7 },
    { _id: 'layer-left', duration: 6 },
    { _id: 'layer-right', duration: 8 },
    { _id: 'layer-other', duration: 5 },
  ];
}

function buildAudioLayers() {
  return [
    {
      _id: 'audio-speech',
      generationType: 'speech',
      connectedLayerId: 'layer-shared',
      duration: 3,
    },
    {
      _id: 'audio-effect',
      generationType: 'sound_effect',
      connectedLayerId: 'layer-left',
      duration: 2,
    },
    { _id: 'audio-music', generationType: 'music', duration: 30 },
    { _id: 'audio-global', generationType: 'ambient', duration: 2 },
  ];
}

test('shared layer duration changes reflow every referencing path and its audio', () => {
  const sourcePaths = buildPaths();
  const sourceSnapshot = structuredClone(sourcePaths);
  const result = retimeBranchRenderPathsForSharedLayer({
    branchRenderPaths: sourcePaths,
    layers: buildLayers(),
    audioLayers: buildAudioLayers(),
    layerId: 'layer-shared',
    duration: 7,
  });

  assert.deepEqual(sourcePaths, sourceSnapshot, 'retiming must not mutate the saved input');
  assert.equal(result[2], sourcePaths[2], 'paths without the shared layer stay untouched');

  assert.equal(result[0].duration, 13);
  assert.deepEqual(
    result[0].timeline.map(({ duration, durationOffset, startTime, endTime }) => ({
      duration,
      durationOffset,
      startTime,
      endTime,
    })),
    [
      { duration: 7, durationOffset: 0, startTime: 0, endTime: 7 },
      { duration: 6, durationOffset: 7, startTime: 7, endTime: 13 },
    ],
  );
  assert.equal(result[1].duration, 15);
  assert.equal(result[1].timeline[1].durationOffset, 7);
  assert.equal(result[0].selectionTrail[0].switchAtSeconds, 7);
  assert.equal(result[1].selectionTrail[0].switchAtSeconds, 7);

  const [speech, effect, music, global] = result[0].audioTimeline;
  assert.deepEqual(
    { duration: speech.duration, startTime: speech.startTime, endTime: speech.endTime },
    { duration: 3, startTime: 2, endTime: 5 },
    'speech is centered inside a longer connected visual layer',
  );
  assert.deepEqual(
    { duration: effect.duration, startTime: effect.startTime, endTime: effect.endTime },
    { duration: 2, startTime: 7, endTime: 9 },
    'connected non-speech audio uses its generated duration at the reflowed layer offset',
  );
  assert.deepEqual(
    { duration: music.duration, startTime: music.startTime, endTime: music.endTime },
    { duration: 13, startTime: 0, endTime: 13 },
  );
  assert.deepEqual(
    { duration: global.duration, startTime: global.startTime, endTime: global.endTime },
    { duration: 13, startTime: 0, endTime: 13 },
  );
});

test('final normalization rebuilds all path timing from the shared asset catalog', () => {
  const paths = buildPaths().slice(0, 2);
  const result = normalizeBranchRenderPathTimings({
    branchRenderPaths: paths,
    layers: [
      ...buildLayers().filter((layer) => layer._id !== 'layer-left'),
      { _id: 'layer-left', duration: 9 },
    ],
    audioLayers: buildAudioLayers(),
  });

  assert.equal(result[0].duration, 16);
  assert.equal(result[0].timeline[1].duration, 9);
  assert.equal(result[0].audioTimeline[1].startTime, 7);
  assert.equal(result[1].duration, 15);
});

test('duration metadata bills the cumulative unique layer catalog and preserves locked stages', () => {
  const branchRenderPaths = retimeBranchRenderPathsForSharedLayer({
    branchRenderPaths: buildPaths().slice(0, 2),
    layers: buildLayers(),
    audioLayers: buildAudioLayers(),
    layerId: 'layer-shared',
    duration: 7,
  });
  const metadata = buildBranchDurationSessionMetadata({
    branchRenderPaths,
    layers: [
      ...buildLayers().slice(0, 3),
      { _id: 'shared-outro', duration: 8 },
      { _id: 'layer-shared', duration: 7 },
    ],
    expressGenerationBillingStageDurations: {
      ai_video_generation: 999,
      lip_sync_generation: 999,
      sound_effect_generation: 999,
      narrator_avatar_generation: 999,
      pipeline: 999,
    },
    expressGenerationCreditCharges: {
      stages: {
        ai_video_generation: { status: 'CHARGED' },
        lip_sync_generation: { status: 'CHARGING' },
        sound_effect_generation: { status: 'FAILED' },
        narrator_avatar_generation: { status: 'WAIVED' },
      },
    },
  });

  assert.equal(metadata.totalDuration, 15);
  assert.equal(metadata.expressGenerationBillingDurationSeconds, 29);
  assert.deepEqual(metadata.expressGenerationBillingStageDurations, {
    image_generation: 29,
    speech_generation: 29,
    music_generation: 29,
    ai_video_generation: 999,
    lip_sync_generation: 999,
    sound_effect_generation: 29,
    narrator_avatar_generation: 999,
    pipeline: 29,
  });
});

test('duration metadata keeps one contractual cumulative duration after layer retiming', () => {
  const initial = buildBranchDurationSessionMetadata({
    branchRenderPaths: buildPaths().slice(0, 2),
    layers: buildLayers().slice(0, 3),
  });
  assert.equal(initial.expressGenerationBillingDurationSeconds, 21);

  const retimed = buildBranchDurationSessionMetadata({
    branchRenderPaths: buildPaths().slice(0, 2),
    layers: [
      { _id: 'layer-shared', duration: 9 },
      { _id: 'layer-left', duration: 12 },
      { _id: 'layer-right', duration: 11 },
    ],
    expressGenerationBillingDurationSeconds:
      initial.expressGenerationBillingDurationSeconds,
    expressGenerationBillingStageDurations:
      initial.expressGenerationBillingStageDurations,
  });

  assert.equal(retimed.expressGenerationBillingDurationSeconds, 21);
  assert.equal(retimed.expressGenerationBillingStageDurations.image_generation, 21);
  assert.equal(retimed.expressGenerationBillingStageDurations.ai_video_generation, 21);
  assert.equal(retimed.expressGenerationBillingStageDurations.pipeline, 21);
});

test('shared duration retiming rejects invalid identity or duration inputs', () => {
  assert.throws(
    () => retimeBranchRenderPathsForSharedLayer({ layerId: '', duration: 5 }),
    /shared layer id and positive duration/i,
  );
  assert.throws(
    () => retimeBranchRenderPathsForSharedLayer({ layerId: 'layer-1', duration: 0 }),
    /shared layer id and positive duration/i,
  );
});
