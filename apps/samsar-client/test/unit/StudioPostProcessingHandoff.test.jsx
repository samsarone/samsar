import { expect, it } from 'vitest';
import { readStudioPostProcessingHandoff, STUDIO_PENDING_EDIT_KEY } from '../../src/components/video/util/studioPostProcessingHandoff.js';

it('ignores damaged handoff storage and handoffs pointing back to the source', () => {
  sessionStorage.setItem(STUDIO_PENDING_EDIT_KEY, '{broken');
  expect(readStudioPostProcessingHandoff('target', 'owner')).toBeNull();
  sessionStorage.setItem(STUDIO_PENDING_EDIT_KEY, JSON.stringify({ origin: 'studio-express-post-processing',
    sessionId: 'target', sourceSessionId: 'target', userId: 'owner', startedAt: Date.now() }));
  expect(readStudioPostProcessingHandoff('target', 'owner')).toBeNull();
});
