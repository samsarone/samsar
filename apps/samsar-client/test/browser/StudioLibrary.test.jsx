import { render, waitFor } from '@testing-library/react';
import { page, userEvent } from 'vitest/browser';
import { beforeEach, expect, it, vi } from 'vitest';
import axios from 'axios';
import LibraryHome from '../../src/components/library/LibraryHome.jsx';
import ImageLibraryHome from '../../src/components/library/image/ImageLibraryHome.jsx';
import VideoEditorWorkspace from '../../src/components/video/VideoEditorWorkspace.jsx';
import { ColorModeProvider } from '../../src/contexts/ColorMode.jsx';
import '../../src/index.css';

vi.mock('axios', () => ({ default: { get: vi.fn() } }));
vi.mock('../../src/utils/web.jsx', () => ({ getHeaders: () => ({ headers: {} }) }));
vi.mock('../../src/contexts/UserContext.jsx', () => ({ useUser: () => ({ user: { _id: 'test-user' } }) }));

const largeImage = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="4096" height="6144"><rect width="4096" height="6144" fill="#64748b"/></svg>')}`;
const images = Array.from({ length: 12 }, (_, index) => ({
  rawSrc: `/generations/image-${index}.png`, previewUrl: largeImage, width: 4096, height: 6144,
}));
const videos = ['ai_video', 'user_video', 'lip_sync', 'sound_effect'].map((sourceType, index) => ({
  _id: `video-${index}`, title: `Session video ${index}`, sourceType,
  assetPath: `/videos/video-${index}.mp4`, thumbnailPath: largeImage, aspectRatio: '4:3', duration: 6,
}));
const session = {
  _id: 'current-session', sessionName: 'Test project', layers: [{ duration: 20 }],
  audioLayers: ['music', 'speech', 'sound_effect'].map((generationType) => ({
    _id: generationType, generationType, title: `Session ${generationType}`,
    url: `/audio/${generationType}.mp3`, duration: 5,
  })),
};

beforeEach(async () => {
  // A narrow studio pane can sit inside a wide desktop viewport with sidebars open.
  await page.viewport(1280, 900);
  axios.get.mockImplementation(async (url) => {
    if (url.includes('/video_sessions/video_library')) {
      return { data: { projectItems: videos, globalItems: [] } };
    }
    if (url.includes('/audio/user_music_library')) {
      return { data: { projectItems: [], globalArtifacts: { music: [], speech: [], soundEffect: [] } } };
    }
    throw new Error(`Unexpected library request: ${url}`);
  });
});

function renderStudio({ width = 1000, ratio = '16:9', ...props } = {}) {
  return render(
    <ColorModeProvider>
      <div data-testid="workspace" style={{ width, height: 640, display: 'flex' }}>
        <VideoEditorWorkspace isLibraryView>
          <LibraryHome sessionId={session._id} sessionDetails={{ ...session, aspectRatio: ratio }}
            generationImages={images} resetImageLibrary={vi.fn()} {...props} />
        </VideoEditorWorkspace>
      </div>
    </ColorModeProvider>
  );
}

function expectContained(container) {
  const workspace = container.querySelector('[data-testid="workspace"]');
  const library = container.querySelector('.library-home');
  const bounds = workspace.getBoundingClientRect();
  const panelBounds = library.getBoundingClientRect();
  expect(panelBounds.width).toBeGreaterThan(200);
  expect(panelBounds.right).toBeLessThanOrEqual(bounds.right);
  expect(panelBounds.bottom).toBeLessThanOrEqual(bounds.bottom);
  expect(workspace.scrollWidth).toBeLessThanOrEqual(workspace.clientWidth);
  expect(workspace.scrollHeight).toBeLessThanOrEqual(workspace.clientHeight);
  const content = library.querySelector('[role="tabpanel"]').firstElementChild;
  expect(content.scrollWidth).toBeLessThanOrEqual(content.clientWidth + 1);
}

function expectTileRatios(container, selector, ratio) {
  const [width, height] = ratio.split(':').map(Number);
  const tiles = [...container.querySelectorAll(selector)];
  expect(tiles.length).toBeGreaterThan(0);
  tiles.forEach((tile) => {
    const bounds = tile.getBoundingClientRect();
    expect(bounds.width).toBeGreaterThan(100);
    expect(bounds.width / bounds.height).toBeCloseTo(width / height, 2);
  });
}

it.each(['16:9', '9:16', '1:1', '4:3'])('tiles session images and videos at the %s project ratio', async (ratio) => {
  const { container } = renderStudio({ ratio });
  await expect.element(page.getByRole('tab', { name: 'Image', exact: true })).toHaveAttribute('aria-selected', 'true');
  expect(container.querySelectorAll('[role="tab"]')).toHaveLength(3);
  expect(container.querySelectorAll('img')).toHaveLength(images.length);
  expect(axios.get).not.toHaveBeenCalled();
  await waitFor(() => expectTileRatios(container, '.library-image-preview', ratio));
  expectContained(container);
  const imageTiles = container.querySelectorAll('.library-image-preview');
  expect(imageTiles[0].getBoundingClientRect().top).toBe(imageTiles[1].getBoundingClientRect().top);

  await page.getByRole('tab', { name: 'Video', exact: true }).click();
  await expect.element(page.getByText('Session video 0', { exact: true })).toBeVisible();
  expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('/video_sessions/video_library'),
    expect.objectContaining({ params: { sessionId: session._id, search: '' } }));
  expect(container.querySelectorAll('.library-video-card')).toHaveLength(videos.length);
  expectTileRatios(container, '.library-video-preview', ratio);
  expectContained(container);
});

