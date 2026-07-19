import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDockerFinalVideoQueueRepairBranchPathPatch,
  buildDockerFinalVideoQueueRepairSessionPatch,
  isDockerLocalFinalVideoQueueRepairEnabled,
  shouldRepairMissingFinalVideoRequest,
} from './DockerFinalVideoQueueRepair.js';

function readySession(overrides = {}) {
  return {
    videoGenerationPending: true,
    frameGenerationPending: false,
    expressGenerationFailed: false,
    expressGenerationCancelled: false,
    expressGenerationStatus: {
      ai_video_generation: 'COMPLETED',
      audio_generation: 'COMPLETED',
      speech_generation: 'COMPLETED',
      music_generation: 'COMPLETED',
      lip_sync_generation: 'COMPLETED',
      sound_effect_generation: 'COMPLETED',
      transcript_generation: 'COMPLETED',
      frame_generation: 'PENDING',
      video_generation: 'INIT',
    },
    layers: [
      { duration: 4.8, frameGenerationPending: false, frames: ['0.png'] },
      { duration: 4.8, frameGenerationPending: false, frames: ['0.png'] },
    ],
    audioLayers: [
      { isEnabled: true, generationStatus: 'COMPLETED', selectedLocalAudioLink: 'assets_v2/audio/speech.mp3' },
    ],
    ...overrides,
  };
}

test('enables repair for docker-local media delivery only', () => {
  assert.equal(isDockerLocalFinalVideoQueueRepairEnabled({
    CURRENT_ENV: 'docker',
  }), true);
  assert.equal(isDockerLocalFinalVideoQueueRepairEnabled({
    CURRENT_ENV: 'production',
    SAMSAR_MEDIA_DELIVERY_MODE: 'docker-local',
  }), true);
  assert.equal(isDockerLocalFinalVideoQueueRepairEnabled({
    CURRENT_ENV: 'docker',
    SAMSAR_MEDIA_DELIVERY_MODE: 's3-cloudfront',
  }), false);
});

test('repairs only sessions that are ready for final local render', () => {
  const env = { CURRENT_ENV: 'docker' };

  assert.equal(shouldRepairMissingFinalVideoRequest(readySession(), env), true);
  assert.equal(shouldRepairMissingFinalVideoRequest(readySession({ remoteURL: 'http://localhost:3002/assets_v2/video.mp4' }), env), false);
  assert.equal(shouldRepairMissingFinalVideoRequest(readySession({ frameGenerationPending: true }), env), false);
  assert.equal(shouldRepairMissingFinalVideoRequest(readySession({
    expressGenerationStatus: {
      ...readySession().expressGenerationStatus,
      music_generation: 'PENDING',
    },
  }), env), false);
  assert.equal(shouldRepairMissingFinalVideoRequest(readySession({
    layers: [{ duration: 4.8, frameGenerationPending: false, frames: [] }],
  }), env), false);
  assert.equal(shouldRepairMissingFinalVideoRequest(readySession(), { CURRENT_ENV: 'production' }), false);
});

test('session patch marks frames done and final render pending', () => {
  assert.deepEqual(buildDockerFinalVideoQueueRepairSessionPatch(), {
    videoGenerationPending: true,
    frameGenerationPending: false,
    generationError: null,
    expressGenerationError: null,
    'expressGenerationStatus.frame_generation': 'COMPLETED',
    'expressGenerationStatus.video_generation': 'PENDING',
  });
});

test('repairs unfinished branched render paths even after another path has a result', () => {
  const branchSession = readySession({
    narrativeType: 'branched',
    branchRenderPaths: [
      {
        pathId: 'root.1',
        frameGenerationStatus: 'COMPLETED',
        videoGenerationStatus: 'COMPLETED',
        videoLink: 'assets_v2/video/root.1.mp4',
        timeline: [{ duration: 4.8, frames: ['0.png'] }],
      },
      {
        pathId: 'root.2',
        frameGenerationStatus: 'COMPLETED',
        videoGenerationStatus: 'PENDING',
        timeline: [{ duration: 4.8, frames: ['0.png'] }],
      },
    ],
    videoLink: 'assets_v2/video/root.1.mp4',
  });

  assert.equal(shouldRepairMissingFinalVideoRequest(branchSession, { CURRENT_ENV: 'docker' }), true);
  assert.deepEqual(buildDockerFinalVideoQueueRepairBranchPathPatch(), {
    videoGenerationPending: true,
    videoGenerationStatus: 'PENDING',
    videoGenerationError: null,
    videoGenerationCompletedAt: null,
  });
});
