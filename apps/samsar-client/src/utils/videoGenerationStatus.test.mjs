import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildStudioSessionDetailsFromStatus,
  fetchDetailedVideoGenerationStatus,
  materializeBranchPathPreview,
} from './videoGenerationStatus.mjs';

test('detailed status falls back from the step route to the generic route', async () => {
  const calls = [];
  const axiosClient = {
    async get(url) {
      calls.push(url);
      if (calls.length === 1) {
        const error = new Error('not a step request');
        error.response = { status: 404 };
        throw error;
      }
      return { data: { status: 'PENDING' } };
    },
  };

  const result = await fetchDetailedVideoGenerationStatus({
    axiosClient,
    apiServer: 'https://api.example.test/',
    requestId: 'session id',
    headers: { headers: { Authorization: 'test' } },
  });

  assert.equal(result.status, 'PENDING');
  assert.match(calls[0], /\/v2\/video\/step\/session%20id\/status_detailed$/);
  assert.match(calls[1], /\/v2\/status_detailed\?request_id=session\+id$/);
});

test('status preview is converted into Studio layers with partial image and video assets', () => {
  const session = buildStudioSessionDetailsFromStatus({
    session_id: 'session-1',
    status: 'FAILED',
    expressGenerationError: 'provider rejected one clip',
    expressGenerationStatus: { ai_video_generation: 'FAILED' },
    session: {
      aspectRatio: '16:9',
      layers: [{
        id: 'layer-1',
        startTime: 3,
        duration: 5,
        image: {
          status: 'COMPLETED',
          url: 'https://static.example/image.png',
          items: [{ id: 'image-1', url: 'https://static.example/image.png', isPrimary: true }],
        },
        aiVideo: { status: 'COMPLETED', url: 'https://static.example/video.mp4' },
      }],
    },
  });

  assert.equal(session._id, 'session-1');
  assert.equal(session.expressGenerationFailed, true);
  assert.equal(session.layers[0]._id, 'layer-1');
  assert.equal(session.layers[0].durationOffset, 3);
  assert.equal(session.layers[0].imageSession.activeItemList[0].src, 'https://static.example/image.png');
  assert.equal(session.layers[0].aiVideoRemoteLink, 'https://static.example/video.mp4');
  assert.equal(Object.prototype.hasOwnProperty.call(session, 'canonicalLayers'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(session, 'canonicalAudioLayers'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(session, 'branching'), false);
});

test('completed compact branched status uses the top-level output manifest without detailed assets', () => {
  const status = {
    session_id: 'branched-session',
    request_id: 'branched-request',
    status: 'COMPLETED',
    type: 'video',
    narrative_type: 'branched',
    default_path_id: 'root.2',
    result_url: 'https://static.example/root.2.mp4',
    status_detail_schema: 'interactive_video_manifest.v1',
    session: {
      id: 'branched-session',
      requestId: 'branched-request',
      type: 'video',
      aspectRatio: '16:9',
      framesPerSecond: 24,
      duration: 12,
      narrativeType: 'branched',
      defaultBranchPathId: 'root.2',
      result: { url: 'https://static.example/root.2.mp4' },
    },
    branching: {
      schema: 'branched_video_status.v1',
      status: 'COMPLETED',
      default_path_id: 'root.2',
      timing: { origin: 'media', unit: 'seconds' },
      tree: {
        root_node_id: 'root',
        choice_points: [{
          branch_point_id: 'choice-1',
          parent_node_id: 'root',
          switch_at_seconds: 5,
          options: [
            { child_node_id: 'root.1', leaf_path_ids: ['root.1'] },
            { child_node_id: 'root.2', leaf_path_ids: ['root.2'] },
          ],
        }],
      },
      outputs: {
        ready: true,
        default_path_id: 'root.2',
        default_url: 'https://static.example/root.2.mp4',
        paths: [
          {
            path_id: 'root.1',
            url: 'https://static.example/root.1.mp4',
            duration: 11,
            is_default: false,
          },
          {
            path_id: 'root.2',
            url: 'https://static.example/root.2.mp4',
            duration: 12,
            is_default: true,
          },
        ],
      },
    },
  };

  const session = buildStudioSessionDetailsFromStatus(status);

  assert.equal(session._id, 'branched-session');
  assert.equal(session.videoLink, 'https://static.example/root.2.mp4');
  assert.equal(session.defaultBranchPathId, 'root.2');
  assert.deepEqual(session.layers, []);
  assert.deepEqual(session.audioLayers, []);
  assert.deepEqual(session.canonicalLayers, []);
  assert.deepEqual(session.canonicalAudioLayers, []);
  assert.equal(session.branching, status.branching);
  assert.deepEqual(session.branching.timing, { origin: 'media', unit: 'seconds' });
  assert.deepEqual(
    session.branching.outputs.paths.map(({ path_id, url, duration }) => ({
      path_id,
      url,
      duration,
    })),
    [
      {
        path_id: 'root.1',
        url: 'https://static.example/root.1.mp4',
        duration: 11,
      },
      {
        path_id: 'root.2',
        url: 'https://static.example/root.2.mp4',
        duration: 12,
      },
    ]
  );
  assert.equal(Object.prototype.hasOwnProperty.call(status.session, 'branching'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(status.session, 'layers'), false);
});

test('branched status preserves canonical pools and materializes the default path timing', () => {
  const branching = {
    schema: 'branched_video_status.v1',
    default_path_id: 'root.2',
    paths: [
      {
        path_id: 'root.1',
        is_default: false,
        timeline: [
          {
            sequence_index: 0,
            scene_index: 0,
            layer_id: 'layer-shared',
            start_time: 0,
            end_time: 5,
            duration: 5,
          },
          {
            sequence_index: 1,
            scene_index: 1,
            layer_id: 'layer-root-1',
            start_time: 5,
            end_time: 11,
            duration: 6,
          },
        ],
        audio_timeline: [
          {
            sequence_index: 0,
            scene_index: 0,
            audio_layer_id: 'audio-shared',
            connected_layer_id: 'layer-shared',
            start_time: 0,
            end_time: 5,
            duration: 5,
          },
          {
            sequence_index: 1,
            scene_index: 1,
            audio_layer_id: 'audio-root-1',
            connected_layer_id: 'layer-root-1',
            start_time: 5,
            end_time: 11,
            duration: 6,
          },
        ],
      },
      {
        path_id: 'root.2',
        is_default: true,
        // Deliberately out of order to verify sequence_index controls playback order.
        timeline: [
          {
            sequence_index: 1,
            scene_index: 1,
            layer_id: 'layer-root-2',
            start_time: 5,
            end_time: 12,
            duration: 7,
          },
          {
            sequence_index: 0,
            scene_index: 0,
            layer_id: 'layer-shared',
            start_time: 0,
            end_time: 5,
            duration: 5,
          },
        ],
        audio_timeline: [
          {
            sequence_index: 1,
            scene_index: 1,
            audio_layer_id: 'audio-root-2',
            connected_layer_id: 'layer-root-2',
            start_time: 5,
            end_time: 12,
            duration: 7,
          },
          {
            sequence_index: 0,
            scene_index: 0,
            audio_layer_id: 'audio-shared',
            connected_layer_id: 'layer-shared',
            start_time: 0,
            end_time: 5,
            duration: 5,
          },
        ],
      },
    ],
  };
  const session = buildStudioSessionDetailsFromStatus({
    session_id: 'branched-session',
    status: 'PENDING',
    // A less detailed top-level manifest must not replace session.branching.
    branching: { schema: 'branched_video_status.v1', paths: [] },
    session: {
      narrativeType: 'branched',
      branching,
      layers: [
        { id: 'layer-shared', startTime: 30, duration: 5, prompt: 'Shared scene' },
        { id: 'layer-root-1', startTime: 35, duration: 6, prompt: 'First ending' },
        { id: 'layer-root-2', startTime: 41, duration: 7, prompt: 'Second ending' },
      ],
      audioLayers: [
        {
          id: 'audio-shared',
          type: 'speech',
          startTime: 30,
          duration: 5,
          connectedLayerId: 'layer-shared',
        },
        {
          id: 'audio-root-1',
          type: 'speech',
          startTime: 35,
          duration: 6,
          connectedLayerId: 'layer-root-1',
        },
        {
          id: 'audio-root-2',
          type: 'speech',
          startTime: 41,
          duration: 7,
          connectedLayerId: 'layer-root-2',
        },
      ],
    },
  });

  assert.equal(session.branching, branching);
  assert.equal(session.defaultBranchPathId, 'root.2');
  assert.deepEqual(session.canonicalLayers.map((layer) => layer.id), [
    'layer-shared',
    'layer-root-1',
    'layer-root-2',
  ]);
  assert.deepEqual(session.layers.map((layer) => layer.id), ['layer-shared', 'layer-root-2']);
  assert.deepEqual(session.layers.map((layer) => layer.durationOffset), [0, 5]);
  assert.deepEqual(session.layers.map((layer) => layer.endTime), [5, 12]);
  assert.deepEqual(session.layers.map((layer) => layer.branchPathId), ['root.2', 'root.2']);
  assert.equal(session.canonicalLayers[0].durationOffset, 30);

  assert.deepEqual(session.canonicalAudioLayers.map((layer) => layer.id), [
    'audio-shared',
    'audio-root-1',
    'audio-root-2',
  ]);
  assert.deepEqual(session.audioLayers.map((layer) => layer.id), ['audio-shared', 'audio-root-2']);
  assert.deepEqual(session.audioLayers.map((layer) => layer.startTime), [0, 5]);
  assert.deepEqual(session.audioLayers.map((layer) => layer.connectedLayerIndex), [0, 1]);
  assert.equal(session.canonicalAudioLayers[0].startTime, 30);

  const alternatePath = materializeBranchPathPreview({
    branching: session.branching,
    canonicalLayers: session.canonicalLayers,
    canonicalAudioLayers: session.canonicalAudioLayers,
    pathId: 'root.1',
  });
  assert.equal(alternatePath.pathId, 'root.1');
  assert.deepEqual(alternatePath.layers.map((layer) => layer.id), [
    'layer-shared',
    'layer-root-1',
  ]);
  assert.deepEqual(alternatePath.layers.map((layer) => layer.durationOffset), [0, 5]);
  assert.deepEqual(alternatePath.audioLayers.map((layer) => layer.id), [
    'audio-shared',
    'audio-root-1',
  ]);
  assert.deepEqual(alternatePath.audioLayers.map((layer) => layer.connectedLayerIndex), [0, 1]);
});