it.each([360, 600])('keeps tabs accessible and scrolls artifacts inside a %spx workspace', async (width) => {
  const { container } = renderStudio({ width, ratio: '9:16' });
  expectContained(container);
  const content = container.querySelector('[role="tabpanel"]').firstElementChild;
  expect(content.scrollHeight).toBeGreaterThan(content.clientHeight);
  content.scrollTop = content.scrollHeight;
  expect(content.scrollTop).toBeGreaterThan(0);
  await expect.element(page.getByRole('tab', { name: 'Image', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Video', exact: true }).click();
  await expect.element(page.getByText('Session video 0', { exact: true })).toBeVisible();
  expectContained(container);
  await page.getByRole('tab', { name: 'Audio', exact: true }).click();
  await expect.element(page.getByText('Session music', { exact: true })).toBeVisible();
  expectContained(container);
});

it('keeps a single large image and video in a tile instead of expanding across the workspace', async () => {
  axios.get.mockResolvedValue({ data: { projectItems: [videos[0]], globalItems: [] } });
  const { container } = renderStudio({ generationImages: [images[0]] });
  expect(container.querySelector('.library-image-preview').getBoundingClientRect().width).toBeLessThan(350);
  await page.getByRole('tab', { name: 'Video', exact: true }).click();
  await expect.element(page.getByText('Session video 0', { exact: true })).toBeVisible();
  expect(container.querySelector('.library-video-preview').getBoundingClientRect().width).toBeLessThan(350);
});

it('preserves image selection, video trim selection, all audio types, and Back', async () => {
  const selectImage = vi.fn();
  const selectVideo = vi.fn();
  const selectMusic = vi.fn();
  const back = vi.fn();
  renderStudio({ selectImageFromLibrary: selectImage, onSelectVideo: selectVideo, onSelectMusic: selectMusic, resetImageLibrary: back });
  await page.getByRole('button', { name: 'Select', exact: true }).first().click();
  expect(selectImage).toHaveBeenCalledWith('/generations/image-0.png', expect.objectContaining({ previewUrl: largeImage }));
  await page.getByRole('tab', { name: 'Video', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Trim' }).click();
  await page.getByRole('button', { name: 'Select', exact: true }).first().click();
  expect(selectVideo).toHaveBeenCalledWith({ video: videos[0], videoItem: videos[0], trimScene: true });
  await page.getByRole('tab', { name: 'Audio', exact: true }).click();
  await expect.element(page.getByText('Session music', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add To Project', exact: true }).click();
  expect(selectMusic).toHaveBeenCalled();
  await page.getByRole('button', { name: 'Speech', exact: true }).click();
  await expect.element(page.getByText('Session speech', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sound Effect', exact: true }).click();
  await expect.element(page.getByText('Session sound_effect', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  expect(back).toHaveBeenCalledOnce();
});

it('supports keyboard tab navigation and an empty session', async () => {
  renderStudio({ generationImages: [] });
  await expect.element(page.getByText('No generated or edited assets yet in this session.')).toBeVisible();
  await page.getByRole('tab', { name: 'Image', exact: true }).click();
  await userEvent.keyboard('{ArrowRight}');
  await expect.element(page.getByRole('tab', { name: 'Audio', exact: true })).toHaveFocus();
  await userEvent.keyboard('{End}');
  await expect.element(page.getByRole('tab', { name: 'Video', exact: true })).toHaveFocus();
  await userEvent.keyboard('{Home}');
  await expect.element(page.getByRole('tab', { name: 'Image', exact: true })).toHaveFocus();
});

it('uses the active project ratio and keeps the loading overlay inside the library in light mode', () => {
  localStorage.setItem('colorMode', 'light');
  const { container } = renderStudio({ aspectRatio: '9:16', isSelectButtonDisabled: true });
  expectTileRatios(container, '.library-image-preview', '9:16');
  expectContained(container);
  const libraryBounds = container.querySelector('.library-home').getBoundingClientRect();
  const overlayBounds = container.querySelector('[role="status"]').getBoundingClientRect();
  expect(overlayBounds.top).toBeGreaterThan(libraryBounds.top);
  expect(overlayBounds.bottom).toBeLessThanOrEqual(libraryBounds.bottom);
  expect(overlayBounds.width).toBeLessThanOrEqual(libraryBounds.width);
});

it('keeps the canvas scrollable at its intrinsic dimensions outside Library view', () => {
  const { container } = render(
    <div style={{ width: 600, height: 400, display: 'flex' }}>
      <VideoEditorWorkspace><div data-testid="canvas" style={{ width: 1400, height: 1000 }} /></VideoEditorWorkspace>
    </div>
  );
  const workspace = container.firstElementChild.firstElementChild;
  const canvas = container.querySelector('[data-testid="canvas"]');
  expect(canvas.getBoundingClientRect().width).toBe(1400);
  expect(canvas.getBoundingClientRect().height).toBe(1000);
  expect(workspace.scrollWidth).toBeGreaterThan(workspace.clientWidth);
  expect(getComputedStyle(workspace).overflow).toBe('auto');
});

it('preserves the standalone image library layout and global sessions', () => {
  const { container } = render(<ImageLibraryHome generationImages={[images[0]]} />);
  expect(container.textContent).toContain('Global Sessions');
  expect(getComputedStyle(container.querySelector('.library-assets-grid')).display).not.toBe('grid');
  expect(getComputedStyle(container.querySelector('.library-image-preview img')).position).not.toBe('absolute');
});
