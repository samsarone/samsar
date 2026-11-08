import { expect, it } from 'vitest';
import { hasStudioPreviewMedia, readStudioPostProcessingHandoff, STUDIO_PENDING_EDIT_KEY } from '../../src/components/video/util/studioPostProcessingPreview.js';

it('switches to actual scene media, including video-only scenes, but not blank placeholders', () => {
  const image = value => ({ layers: [{ imageSession: { activeItemList: [value] } }] });
  expect(hasStudioPreviewMedia({ layers: [] })).toBe(false);
  expect(hasStudioPreviewMedia(image({ type: 'image', image: 'placeholder' }))).toBe(false);
  expect(hasStudioPreviewMedia(image({ type: 'image', src: 'https://media.example/new.png', isHidden: true }))).toBe(false);
  expect(hasStudioPreviewMedia(image({ type: 'image', previewUrl: 'https://media.example/new.png' }))).toBe(true);
  expect(hasStudioPreviewMedia({ layers: [{ aiVideoRemoteLink: 'https://media.example/new.mp4' }] })).toBe(true);
});

it('ignores damaged handoff storage and handoffs pointing back to the source', () => {
  sessionStorage.setItem(STUDIO_PENDING_EDIT_KEY, '{broken');
  expect(readStudioPostProcessingHandoff('target', 'owner')).toBeNull();
  sessionStorage.setItem(STUDIO_PENDING_EDIT_KEY, JSON.stringify({ origin: 'studio-express-post-processing',
    sessionId: 'target', sourceSessionId: 'target', userId: 'owner', startedAt: Date.now() }));
  expect(readStudioPostProcessingHandoff('target', 'owner')).toBeNull();
});
