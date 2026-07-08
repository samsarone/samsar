import test from 'node:test';
import assert from 'node:assert/strict';

import { __testOnly__ } from './LipSyncGenerator.js';

test('lip sync accepts original AI video layers with remote-only video references', () => {
  assert.equal(
    __testOnly__.hasReusableBaseAiVideo({
      hasAiVideoLayer: true,
      aiVideoRemoteLink: 'https://static.samsar.one/assets_v2/user_resources/user-1/ai_videos/session/layer/video.mp4',
    }),
    true,
  );
});

test('lip sync active request query is scoped to one session layer', () => {
  assert.deepEqual(
    __testOnly__.buildActiveLipSyncRequestQuery({
      sessionId: 'session-1',
      layerId: 'layer-1',
    }),
    {
      sessionId: 'session-1',
      layerId: 'layer-1',
      generationType: 'lip_sync',
      status: { $in: ['INIT', 'PENDING'] },
    },
  );
});
