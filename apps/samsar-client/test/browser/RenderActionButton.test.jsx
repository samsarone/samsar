import { render } from '@testing-library/react';
import { page } from 'vitest/browser';
import { beforeEach, expect, it, vi } from 'vitest';
import RenderActionButton from '../../src/components/video/toolbars/RenderActionButton.jsx';

const session = vi.hoisted(() => ({ user: { _id: 'test-user' } }));
vi.mock('../../src/contexts/UserContext.jsx', () => ({ useUser: () => session }));
vi.mock('../../src/contexts/AlertDialogContext.jsx', () => ({
  useAlertDialog: () => ({ openAlertDialog: vi.fn(), closeAlertDialog: vi.fn() }),
}));
beforeEach(() => { session.user = { _id: 'test-user' }; });

it('submits a render from the real button', async () => {
  const submit = vi.fn();
  render(<RenderActionButton submitRenderVideo={submit} />);
  await page.getByRole('button', { name: 'Render', exact: true }).click();
  expect(submit).toHaveBeenCalledOnce();
});

it('blocks render while scene changes are being saved', async () => {
  const submit = vi.fn();
  render(<RenderActionButton submitRenderVideo={submit} isUpdateLayerPending />);
  await expect.element(page.getByRole('button', { name: 'Render', exact: true })).toBeDisabled();
  expect(submit).not.toHaveBeenCalled();
});

it('disables duplicate rendering but allows cancellation of a pending render', async () => {
  const submit = vi.fn();
  const cancel = vi.fn();
  render(<RenderActionButton submitRenderVideo={submit} cancelPendingRender={cancel} isRenderPending />);
  await expect.element(page.getByRole('button', { name: 'Render', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel render' }).click();
  expect(cancel).toHaveBeenCalledOnce();
  expect(submit).not.toHaveBeenCalled();
});

it('changes the main action back to Render when a completed project is edited', async () => {
  const submit = vi.fn();
  const props = { renderedVideoPath: '/test-video.mp4', renderCompletedThisSession: true, submitRenderVideo: submit };
  const { rerender } = render(<RenderActionButton {...props} />);
  await expect.element(page.getByRole('button', { name: 'Download', exact: true })).toBeVisible();
  rerender(<RenderActionButton {...props} isCanvasDirty />);
  await page.getByRole('button', { name: 'Render', exact: true }).click();
  expect(submit).toHaveBeenCalledOnce();
});

it('lets a guest download an existing render without exposing publishing actions', async () => {
  session.user = null;
  render(<RenderActionButton renderedVideoPath='/test-video.mp4' publishVideoSession={vi.fn()} />);
  await expect.element(page.getByRole('button', { name: 'Download', exact: true })).toBeEnabled();
  await expect.element(page.getByRole('button', { name: 'Render', exact: true })).not.toBeInTheDocument();
  expect(document.querySelector('[aria-haspopup="menu"]')).toBeNull();
});

it('opens the real dropdown and invokes unpublish', async () => {
  const unpublish = vi.fn();
  render(<RenderActionButton renderedVideoPath='/test-video.mp4' isSessionPublished unpublishVideoSession={unpublish} />);
  await page.getByRole('button', { name: 'Render options' }).click();
  await page.getByRole('menuitem', { name: 'Unpublish' }).click();
  expect(unpublish).toHaveBeenCalledOnce();
});
