import test from 'node:test';
import assert from 'node:assert/strict';

import VideoSession from '../../schema/VideoSession.js';
import {
  VIDEO_STATUS_DETAILED_SESSION_PROJECTION,
  VIDEO_STATUS_SESSION_PROJECTION,
  buildBranchVideoResults,
  buildCompletedBranchingManifest,
  buildNormalizedBranchingStatus,
  buildNormalizedVideoSessionPreview,
  buildVideoStatusResponse,
  buildVideoStatusUsageHeaders,
  normalizeResponseAssetUrl,
  reconcileDetailedBranchStatus,
  resolveVideoHasFooter,
  selectResponseMediaSource,
  selectResponseMediaSources,
  serializePublicVideoStatusResponse,
} from './StatusAPI.js';

test('buildBranchVideoResults preserves the leaf-to-output mapping and order', () => {
  const results = buildBranchVideoResults({
    narrativeType: 'branched',
    branchRenderPaths: [
      {
        pathId: 'root.1',
        leafNodeId: 'root.1',
        ordinal: 0,
        duration: 30,
        videoGenerationStatus: 'COMPLETED',
        videoLink: 'assets_v2/video/output/session/paths/root.1/video.mp4',
      },
      {
        pathId: 'root.2',
        leafNodeId: 'root.2',
        ordinal: 1,
        duration: 30,
        videoGenerationStatus: 'FAILED',
        videoGenerationError: 'render failed',
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.path_id), ['root.1', 'root.2']);
  assert.equal(
    results[0].result_url,
    'https://static.samsar.one/assets_v2/video/output/session/paths/root.1/video.mp4',
  );
  assert.equal(results[1].status, 'FAILED');
  assert.equal(results[1].error, 'render failed');
});

function buildLevelTwoBranchStatusFixture() {
  const pathDefinitions = [
    ['root.2.2', 3, ['root.2', 'root.2.2']],
    ['root.1.1', 0, ['root.1', 'root.1.1']],
    ['root.2.1', 2, ['root.2', 'root.2.1']],
    ['root.1.2', 1, ['root.1', 'root.1.2']],
  ];
  const branchPointForParent = {
    root: { branchPointId: 'choice-root', level: 1, divergenceSceneIndex: 1, switchAtSeconds: 10 },
    'root.1': { branchPointId: 'choice-root.1', level: 2, divergenceSceneIndex: 3, switchAtSeconds: 20 },
    'root.2': { branchPointId: 'choice-root.2', level: 2, divergenceSceneIndex: 3, switchAtSeconds: 20 },
  };
  const branchRenderPaths = pathDefinitions.map(([pathId, ordinal, chosenNodes]) => {
    const selectionTrail = chosenNodes.map((nodeId) => {
      const parentNodeId = nodeId.split('.').slice(0, -1).join('.') || 'root';
      const choice = branchPointForParent[parentNodeId];
      const branchOrdinal = Number(nodeId.split('.').at(-1));
      return {
        branchPointId: choice.branchPointId,
        nodeId,
        parentNodeId,
        level: choice.level,
        branchOrdinal,
        divergenceSceneIndex: choice.divergenceSceneIndex,
        switchAtSeconds: choice.switchAtSeconds,
        pathName: branchOrdinal === 1 ? 'Take the light' : 'Enter the shadow',
        pathDescription: `Choice ${branchOrdinal} from ${parentNodeId}`,
      };
    });
    return {
      pathId,
      leafNodeId: pathId,
      ordinal,
      nodeIds: ['root', ...chosenNodes],
      duration: 30,
      selectionTrail,
      frameGenerationStatus: ordinal < 3 ? 'COMPLETED' : 'PENDING',
      frameGenerationPending: ordinal === 3,
      videoGenerationStatus:
        ordinal === 0 ? 'COMPLETED' : ordinal === 1 ? 'SUCCESS' : ordinal === 2 ? 'PENDING' : 'INIT',
      videoGenerationPending: ordinal === 2,
      // A URL with a non-authoritative status must never be treated as a completed render.
      videoLink: ordinal <= 1 ? `assets_v2/video/${pathId}.mp4` : null,
      timeline: [
        {
          pathSequenceIndex: 0,
          sceneIndex: 0,
          layerId: `layer-${pathId}`,
          startTime: 0,
          endTime: 5,
          duration: 5,
          frameGenerationStatus: 'COMPLETED',
          frames: ['frame-0001.png', 'frame-0002.png'],
        },
      ],
      audioTimeline: [
        {
          pathSequenceIndex: 0,
          sceneIndex: 0,
          audioLayerId: `audio-${pathId}`,
          connectedLayerId: `layer-${pathId}`,
          startTime: 0,
          endTime: 5,
          duration: 5,
        },
      ],
    };
  });

  return {
    narrativeType: 'branched',
    renderPlanVersion: 1,
    defaultBranchPathId: 'root.1.1',
    expressGenerationStatus: { status: 'PENDING' },
    branchingMeta: {
      schemaVersion: 1,
      numLevels: 2,
      branchingFactor: 2,
      rootNodeId: 'root',
      nodeCount: 7,
      leafNodeIds: ['root.1.1', 'root.1.2', 'root.2.1', 'root.2.2'],
      branchSceneIndices: [1, 3],
      branchPoints: Object.entries(branchPointForParent).map(([parentNodeId, choice]) => ({
        branchPointId: choice.branchPointId,
        parentNodeId,
        level: choice.level,
        divergenceSceneIndex: choice.divergenceSceneIndex,
        divergencePaths: [1, 2].map((branchOrdinal) => ({
          childNodeId: `${parentNodeId}.${branchOrdinal}`,
          branchOrdinal,
          path_name: branchOrdinal === 1 ? 'Take the light' : 'Enter the shadow',
          path_description: `Choice ${branchOrdinal} from ${parentNodeId}`,
        })),
      })),
    },
    branchRenderPaths,
  };
}

function completeBranchStatusFixture(fixture = buildLevelTwoBranchStatusFixture()) {
  fixture.branchRenderCompletionFinalized = true;
  fixture.branchRenderCompletedAt = new Date('2026-07-19T01:02:03.000Z');
  fixture.expressGenerationStatus.status = 'COMPLETED';
  fixture.expressGenerationStatus.video_generation = 'COMPLETED';
  fixture.branchRenderPaths.forEach((path) => {
    path.frameGenerationStatus = 'COMPLETED';
    path.frameGenerationPending = false;
    path.videoGenerationStatus = 'COMPLETED';
    path.videoGenerationPending = false;
    path.remoteURL = `https://cdn.example.com/${path.pathId}.mp4`;
  });
  return fixture;
}

test('normalized branching status provides stable aggregate progress and a client choice tree', () => {
  const status = buildNormalizedBranchingStatus(buildLevelTwoBranchStatusFixture());

  assert.equal(status.schema, 'branched_video_status.v1');
  assert.equal(status.status, 'PENDING');
  assert.equal(status.is_complete, false);
  assert.deepEqual(status.paths.map((path) => path.path_id), [
    'root.1.1',
    'root.1.2',
    'root.2.1',
    'root.2.2',
  ]);
  assert.deepEqual(status.summary, {
    total_paths: 4,
    completed_paths: 1,
    pending_paths: 3,
    failed_paths: 0,
    cancelled_paths: 0,
    frame_paths_completed: 3,
    video_paths_completed: 1,
    progress_percent: 50,
  });
  assert.equal(status.paths[1].status, 'PENDING');
  assert.equal(Object.hasOwn(status.paths[1], 'result_url'), false);
  assert.deepEqual(
    status.tree.choice_points[0].options.map((option) => option.leaf_path_ids),
    [
      ['root.1.1', 'root.1.2'],
      ['root.2.1', 'root.2.2'],
    ],
  );
  assert.deepEqual(status.outputs, {
    ready: false,
    default_path_id: 'root.1.1',
  });
});

test('normalized branching status prefers the persisted compact timing graph and leaf metadata', () => {
  const fixture = buildLevelTwoBranchStatusFixture();
  fixture.branchingTimeline = {
    schemaVersion: 'branching_timeline.v1',
    timing: { origin: 'media', unit: 'seconds' },
    rootNodeId: 'root',
    defaultPathId: 'root.1.1',
    choicePoints: fixture.branchingMeta.branchPoints.map((branchPoint) => {
      const matchingPath = fixture.branchRenderPaths.find((path) => (
        path.selectionTrail.some((choice) => choice.branchPointId === branchPoint.branchPointId)
      ));
      const matchingChoice = matchingPath.selectionTrail.find((choice) => (
        choice.branchPointId === branchPoint.branchPointId
      ));
      return {
        branchPointId: branchPoint.branchPointId,
        parentNodeId: branchPoint.parentNodeId,
        level: branchPoint.level,
        divergenceSceneIndex: branchPoint.divergenceSceneIndex,
        switchAtSeconds: matchingChoice.switchAtSeconds,
        options: branchPoint.divergencePaths.map((option) => ({
          childNodeId: option.childNodeId,
          branchOrdinal: option.branchOrdinal,
          branchingHint: option.path_name,
          description: option.path_description,
          leafPathIds: fixture.branchRenderPaths
            .filter((path) => path.selectionTrail.some((choice) => (
              choice.nodeId === option.childNodeId
            )))
            .map((path) => path.pathId),
        })),
      };
    }),
  };
  fixture.branchingTimeline.choicePoints[0].options[0].branchingHint = 'Persisted light hint';
  fixture.branchingTimeline.choicePoints[0].options[0].description =
    'Persisted compact branch description.';
  const defaultLeafPath = fixture.branchRenderPaths.find((path) => path.pathId === 'root.1.1');
  defaultLeafPath.branchingHint = 'Immediate leaf hint';
  defaultLeafPath.branchingDescription = 'Immediate leaf description.';
  defaultLeafPath.branchPointId = 'choice-root.1';
  defaultLeafPath.divergenceSceneIndex = 3;
  defaultLeafPath.switchAtSeconds = 20;

  const status = buildNormalizedBranchingStatus(fixture);

  assert.equal(status.paths[0].branching_hint, 'Immediate leaf hint');
  assert.equal(status.paths[0].branching_description, 'Immediate leaf description.');
  assert.equal(status.paths[0].branch_point_id, 'choice-root.1');
  assert.equal(status.paths[0].divergence_scene_index, 3);
  assert.equal(status.paths[0].switch_at_seconds, 20);
  assert.equal(status.tree.choice_points[0].options[0].path_name, 'Persisted light hint');
  assert.equal(
    status.tree.choice_points[0].options[0].path_description,
    'Persisted compact branch description.',
  );
  assert.deepEqual(status.tree.choice_points[0].options[0].leaf_path_ids, [
    'root.1.1',
    'root.1.2',
  ]);
});

test('normalized branching status publishes all final URLs atomically after every path completes', () => {
  const fixture = completeBranchStatusFixture();

  const status = buildNormalizedBranchingStatus(fixture);

  assert.equal(status.status, 'COMPLETED');
  assert.equal(status.is_complete, true);
  assert.equal(status.finalized, true);
  assert.equal(status.summary.progress_percent, 100);
  assert.equal(status.outputs.ready, true);
  assert.equal(status.outputs.default_url, 'https://cdn.example.com/root.1.1.mp4');
  assert.deepEqual(status.outputs.paths.map((path) => path.path_id), [
    'root.1.1',
    'root.1.2',
    'root.2.1',
    'root.2.2',
  ]);
  assert.equal(status.outputs.paths.every((path) => path.url.endsWith(`${path.path_id}.mp4`)), true);
});

test('completed branch manifest contains one path-aware video list and normalized media timing', () => {
  const branching = buildNormalizedBranchingStatus(completeBranchStatusFixture(), null, {
    detailed: true,
  });
  const manifest = buildCompletedBranchingManifest(branching);

  assert.deepEqual(Object.keys(manifest), [
    'schema',
    'status',
    'completed_at',
    'default_path_id',
    'timing',
    'tree',
    'outputs',
  ]);
  assert.deepEqual(manifest.timing, { origin: 'media', unit: 'seconds' });
  assert.deepEqual(manifest.outputs.paths[0], {
    path_id: 'root.1.1',
    url: 'https://cdn.example.com/root.1.1.mp4',
    duration: 30,
    is_default: true,
  });
  assert.equal(manifest.tree.choice_points[0].switch_at_seconds, 10);
  assert.deepEqual(manifest.tree.choice_points[0].options[0].leaf_path_ids, [
    'root.1.1',
    'root.1.2',
  ]);
  assert.equal(Object.hasOwn(manifest, 'paths'), false);
  assert.equal(JSON.stringify(manifest).includes('stage_details'), false);
  assert.equal(JSON.stringify(manifest).includes('selection_trail'), false);
  assert.equal(JSON.stringify(manifest).includes('audio_timeline'), false);
});

test('branch status resolves thumbnail sources to one public thumbnail_url field', () => {
  const fixture = completeBranchStatusFixture();
  const defaultPath = fixture.branchRenderPaths.find((path) => path.pathId === 'root.1.1');
  defaultPath.thumbnailPath = 'assets_v2/video/thumbnails/root.1.1.png';
  const otherPath = fixture.branchRenderPaths.find((path) => path.pathId === 'root.1.2');
  otherPath.thumbnailUrl = 'https://cdn.example.com/root.1.2.png';

  const branching = buildNormalizedBranchingStatus(fixture);
  const legacyResults = buildBranchVideoResults(fixture);
  const defaultStatusPath = branching.paths.find((path) => path.path_id === 'root.1.1');
  const defaultOutputPath = branching.outputs.paths.find((path) => path.path_id === 'root.1.1');
  const manifest = buildCompletedBranchingManifest(branching);
  const manifestPath = manifest.outputs.paths.find((path) => path.path_id === 'root.1.1');

  assert.equal(
    defaultStatusPath.thumbnail_url,
    'https://static.samsar.one/assets_v2/video/thumbnails/root.1.1.png',
  );
  assert.equal(defaultOutputPath.thumbnail_url, defaultStatusPath.thumbnail_url);
  assert.equal(
    legacyResults.find((path) => path.path_id === 'root.1.1').thumbnail_url,
    defaultStatusPath.thumbnail_url,
  );
  assert.equal(manifestPath.thumbnail_url, defaultStatusPath.thumbnail_url);
  assert.equal(branching.paths.find((path) => path.path_id === 'root.1.2').thumbnail_url,
    'https://cdn.example.com/root.1.2.png');
  assert.equal(JSON.stringify(branching).includes('thumbnailPath'), false);
  assert.equal(JSON.stringify(branching).includes('thumbnailUrl'), false);
});

test('public completed branched status removes billing and duplicate output aliases', () => {
  const branching = buildNormalizedBranchingStatus(completeBranchStatusFixture());
  const internalPayload = {
    session_id: 'session-1',
    request_id: 'request-1',
    status: 'COMPLETED',
    type: 'video',
    provider: 'RUNWAYML',
    narrative_type: 'branched',
    default_path_id: 'root.1.1',
    branch_results: branching.paths,
    branching,
    result_url: branching.outputs.default_url,
    result_urls: branching.outputs.paths.map((path) => path.url),
    videoLink: branching.outputs.default_url,
    remoteURL: branching.outputs.default_url,
    expressGenerationStatus: { status: 'COMPLETED', video_generation: 'COMPLETED' },
    expressGenerationCreditCharges: {
      totalCharged: 42,
      stages: { video_generation: { creditsCharged: 10 } },
    },
    express_generation_credit_charges: { totalCharged: 42 },
    creditsCharged: 42,
    credits_charged: 42,
    has_subtitles: true,
    has_footer: false,
    result_language: 'en',
  };

  const response = serializePublicVideoStatusResponse(internalPayload);
  const serialized = JSON.stringify(response);

  assert.deepEqual(Object.keys(response), [
    'session_id',
    'request_id',
    'status',
    'type',
    'provider',
    'narrative_type',
    'default_path_id',
    'result_url',
    'has_subtitles',
    'has_footer',
    'result_language',
    'branching',
  ]);
  assert.equal(response.branching.outputs.paths.length, 4);
  assert.equal(response.result_url, 'https://cdn.example.com/root.1.1.mp4');
  assert.equal(Object.hasOwn(response, 'result_urls'), false);
  assert.equal(Object.hasOwn(response, 'branch_results'), false);
  assert.equal(Object.hasOwn(response, 'expressGenerationStatus'), false);
  assert.equal(/billing|credits?/i.test(serialized), false);
  assert.equal(Object.hasOwn(internalPayload, 'expressGenerationCreditCharges'), true);
});

test('public completed detailed branched status keeps a compact session envelope without duplicate branch data', () => {
  const branching = buildNormalizedBranchingStatus(completeBranchStatusFixture(), null, {
    detailed: true,
  });
  const response = serializePublicVideoStatusResponse({
    session_id: 'session-1',
    request_id: 'request-1',
    status: 'COMPLETED',
    type: 'video',
    narrative_type: 'branched',
    result_url: branching.outputs.default_url,
    has_subtitles: true,
    has_footer: false,
    result_language: 'en',
    branching,
    creditsCharged: 42,
    session: {
      id: 'session-1',
      requestId: 'request-1',
      type: 'video',
      routeType: 'express',
      aspectRatio: '16:9',
      framesPerSecond: 24,
      duration: 30,
      narrativeType: 'branched',
      branching,
      branchingMeta: { internal: 'duplicate' },
      branchResults: branching.paths,
      layers: [{ id: 'layer-1', prompt: 'generation detail' }],
      audioLayers: [{ id: 'audio-1' }],
      result: { url: branching.outputs.default_url, hasSubtitles: true, language: 'en' },
    },
  });

  assert.equal(response.status_detail_schema, 'interactive_video_manifest.v1');
  assert.deepEqual(Object.keys(response.session), [
    'id',
    'requestId',
    'type',
    'routeType',
    'aspectRatio',
    'framesPerSecond',
    'duration',
    'language',
    'hasSubtitles',
    'hasFooter',
    'narrativeType',
    'defaultBranchPathId',
    'result',
  ]);
  assert.equal(Object.hasOwn(response.session, 'branching'), false);
  assert.equal(Object.hasOwn(response.session, 'layers'), false);
  assert.equal(Object.hasOwn(response.session, 'audioLayers'), false);
  assert.equal(Object.hasOwn(response.branching, 'paths'), false);
});

test('public pending branched status keeps diagnostics but strips all billing fields', () => {
  const branching = buildNormalizedBranchingStatus(buildLevelTwoBranchStatusFixture());
  const response = serializePublicVideoStatusResponse({
    status: 'PENDING',
    narrative_type: 'branched',
    branching,
    expressGenerationCreditCharges: { totalCharged: 12 },
    creditsCharged: 12,
    cost_usd: 0.12,
    pricing_multiplier: 1.5,
    usage: { input_tokens: 100 },
    nested: { billing: { underlying_cost_usd: 0.1 }, credits_refunded: 2 },
  });

  assert.equal(response.branching.summary.progress_percent, 50);
  assert.equal(response.branching.paths.length, 4);
  assert.equal(response.branching.outputs.ready, false);
  assert.equal(/billing|credits?|cost_usd|pricing_multiplier|input_tokens/i.test(JSON.stringify(response)), false);
});

test('public video status leaves the completed singular response contract untouched', () => {
  const singular = {
    session_id: 'linear-session',
    request_id: 'linear-request',
    status: 'COMPLETED',
    type: 'video',
    narrative_type: 'singular',
    result_url: 'https://cdn.example.com/linear.mp4',
    result_urls: ['https://cdn.example.com/linear.mp4'],
    expressGenerationCreditCharges: { totalCharged: 9 },
    creditsCharged: 9,
    session: { layers: [{ id: 'linear-layer' }] },
  };

  assert.equal(serializePublicVideoStatusResponse(singular), singular);
  assert.deepEqual(singular.result_urls, ['https://cdn.example.com/linear.mp4']);
  assert.equal(singular.creditsCharged, 9);
  assert.deepEqual(singular.session.layers, [{ id: 'linear-layer' }]);
});

test('branched status usage is returned through standard credit headers', () => {
  const payload = {
    status: 'COMPLETED',
    narrative_type: 'branched',
    expressGenerationCreditCharges: { totalCharged: 42 },
  };

  assert.deepEqual(buildVideoStatusUsageHeaders(payload), {
    'x-credits-charged': '42',
  });
  assert.deepEqual(buildVideoStatusUsageHeaders(payload, {
    creditsCharged: 50,
    remainingCredits: 150.5,
  }), {
    'x-credits-charged': '50',
    'x-credits-remaining': '150.5',
  });
  assert.deepEqual(buildVideoStatusUsageHeaders({
    status: 'COMPLETED',
    narrative_type: 'singular',
    creditsCharged: 9,
  }), {});
});

test('normalized branching status fails closed and withholds aggregate outputs after a path error', () => {
  const fixture = buildLevelTwoBranchStatusFixture();
  const failedPath = fixture.branchRenderPaths.find((path) => path.pathId === 'root.2.1');
  failedPath.frameGenerationStatus = 'COMPLETED';
  failedPath.videoGenerationStatus = 'FAILED';
  failedPath.videoGenerationError = 'encoder failed';

  const status = buildNormalizedBranchingStatus(fixture);

  assert.equal(status.status, 'FAILED');
  assert.equal(status.is_complete, false);
  assert.equal(status.summary.failed_paths, 1);
  assert.equal(status.paths.find((path) => path.path_id === 'root.2.1').error, 'encoder failed');
  assert.deepEqual(status.outputs, {
    ready: false,
    default_path_id: 'root.1.1',
  });
});

test('normalized branching status withholds aggregate outputs after a session failure', () => {
  const fixture = buildLevelTwoBranchStatusFixture();
  fixture.expressGenerationFailed = true;
  fixture.expressGenerationStatus.status = 'FAILED';
  fixture.branchRenderPaths.forEach((path) => {
    path.frameGenerationStatus = 'COMPLETED';
    path.videoGenerationStatus = 'COMPLETED';
    path.remoteURL = `https://cdn.example.com/${path.pathId}.mp4`;
  });

  const status = buildNormalizedBranchingStatus(fixture);

  assert.equal(status.status, 'FAILED');
  assert.equal(status.is_complete, true);
  assert.equal(status.outputs.ready, false);
  assert.equal(Object.hasOwn(status.outputs, 'paths'), false);
  assert.equal(status.paths.every((path) => path.result_url), true);
});

test('normalized branching status is absent for existing singular sessions', () => {
  assert.equal(buildNormalizedBranchingStatus({
    narrativeType: 'singular',
    branchRenderPaths: [{ pathId: 'unexpected' }],
  }), null);
});

test('normalized branching status distinguishes an untouched plan from active zero-completion work', () => {
  const fixture = buildLevelTwoBranchStatusFixture();
  delete fixture.expressGenerationStatus;
  fixture.branchRenderPaths.forEach((path) => {
    path.frameGenerationStatus = 'INIT';
    path.frameGenerationPending = false;
    path.videoGenerationStatus = 'INIT';
    path.videoGenerationPending = false;
    path.videoLink = null;
  });
  assert.equal(buildNormalizedBranchingStatus(fixture).status, 'INIT');

  fixture.branchRenderPaths[0].frameGenerationStatus = 'PENDING';
  fixture.branchRenderPaths[0].frameGenerationPending = true;
  assert.equal(buildNormalizedBranchingStatus(fixture).status, 'PENDING');
});

test('detailed branching status references canonical layer assets without returning frame filename lists', () => {
  const status = buildNormalizedBranchingStatus(buildLevelTwoBranchStatusFixture(), null, {
    detailed: true,
  });

  assert.deepEqual(status.paths[0].timeline[0], {
    sequence_index: 0,
    scene_index: 0,
    layer_id: 'layer-root.1.1',
    start_time: 0,
    end_time: 5,
    duration: 5,
    frame_generation: { status: 'COMPLETED' },
  });
  assert.equal(status.paths[0].audio_timeline[0].audio_layer_id, 'audio-root.1.1');
  assert.equal(JSON.stringify(status).includes('frame-0001.png'), false);
  assert.equal(JSON.stringify(status).includes('"frames"'), false);
});

test('status projections exclude branch frame lists while detailed status includes compact timeline refs', () => {
  const baseFields = VIDEO_STATUS_SESSION_PROJECTION.split(' ');
  const detailedFields = VIDEO_STATUS_DETAILED_SESSION_PROJECTION.split(' ');

  assert.equal(baseFields.includes('branchRenderPaths'), false);
  assert.equal(baseFields.includes('branchingTimeline'), true);
  assert.equal(baseFields.includes('branchRenderPaths.branchingHint'), true);
  assert.equal(baseFields.includes('branchRenderPaths.branchingDescription'), true);
  assert.equal(baseFields.includes('branchRenderPaths.switchAtSeconds'), true);
  assert.equal(baseFields.includes('branchRenderPaths.thumbnailUrl'), true);
  assert.equal(baseFields.includes('branchRenderPaths.thumbnailPath'), true);
  assert.equal(baseFields.some((field) => field.includes('timeline.frames')), false);
  assert.equal(detailedFields.some((field) => field.includes('timeline.frames')), false);
  assert.equal(detailedFields.includes('branchRenderPaths.timeline.layerId'), true);
  assert.equal(detailedFields.includes('branchRenderPaths.audioTimeline.audioLayerId'), true);
  assert.equal(detailedFields.includes('branchRenderPaths.audioTimeline.sceneIndex'), true);
});

test('detailed status reconciles against its newer branch snapshot without a one-poll completion lag', () => {
  const fixture = buildLevelTwoBranchStatusFixture();
  fixture.branchRenderPaths.forEach((path) => {
    path.frameGenerationStatus = 'COMPLETED';
    path.videoGenerationStatus = 'COMPLETED';
    path.remoteURL = `https://cdn.example.com/${path.pathId}.mp4`;
  });
  const branching = buildNormalizedBranchingStatus(fixture, null, { detailed: true });
  const reconciled = reconcileDetailedBranchStatus({
    status: 'PENDING',
    request_id: 'session-1',
    branch_results: [{ path_id: 'root.1.1', status: 'PENDING' }],
  }, fixture, branching);

  assert.equal(reconciled.status, 'COMPLETED');
  assert.equal(reconciled.result_url, 'https://cdn.example.com/root.1.1.mp4');
  assert.deepEqual(reconciled.result_urls, [
    'https://cdn.example.com/root.1.1.mp4',
    'https://cdn.example.com/root.1.2.mp4',
    'https://cdn.example.com/root.2.1.mp4',
    'https://cdn.example.com/root.2.2.mp4',
  ]);
  assert.equal(reconciled.branch_results.length, 4);
  assert.equal(reconciled.branch_results.every((path) => path.status === 'COMPLETED'), true);
  assert.equal(
    reconciled.branch_results[0].result_url,
    'https://cdn.example.com/root.1.1.mp4',
  );
});

test('detailed status removes stale aggregate outputs when a newer branch snapshot is incomplete', () => {
  const fixture = buildLevelTwoBranchStatusFixture();
  const failedPath = fixture.branchRenderPaths.find((path) => path.pathId === 'root.2.1');
  failedPath.videoGenerationStatus = 'FAILED';
  const branching = buildNormalizedBranchingStatus(fixture, null, { detailed: true });
  const reconciled = reconcileDetailedBranchStatus({
    status: 'COMPLETED',
    result_url: 'https://cdn.example.com/stale.mp4',
    result_urls: ['https://cdn.example.com/stale.mp4'],
    videoLink: 'assets_v2/video/stale.mp4',
    remoteURL: 'https://cdn.example.com/stale.mp4',
    branch_results: [{ path_id: 'root.2.1', status: 'COMPLETED' }],
  }, fixture, branching);

  assert.equal(reconciled.status, 'FAILED');
  assert.equal(Object.hasOwn(reconciled, 'result_url'), false);
  assert.equal(Object.hasOwn(reconciled, 'result_urls'), false);
  assert.equal(Object.hasOwn(reconciled, 'videoLink'), false);
  assert.equal(Object.hasOwn(reconciled, 'remoteURL'), false);
  assert.equal(
    reconciled.branch_results.find((path) => path.path_id === 'root.2.1').status,
    'FAILED',
  );
});

test('video status endpoint withholds stale aggregate URLs until every branch path completes', async () => {
  const fixture = buildLevelTwoBranchStatusFixture();
  fixture.videoLink = 'assets_v2/video/stale-default.mp4';
  fixture.remoteURL = 'https://cdn.example.com/stale-default.mp4';
  fixture.expressGenerationStatus.video_generation = 'COMPLETED';
  const originalFindById = VideoSession.findById;
  VideoSession.findById = () => ({
    select() {
      return this;
    },
    async lean() {
      return fixture;
    },
  });

  try {
    const status = await buildVideoStatusResponse({
      sessionId: 'session-branching',
      requestId: 'request-branching',
    });
    assert.equal(status.status, 'PENDING');
    assert.equal(status.branching.outputs.ready, false);
    assert.equal(Object.hasOwn(status, 'result_url'), false);
    assert.equal(Object.hasOwn(status, 'result_urls'), false);
    assert.equal(Object.hasOwn(status, 'videoLink'), false);
    assert.equal(Object.hasOwn(status, 'remoteURL'), false);
  } finally {
    VideoSession.findById = originalFindById;
  }
});

const DOCKER_LOCAL_ENV_KEYS = [
  'CURRENT_ENV',
  'SAMSAR_MEDIA_DELIVERY_MODE',
  'MEDIA_DELIVERY_MODE',
  'SAMSAR_EXTERNAL_MEDIA_PUBLISH_ENABLED',
  'EXTERNAL_MEDIA_PUBLISH_ENABLED',
  'STATIC_CDN_URL',
  'SAMSAR_DOCKER_PUBLIC_ASSET_BASE_URL',
  'SAMSAR_DOCKER_PUBLIC_PROCESSOR_BASE_URL',
  'SAMSAR_DOCKER_LOCAL_MEDIA_BASE_URL',
  'SAMSAR_LOCAL_MEDIA_BASE_URL',
  'API_SERVER',
  'PUBLIC_API_BASE_URL',
  'PROCESSOR_API',
  'PROCESSOR_URL',
];

function withDockerLocalMediaEnv(callback) {
  const envSnapshot = Object.fromEntries(DOCKER_LOCAL_ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_MEDIA_DELIVERY_MODE = 'docker-local';
  process.env.STATIC_CDN_URL = 'http://localhost:8080/';
  delete process.env.SAMSAR_DOCKER_PUBLIC_ASSET_BASE_URL;
  delete process.env.SAMSAR_DOCKER_PUBLIC_PROCESSOR_BASE_URL;
  delete process.env.SAMSAR_DOCKER_LOCAL_MEDIA_BASE_URL;
  delete process.env.SAMSAR_LOCAL_MEDIA_BASE_URL;
  delete process.env.API_SERVER;
  delete process.env.PUBLIC_API_BASE_URL;
  delete process.env.PROCESSOR_API;
  delete process.env.PROCESSOR_URL;
  delete process.env.MEDIA_DELIVERY_MODE;
  delete process.env.SAMSAR_EXTERNAL_MEDIA_PUBLISH_ENABLED;
  delete process.env.EXTERNAL_MEDIA_PUBLISH_ENABLED;

  try {
    callback();
  } finally {
    for (const key of DOCKER_LOCAL_ENV_KEYS) {
      if (envSnapshot[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = envSnapshot[key];
      }
    }
  }
}

test('resolveVideoHasFooter reports true for active top-level footer metadata', () => {
  assert.equal(resolveVideoHasFooter({
    addFooterAnimation: true,
    footerMetadata: [{ url: 'https://example.com', title: 'Learn more' }],
  }), true);
});

test('resolveVideoHasFooter reports true for footer logo rerenders', () => {
  assert.equal(resolveVideoHasFooter({
    addFooterAnimation: true,
    footerMetadata: [],
    footerLogoImagePath: 'video/footer_logo/session/footer_logo.png',
  }), true);
});

test('resolveVideoHasFooter reports true for layer-scoped footer metadata', () => {
  assert.equal(resolveVideoHasFooter({
    addFooterAnimation: false,
    footerMetadata: [],
    layers: [
      { addFooterAnimation: false },
      {
        addFooterAnimation: true,
        footerMetadata: { url: 'https://example.com', title: 'Book now' },
      },
    ],
  }), true);
});

test('resolveVideoHasFooter reports false without an active footer flag', () => {
  assert.equal(resolveVideoHasFooter({
    addFooterAnimation: false,
    footerMetadata: [{ url: 'https://example.com', title: 'Stale metadata' }],
    layers: [
      {
        addFooterAnimation: false,
        footerMetadata: { url: 'https://example.com', title: 'Stale metadata' },
      },
    ],
  }), false);
});

test('resolveVideoHasFooter reports false for enabled footer without attached metadata', () => {
  assert.equal(resolveVideoHasFooter({
    addFooterAnimation: true,
    footerMetadata: [],
    layers: [{ addFooterAnimation: true, footerMetadata: null }],
  }), false);
});

test('buildNormalizedVideoSessionPreview returns minimal preview assets with normalized timing', () => {
  const preview = buildNormalizedVideoSessionPreview({
    _id: 'session_123',
    aspectRatio: '16:9',
    framesPerSecond: 24,
    subtitleLanguage: 'th',
    subtitleLanguageString: 'Thai',
    subtitleLanguageExplicit: true,
    subtitleTranslationRequired: true,
    expressGenerationStatus: {
      prompt_generation: 'COMPLETED',
      image_generation: 'COMPLETED',
      speech_generation: 'COMPLETED',
      music_generation: 'COMPLETED',
      audio_generation: 'COMPLETED',
      ai_video_generation: 'COMPLETED',
      lip_sync_generation: 'INIT',
      frame_generation: 'INIT',
      video_generation: 'INIT',
    },
    layers: [
      {
        _id: 'layer_1',
        prompt: 'Opening scene',
        durationOffset: 4,
        duration: 6,
        imageSession: {
          generationStatus: 'COMPLETED',
          activeItemList: [
            {
              id: 'base',
              type: 'image',
              src: 'https://cdn.example.com/scene-1.png',
              is_base_image: true,
            },
          ],
        },
        aiVideoGenerationStatus: 'COMPLETED',
        aiVideoRemoteLink: 'https://cdn.example.com/scene-1.mp4',
      },
    ],
    audioLayers: [
      {
        _id: 'speech_1',
        generationType: 'speech',
        generationStatus: 'COMPLETED',
        startTime: 4,
        endTime: 10,
        duration: 6,
        prompt: 'Narration line',
        subtitleText: 'ข้อความบรรยาย',
        subtitleLanguage: 'th',
        speechLanguage: 'en',
        subtitleTranslationRequired: true,
        subtitleAlignmentMap: [{ sourceText: 'Narration line', translatedText: 'ข้อความบรรยาย' }],
        subtitleSpeakerCharacterName: 'ผู้บรรยาย',
        addTranscriptionsRequired: true,
        selectedRemoteAudioLink: 'https://cdn.example.com/speech-1.mp3',
      },
    ],
  }, {
    request_id: 'request_123',
    provider: 'VEO',
  });

  assert.equal(preview.currentStage, 'lip_sync_generation');
  assert.equal(preview.previewStage, 'ai_video_generation');
  assert.equal(preview.layers[0].startTime, 4);
  assert.equal(preview.layers[0].endTime, 10);
  assert.equal(preview.layers[0].image.url, 'https://cdn.example.com/scene-1.png');
  assert.equal(preview.layers[0].aiVideo.url, 'https://cdn.example.com/scene-1.mp4');
  assert.equal(preview.layers[0].preview.type, 'video');
  assert.equal(preview.audioLayers[0].url, 'https://cdn.example.com/speech-1.mp3');
  assert.equal(preview.subtitleLanguage, 'th');
  assert.equal(preview.subtitleLanguageExplicit, true);
  assert.equal(preview.subtitleTranslationRequired, true);
  assert.equal(preview.audioLayers[0].subtitleText, 'ข้อความบรรยาย');
  assert.equal(preview.audioLayers[0].speechLanguage, 'en');
  assert.equal(preview.audioLayers[0].subtitleTranslationRequired, true);
  assert.deepEqual(preview.audioLayers[0].subtitleAlignmentMap, [
    { sourceText: 'Narration line', translatedText: 'ข้อความบรรยาย' },
  ]);
  assert.equal(preview.audioLayers[0].subtitleSpeakerCharacterName, 'ผู้บรรยาย');
  assert.equal(preview.audioLayers[0].addTranscriptionsRequired, true);
  assert.equal(Object.prototype.hasOwnProperty.call(preview.layers[0], 'durationOffset'), false);
});

test('normalizeResponseAssetUrl returns Docker-local public processor URLs for secure assets', () => {
  withDockerLocalMediaEnv(() => {
    assert.equal(
      normalizeResponseAssetUrl('assets_v2/video/output/session-1/final.mp4'),
      'http://localhost:3002/assets_v2/video/output/session-1/final.mp4',
    );
    assert.equal(
      normalizeResponseAssetUrl('https://static.samsar.one/assets_v2/video/output/session-1/final.mp4?Expires=old'),
      'http://localhost:3002/assets_v2/video/output/session-1/final.mp4',
    );
    assert.equal(
      normalizeResponseAssetUrl('user_resources/user-1/audio/speech.mp3'),
      'http://localhost:3002/assets_v2/user_resources/user-1/audio/speech.mp3',
    );
    process.env.PROCESSOR_API = 'http://localhost:3999/';
    assert.equal(
      normalizeResponseAssetUrl('assets_v2/video/output/session-1/final-override.mp4'),
      'http://localhost:3999/assets_v2/video/output/session-1/final-override.mp4',
    );
  });
});

test('Docker-local status selects mounted media before expiring provider results', () => {
  withDockerLocalMediaEnv(() => {
    assert.equal(selectResponseMediaSource({
      local: 'assets_v2/ai_video/generations/session-1/scene.mp4',
      remote: 'https://provider.example/expiring-scene.mp4',
    }), 'assets_v2/ai_video/generations/session-1/scene.mp4');

    const preview = buildNormalizedVideoSessionPreview({
      _id: 'session-1',
      expressGenerationStatus: {
        ai_video_generation: 'COMPLETED',
        audio_generation: 'COMPLETED',
      },
      layers: [{
        aiVideoGenerationStatus: 'COMPLETED',
        aiVideoLayer: 'assets_v2/ai_video/generations/session-1/scene.mp4',
        aiVideoRemoteLink: 'https://provider.example/expiring-scene.mp4',
      }, {
        lipSyncVideoGenerationStatus: 'COMPLETED',
        lipSyncVideoLayer: 'assets_v2/ai_video/generations/session-1/lip-sync.mp4',
        lipSyncRemoteLink: 'https://provider.example/expiring-lip-sync.mp4',
      }, {
        soundEffectVideoGenerationStatus: 'COMPLETED',
        soundEffectVideoLayer: 'assets_v2/ai_video/generations/session-1/sound-effect.mp4',
        soundEffectRemoteLink: 'https://provider.example/expiring-sound-effect.mp4',
      }, {
        userVideoGenerationStatus: 'COMPLETED',
        userVideoLayer: 'assets_v2/ai_video/generations/session-1/user-video.mp4',
        userVideoRemoteLink: 'https://provider.example/expiring-user-video.mp4',
      }],
      audioLayers: [{
        generationType: 'speech',
        generationStatus: 'COMPLETED',
        selectedLocalAudioLink: 'assets_v2/user_resources/user-1/audio/speech.mp3',
        localAudioLinks: ['assets_v2/user_resources/user-1/audio/speech.mp3'],
        selectedRemoteAudioLink: 'https://provider.example/expiring-speech.mp3',
        remoteAudioLinks: ['https://provider.example/expiring-speech.mp3'],
      }],
      global_videos: [{
        framesGenerationStatus: 'COMPLETED',
        assetPath: 'assets_v2/video/global/session-1/overlay.mp4',
        remoteURL: 'https://provider.example/expiring-overlay.mp4',
      }],
    }, { request_id: 'session-1' });

    assert.equal(
      preview.layers[0].aiVideo.url,
      'http://localhost:3002/assets_v2/ai_video/generations/session-1/scene.mp4',
    );
    assert.equal(
      preview.audioLayers[0].url,
      'http://localhost:3002/assets_v2/user_resources/user-1/audio/speech.mp3',
    );
    assert.equal(
      preview.layers[1].lipSyncVideo.url,
      'http://localhost:3002/assets_v2/ai_video/generations/session-1/lip-sync.mp4',
    );
    assert.equal(
      preview.layers[2].soundEffectVideo.url,
      'http://localhost:3002/assets_v2/ai_video/generations/session-1/sound-effect.mp4',
    );
    assert.equal(
      preview.layers[3].userVideo.url,
      'http://localhost:3002/assets_v2/ai_video/generations/session-1/user-video.mp4',
    );
    assert.deepEqual(preview.audioLayers[0].remoteAudioLinks, [
      'http://localhost:3002/assets_v2/user_resources/user-1/audio/speech.mp3',
    ]);
    assert.equal(
      preview.globalVideos[0].url,
      'http://localhost:3002/assets_v2/video/global/session-1/overlay.mp4',
    );
  });
});

test('explicit external media delivery keeps provider references preferred', () => {
  const previous = process.env.SAMSAR_MEDIA_DELIVERY_MODE;
  process.env.SAMSAR_MEDIA_DELIVERY_MODE = 'external-s3';
  try {
    assert.equal(selectResponseMediaSource({
      local: 'assets_v2/ai_video/generations/session-1/scene.mp4',
      remote: 'https://configured-cdn.example/scene.mp4',
    }), 'https://configured-cdn.example/scene.mp4');
    assert.deepEqual(selectResponseMediaSources({
      local: ['assets_v2/audio/local.mp3'],
      remote: ['https://configured-cdn.example/audio.mp3'],
    }), ['https://configured-cdn.example/audio.mp3']);
  } finally {
    if (previous === undefined) delete process.env.SAMSAR_MEDIA_DELIVERY_MODE;
    else process.env.SAMSAR_MEDIA_DELIVERY_MODE = previous;
  }
});

test('buildNormalizedVideoSessionPreview keeps signed asset urls out of persistent image item references', () => {
  const signedImageUrl = 'https://static.samsar.one/assets_v2/generations/session_123/scene.png?Expires=123&Signature=oldsig&Key-Pair-Id=KOLD';
  const preview = buildNormalizedVideoSessionPreview({
    _id: 'session_123',
    expressGenerationStatus: {
      image_generation: 'COMPLETED',
    },
    layers: [
      {
        _id: 'layer_1',
        imageSession: {
          generationStatus: 'COMPLETED',
          activeItemList: [
            {
              id: 'base',
              type: 'image',
              src: signedImageUrl,
              image: signedImageUrl,
              is_base_image: true,
            },
          ],
        },
      },
    ],
  }, { request_id: 'request_123' });

  const item = preview.layers[0].image.items[0];
  assert.equal(item.rawUrl, 'assets_v2/generations/session_123/scene.png');
  assert.equal(item.src, 'assets_v2/generations/session_123/scene.png');
  assert.equal(item.image, 'assets_v2/generations/session_123/scene.png');
  assert.ok(item.url.startsWith('https://static.samsar.one/assets_v2/generations/session_123/scene.png'));
  assert.equal(item.url.includes('Signature=oldsig'), false);
});

test('buildNormalizedVideoSessionPreview refreshes stale signed ai video urls', () => {
  const staleSignedVideoUrl = 'https://static.samsar.one/assets_v2/user_resources/user_1/ai_videos/session_123/layer_1/scene.mp4?Expires=123&Signature=oldsig&Key-Pair-Id=KOLD';
  const preview = buildNormalizedVideoSessionPreview({
    _id: 'session_123',
    expressGenerationStatus: {
      image_generation: 'COMPLETED',
      ai_video_generation: 'COMPLETED',
    },
    layers: [
      {
        _id: 'layer_1',
        duration: 5,
        imageSession: {
          generationStatus: 'COMPLETED',
          activeItemList: [
            {
              id: 'base',
              type: 'image',
              src: 'assets_v2/generations/session_123/scene.png',
              is_base_image: true,
            },
          ],
        },
        aiVideoGenerationStatus: 'COMPLETED',
        aiVideoRemoteLink: staleSignedVideoUrl,
        aiVideoLayer: 'assets_v2/ai_video/generations/session_123/layer_1/scene.mp4',
      },
    ],
  }, { request_id: 'request_123' });

  assert.ok(
    preview.layers[0].aiVideo.url.startsWith('https://static.samsar.one/assets_v2/user_resources/user_1/ai_videos/session_123/layer_1/scene.mp4'),
  );
  assert.equal(preview.layers[0].aiVideo.url.includes('Signature=oldsig'), false);
  assert.equal(preview.layers[0].preview.type, 'video');
});

test('buildNormalizedVideoSessionPreview refreshes stale signed cloudfront ai video urls', () => {
  const staleSignedVideoUrl = 'https://dgyheyjs5bch6.cloudfront.net/assets_v2/user_resources/user_1/ai_videos/session_123/layer_1/scene.mp4?Expires=123&Signature=oldsig&Key-Pair-Id=KOLD';
  const preview = buildNormalizedVideoSessionPreview({
    _id: 'session_123',
    expressGenerationStatus: {
      ai_video_generation: 'COMPLETED',
    },
    layers: [
      {
        _id: 'layer_1',
        aiVideoGenerationStatus: 'COMPLETED',
        aiVideoRemoteLink: staleSignedVideoUrl,
      },
    ],
  }, { request_id: 'request_123' });

  assert.ok(
    preview.layers[0].aiVideo.url.startsWith('https://static.samsar.one/assets_v2/user_resources/user_1/ai_videos/session_123/layer_1/scene.mp4'),
  );
  assert.equal(preview.layers[0].aiVideo.url.includes('Signature=oldsig'), false);
});

test('buildNormalizedVideoSessionPreview exposes editedImage for image-to-video detailed status', () => {
  const preview = buildNormalizedVideoSessionPreview({
    _id: 'session_123',
    isStepVideoGeneration: true,
    expressStepGeneration: {
      routeType: 'image_to_video',
    },
    expressGenerationStatus: {
      image_generation: 'COMPLETED',
      ai_video_generation: 'PENDING',
    },
    layers: [
      {
        _id: 'layer_1',
        imageSession: {
          generationStatus: 'COMPLETED',
          editStatus: 'COMPLETED',
          activeEditedImage: '/assets_v2/generations/session_123/edited.png',
          activeItemList: [
            {
              id: 'base',
              type: 'image',
              src: 'assets_v2/generations/session_123/base.png',
              is_base_image: true,
            },
          ],
        },
      },
    ],
  }, { request_id: 'request_123' });

  assert.equal(
    preview.layers[0].image.editedImage.startsWith('https://static.samsar.one/assets_v2/generations/session_123/edited.png'),
    true,
  );
  assert.equal(preview.layers[0].image.editedImageRawUrl, 'assets_v2/generations/session_123/edited.png');
  assert.equal(preview.layers[0].editedImage.rawUrl, 'assets_v2/generations/session_123/edited.png');
});
