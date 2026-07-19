import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildEffectiveBranchSession,
  buildFrameOutputNamespace,
  getSafeRenderPathDirectoryName,
  isBranchPathFrameComplete,
  resolveBranchRenderContext,
  validateFrameOutputNamespace,
} from './BranchRenderPath.js';

function buildSession() {
  return {
    _id: 'session123',
    narrativeType: 'branched',
    renderPlanVersion: 1,
    layers: [
      { _id: 'layerA', duration: 99, durationOffset: 99, prompt: 'shared-a' },
      { _id: 'layerB', duration: 99, durationOffset: 99, prompt: 'shared-b' },
    ],
    audioLayers: [
      { _id: 'audioA', connectedLayerId: 'layerA', startTime: 99, endTime: 100 },
    ],
    branchRenderPaths: [{
      pathId: 'root.1/alternate',
      duration: 7,
      timeline: [
        {
          sequenceIndex: 0,
          sceneIndex: 1,
          layerId: 'layerA',
          duration: 3,
          durationOffset: 0,
          frames: ['/video/frames/a.png'],
          frameGenerationStatus: 'COMPLETED',
          frameGenerationPending: false,
        },
        {
          sequenceIndex: 1,
          sceneIndex: 2,
          layerId: 'layerB',
          duration: 4,
          durationOffset: 3,
          frames: [],
          frameGenerationStatus: 'PENDING',
          frameGenerationPending: true,
        },
      ],
      audioTimeline: [{
        audioLayerId: 'audioA',
        connectedLayerId: 'layerA',
        duration: 2,
        startTime: 0.5,
        endTime: 2.5,
      }],
      frameGenerationStatus: 'GENERATING',
      frameGenerationPending: true,
    }],
  };
}

test('branch path ids produce deterministic filesystem-safe frame namespaces', () => {
  const safePath = getSafeRenderPathDirectoryName('root.1/alternate');
  assert.match(safePath, /^path-[A-Za-z0-9_-]+$/);
  assert.equal(safePath.includes('/'), false);

  const namespace = buildFrameOutputNamespace({
    sessionId: 'session123',
    layerId: 'layerB',
    renderPathId: 'root.1/alternate',
  });
  assert.equal(
    namespace,
    `video/frames/session123/paths/${safePath}/layerB`,
  );
  assert.equal(
    validateFrameOutputNamespace(namespace, { sessionId: 'session123', layerId: 'layerB' }),
    namespace,
  );
});

test('trusted output namespace validation rejects traversal and cross-layer writes', () => {
  assert.throws(
    () => validateFrameOutputNamespace(
      'video/frames/session123/paths/../layerB',
      { sessionId: 'session123', layerId: 'layerB' },
    ),
    /unsafe path segment/,
  );
  assert.throws(
    () => validateFrameOutputNamespace(
      'video/frames/session123/layerA',
      { sessionId: 'session123', layerId: 'layerB' },
    ),
    /outside the allowed/,
  );
});

test('branch render context validates job identity and applies path timing to shared layer', () => {
  const session = buildSession();
  const context = resolveBranchRenderContext(session, {
    layerId: 'layerB',
    renderPathId: 'root.1/alternate',
    renderPlanVersion: 1,
    pathSequenceIndex: 1,
  });

  assert.equal(context.pathIndex, 0);
  assert.equal(context.timelineIndex, 1);
  assert.equal(context.layerIndex, 1);
  assert.equal(context.effectiveLayer.prompt, 'shared-b');
  assert.equal(context.effectiveLayer.duration, 4);
  assert.equal(context.effectiveLayer.durationOffset, 3);
  assert.equal(context.pathDuration, 7);
  assert.equal(context.sharedLayer.duration, 99);
});

test('branch render context rejects mismatched layer and render-plan version', () => {
  const session = buildSession();
  assert.throws(
    () => resolveBranchRenderContext(session, {
      layerId: 'layerA',
      renderPathId: 'root.1/alternate',
      renderPlanVersion: 1,
      pathSequenceIndex: 1,
    }),
    /does not match sequence/,
  );
  assert.throws(
    () => resolveBranchRenderContext(session, {
      layerId: 'layerB',
      renderPathId: 'root.1/alternate',
      renderPlanVersion: 2,
      pathSequenceIndex: 1,
    }),
    /renderPlanVersion/,
  );
});

test('effective branch session preserves shared assets but uses path layer and audio timing', () => {
  const session = buildSession();
  const effective = buildEffectiveBranchSession(session, session.branchRenderPaths[0]);

  assert.deepEqual(
    effective.layers.map(({ _id, duration, durationOffset }) => ({ _id, duration, durationOffset })),
    [
      { _id: 'layerA', duration: 3, durationOffset: 0 },
      { _id: 'layerB', duration: 4, durationOffset: 3 },
    ],
  );
  assert.equal(effective.audioLayers[0]._id, 'audioA');
  assert.equal(effective.audioLayers[0].startTime, 0.5);
  assert.equal(effective.audioLayers[0].endTime, 2.5);
  assert.equal(effective.audioLayers[0].connectedLayerId, 'layerA');
  assert.equal(effective.audioLayers[0].connectedLayerIndex, 0);
  assert.equal(effective.audioLayers[0].connectedLayerStartTimeOffset, 0);
  assert.equal(effective.totalDuration, 7);
});

test('effective branch session retimes session-global subtitle words to the path offset', () => {
  const session = buildSession();
  session.framesPerSecond = 24;
  session.layers[1].durationOffset = 10;
  session.layers[1].imageSession = {
    activeItemList: [{
      type: 'text',
      subType: 'subtitle',
      audioLayerId: 'audioA',
      subtitleTimingBase: 'session',
      subtitleCueStartFrameSession: 252,
      subtitleCueEndFrameSession: 276,
      config: { frameOffset: 12, frameDuration: 24 },
      words: [{ word: 'branch', frameOffset: 252, frameDuration: 24 }],
    }],
  };

  const effective = buildEffectiveBranchSession(session, session.branchRenderPaths[0]);
  const subtitle = effective.layers[1].imageSession.activeItemList[0];

  assert.equal(subtitle.words[0].frameOffset, 84);
  assert.equal(subtitle.subtitleCueStartFrameSession, 84);
  assert.equal(subtitle.subtitleCueEndFrameSession, 108);
  assert.equal(subtitle.config.frameOffset, 12);
  assert.equal(session.layers[1].imageSession.activeItemList[0].words[0].frameOffset, 252);
});

test('branch path completion requires completed frame lists for every sequence', () => {
  const path = buildSession().branchRenderPaths[0];
  assert.equal(isBranchPathFrameComplete(path), false);

  path.timeline[1].frames = ['/video/frames/b.png'];
  path.timeline[1].frameGenerationPending = false;
  path.timeline[1].frameGenerationStatus = 'COMPLETED';
  assert.equal(isBranchPathFrameComplete(path), true);
});
