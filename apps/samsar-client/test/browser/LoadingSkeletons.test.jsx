import { render, screen, cleanup } from '@testing-library/react';
import { page } from 'vitest/browser';
import { afterEach, expect, it, vi } from 'vitest';
import { VidgenieSkeleton } from '../../src/components/oneshot_editor/VidgenieSkeletonLoader.jsx';
import StudioSkeletonLoader from '../../src/components/video/util/StudioSkeletonLoader.jsx';
import PageSkeletonLoader from '../../src/components/common/PageSkeletonLoader.jsx';
import { VIDGENIE_PAGE_CLASS, VIDGENIE_EDITOR_CLASS, VIDGENIE_CARD_CLASS, getVidgeniePreviewFrameStyle } from '../../src/components/oneshot_editor/vidgenieLayout.js';
import '../../src/index.css';

vi.mock('../../src/contexts/ColorMode.jsx', () => ({
  useColorMode: () => ({ colorMode: document.body.classList.contains('theme-dark') ? 'dark' : 'light' }),
}));
afterEach(() => {
  document.body.classList.remove('theme-dark', 'theme-light');
  document.documentElement.classList.remove('dark');
});

for (const theme of ['light', 'dark']) {
  for (const width of [360, 390, 768, 1280]) {
    it(`matches Vidgenie page geometry and stays within the viewport at ${width}px in ${theme}`, async () => {
      await page.viewport(width, 800);
      document.body.classList.add(`theme-${theme}`);
      for (const variant of ['unknown', 'init', 'pending', 'completed']) {
        const { container } = render(<VidgenieSkeleton variant={variant} aspectRatio="9:16" />);
        const status = screen.getByRole('status', { name: 'Loading VidGenie' });
        const card = container.querySelector('.vidgenie-editor-card').getBoundingClientRect();
        expect(card.left).toBeGreaterThanOrEqual(0);
        expect(card.right).toBeLessThanOrEqual(width);
        expect(card.top).toBeGreaterThanOrEqual(56);
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
        expect(status.querySelectorAll('button, input, select, textarea, a')).toHaveLength(0);
        expect(container.querySelector('.animate-spin')).toBeNull();
        const block = container.querySelector('.theme-skeleton-pulse');
        const background = getComputedStyle(block).backgroundColor;
        expect(background).not.toBe('rgba(0, 0, 0, 0)');
        if (variant === 'completed' || variant === 'pending') {
          const preview = container.querySelector('.vidgenie-preview-frame').getBoundingClientRect();
          expect(preview.width / preview.height).toBeCloseTo(9 / 16, 2);
          expect(preview.width).toBeLessThanOrEqual(292);
        }
        // Compare against the same wrappers used by the actual editor, not a
        // separate hard-coded set of expected offsets.
        const expected = render(<div className={VIDGENIE_PAGE_CLASS}><div className={VIDGENIE_EDITOR_CLASS}><div className={VIDGENIE_CARD_CLASS} data-testid="real-card">Header</div></div></div>);
        const actual = screen.getByTestId('real-card').getBoundingClientRect();
        expect(card.width).toBeCloseTo(actual.width, 1);
        expect(card.left).toBeCloseTo(actual.left, 1);
        expected.unmount();
        cleanup();
      }
    });
  }
}

it('uses current Studio rail dimensions without page overflow', async () => {
  for (const width of [768, 1280, 1920]) {
    await page.viewport(width, 800);
    const { container } = render(<StudioSkeletonLoader />);
    const left = container.querySelector('[data-skeleton-left-rail]').getBoundingClientRect();
    const right = container.querySelector('[data-skeleton-right-rail]').getBoundingClientRect();
    expect(left.width).toBeCloseTo(Math.max(196, Math.min(width * .14, 224)), 1);
    expect(right.width).toBeCloseTo(Math.max(148, Math.min(width * .11, 168)), 1);
    expect(left.top).toBe(72);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
    expect(document.documentElement.scrollHeight).toBeLessThanOrEqual(800);
    cleanup();
  }
});

it('keeps the other route skeletons bounded on desktop and mobile', async () => {
  for (const width of [390, 1280]) {
    await page.viewport(width, 800);
    for (const type of ['image', 'audio', 'account', 'projects', 'auth', 'quick', 'content']) {
      const { container } = render(<PageSkeletonLoader page={type} />);
      expect(document.documentElement.scrollWidth, type).toBeLessThanOrEqual(width);
      expect(container.querySelector('.animate-spin'), type).toBeNull();
      cleanup();
    }
  }
});

it('uses the same landscape preview dimensions as the rendered result', async () => {
  await page.viewport(1280, 800);
  const { container } = render(<VidgenieSkeleton variant="completed" />);
  const preview = container.querySelector('.vidgenie-preview-frame').getBoundingClientRect();
  expect(preview.width).toBe(640);
  expect(preview.height).toBe(352);
  expect(getComputedStyle(container.querySelector('.vidgenie-preview-frame')).aspectRatio).toBe(getVidgeniePreviewFrameStyle('16:9').aspectRatio);
  await page.screenshot({ path: 'test-results/vidgenie-completed-skeleton.png' });
});

it('updates the placeholder colors when the active theme changes', async () => {
  document.body.classList.add('theme-light');
  const view = render(<VidgenieSkeleton variant="init" />);
  const light = getComputedStyle(view.container.querySelector('.theme-skeleton-pulse')).backgroundColor;
  document.body.classList.replace('theme-light', 'theme-dark');
  view.rerender(<VidgenieSkeleton variant="init" />);
  const dark = getComputedStyle(view.container.querySelector('.theme-skeleton-pulse')).backgroundColor;
  expect(dark).not.toBe(light);
});
