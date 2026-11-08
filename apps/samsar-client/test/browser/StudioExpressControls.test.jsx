import { useState } from 'react';
import { render } from '@testing-library/react';
import { page, userEvent } from 'vitest/browser';
import { expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import TopNav from '../../src/components/common/TopNav.tsx';
import { NavCanvasControlContext } from '../../src/contexts/NavCanvasControlContext.jsx';
import { LocalizationProvider } from '../../src/contexts/LocalizationContext.jsx';
import { ColorModeProvider } from '../../src/contexts/ColorMode.jsx';
import '../../src/index.css';

vi.mock('../../src/contexts/UserContext.jsx', () => ({ useUser: () => ({ user: { _id: 'user', email: 'user@example.com', generationCredits: 1000 } }) }));
function Harness({ pending }) {
  const [playing, setPlaying] = useState(false);
  const location = useLocation();
  return <NavCanvasControlContext.Provider value={{ isExpressGeneration: true, sessionId: 'express-1',
    canvasActualDimensions: { width: 1792, height: 1024 }, totalEffectiveDuration: 90, canvasZoomPercent: 100,
    canZoomInCanvas: true, canZoomOutCanvas: true, toggleShowCanvasNavigationGrid: vi.fn(),
  }}>
    <TopNav isVideoPreviewPlaying={playing} setIsVideoPreviewPlaying={setPlaying} isRenderPending={pending}
      isVideoGenerating={pending} renderedVideoPath="https://example.com/video.mp4" isSessionPublished
      renderCompletedThisSession openAdvancedVideoEditDialog={vi.fn()} openExpressPostProcessingDialog={vi.fn()}
      submitRenderVideo={vi.fn()} publishVideoSession={vi.fn()} unpublishVideoSession={vi.fn()} cancelPendingRender={vi.fn()} />
    <output aria-label="Route" className="pt-24 block">{location.pathname}</output>
  </NavCanvasControlContext.Provider>;
}
function mount(pending = false) {
  render(<MemoryRouter initialEntries={['/video/express-1']}><ColorModeProvider><LocalizationProvider><Harness pending={pending} /></LocalizationProvider></ColorModeProvider></MemoryRouter>);
}

it.each([768, 1024, 1280, 1440, 1920])('fits completed Express controls at %s px without overlapping the logo or account controls', async width => {
  await page.viewport(width, 800);
  mount();
  const nav = document.querySelector('[data-app-top-nav]');
  const columns = [...nav.firstElementChild.children].map(node => node.getBoundingClientRect());
  const controls = document.querySelector('[data-studio-controls]').getBoundingClientRect();
  expect(controls.left).toBeGreaterThanOrEqual(columns[0].right);
  expect(controls.right).toBeLessThanOrEqual(columns[2].left);
  expect(nav.scrollWidth).toBeLessThanOrEqual(width);
  await expect.element(page.getByRole('button', { name: 'Express edits', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'More controls', exact: true }).click();
  await expect.element(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeVisible();
  await expect.element(page.getByRole('button', { name: 'Download current frame', exact: true })).toBeVisible();
  const menu = page.getByRole('button', { name: 'Zoom in', exact: true }).element().closest('[data-headlessui-state]');
  expect(menu.getBoundingClientRect().right).toBeLessThanOrEqual(width);
  await userEvent.keyboard('{Escape}');
  await expect.element(page.getByRole('button', { name: 'Zoom in', exact: true })).not.toBeInTheDocument();
});

it('allows actual pointer playback and Vidgenie navigation during rendering, while other controls are disabled', async () => {
  await page.viewport(1024, 800);
  mount(true);
  await expect.element(page.getByRole('button', { name: 'Express edits', exact: true })).not.toBeInTheDocument();
  await expect.element(page.getByRole('button', { name: 'More controls', exact: true })).toBeDisabled();
  await expect.element(page.getByRole('button', { name: 'Cancel render', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'View in Vidgenie', exact: true }).click();
  await expect.element(page.getByLabelText('Route')).toHaveTextContent('/vidgenie/express-1');
});
