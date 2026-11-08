import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import TopNav from '../../src/components/common/TopNav.tsx';
import MobileTopNav from '../../src/components/common/MobileTopNav.tsx';
import { NavCanvasControlContext } from '../../src/contexts/NavCanvasControlContext.jsx';
import { LocalizationProvider } from '../../src/contexts/LocalizationContext.jsx';
import axios from 'axios';
import { createStudioSession } from '../../src/utils/studioSessionApi.js';

const mocks = vi.hoisted(() => ({ openAlertDialog: vi.fn(), closeAlertDialog: vi.fn(), userState: {} }));
vi.mock('../../src/contexts/UserContext.jsx', () => ({ useUser: () => mocks.userState }));
vi.mock('../../src/contexts/AlertDialogContext.jsx', () => ({ useAlertDialog: () => mocks }));
vi.mock('../../src/components/video/toolbars/CanvasControlBar.jsx', () => ({ default: () => <div data-testid="session-controls" /> }));
vi.mock('../../src/utils/web.jsx', () => ({ getHeaders: () => ({ headers: {} }) }));
vi.mock('../../src/utils/studioSessionApi.js', () => ({ createStudioSession: vi.fn() }));
vi.mock('axios', () => ({ default: { post: vi.fn() } }));

function Location() {
  return <output aria-label="Current route">{useLocation().pathname}</output>;
}

function renderNav(Nav, path, props = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LocalizationProvider>
        <NavCanvasControlContext.Provider value={{}}>
          <Nav addNewVidGPTSession={vi.fn()} {...props} />
          <Location />
        </NavCanvasControlContext.Provider>
      </LocalizationProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  mocks.userState = { user: { _id: 'user', generationCredits: 1000 }, userFetching: false, userInitiated: true };
  localStorage.setItem('videoSessionId', 'video-1');
  localStorage.setItem('imageSessionId', 'image-1');
  localStorage.setItem('defaultImageAspectRatio', '1:1');
  createStudioSession.mockResolvedValue({ _id: 'new-video' });
  axios.post.mockResolvedValue({ data: { _id: 'new-image' } });
});

describe.each([['desktop', TopNav], ['mobile', MobileTopNav]])('%s navigation', (_, Nav) => {
  it.each(['/video/video-1', '/image/studio/image-1', '/audio/studio', '/vidgenie/video-1', '/account', '/generations'])(
    'shows the same destinations from %s without opening project setup', async (path) => {
      renderNav(Nav, path);
      fireEvent.click(await screen.findByRole('button', { name: 'New Project' }));
      const menu = await screen.findByRole('menu', { name: 'New Project' });
      expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent.trim())).toEqual([
        'Studio', 'VidGenie', 'Image Editor', 'Audio Studio', 'View Projects',
      ]);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(mocks.openAlertDialog).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['Studio', '/video'],
    ['Image Editor', '/image/studio/image-1'],
    ['Audio Studio', '/audio/studio'],
  ])('opens %s directly from another canvas', async (label, target) => {
    renderNav(Nav, '/vidgenie/video-1');
    fireEvent.click(await screen.findByRole('button', { name: 'New Project' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: label, exact: true }));
    expect(screen.getByLabelText('Current route')).toHaveTextContent(target);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.openAlertDialog).not.toHaveBeenCalled();
    expect(createStudioSession).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });

  it.each([
    ['Studio', '/video/new-video'],
    ['Image Editor', '/image/studio/new-image'],
  ])('opens a default %s canvas on the first visit', async (label, target) => {
    localStorage.clear();
    renderNav(Nav, '/audio/studio');
    fireEvent.click(await screen.findByRole('button', { name: 'New Project' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: label, exact: true }));
    await waitFor(() => expect(screen.getByLabelText('Current route')).toHaveTextContent(target));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.openAlertDialog).not.toHaveBeenCalled();
  });

  it.each([
    ['/image/studio/image-1', '/image_sessions'],
    ['/audio/studio', '/my_sessions'],
    ['/video/video-1', '/my_sessions'],
  ])('keeps View Projects reachable from %s', async (path, target) => {
    renderNav(Nav, path);
    fireEvent.click(await screen.findByRole('button', { name: 'New Project' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'View Projects' }));
    expect(screen.getByLabelText('Current route')).toHaveTextContent(target);
  });

  it.each([
    ['/video/video-1', 'New Studio project', 'Create new session'],
    ['/image/studio/image-1', 'New image project', 'Create new Image session'],
  ])('opens setup only through the dedicated action on %s', async (path, label, title) => {
    renderNav(Nav, path);
    fireEvent.click(await screen.findByRole('button', { name: label }));
    const dialog = screen.getByRole('dialog', { name: title });
    fireEvent.change(within(dialog).getByLabelText(/^(Session|Project) name$/), { target: { value: 'My project' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create session' }));
    await waitFor(() => expect(screen.getByLabelText('Current route')).toHaveTextContent(path.startsWith('/image') ? '/image/studio/new-image' : '/video/new-video'));
    expect(mocks.openAlertDialog).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    if (path.startsWith('/image')) {
      expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/image_sessions/create_session'), expect.objectContaining({ sessionName: 'My project', canvasDimensions: { width: 1024, height: 1024 } }), expect.anything());
    } else {
      expect(createStudioSession).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ sessionName: 'My project' }) }));
    }
  });
});

it('keeps Audio Studio actions separate from navigation', async () => {
  const openAudioActions = vi.fn();
  renderNav(TopNav, '/audio/studio', { openAudioActions });
  fireEvent.click(await screen.findByRole('button', { name: 'Audio actions' }));
  expect(openAudioActions).toHaveBeenCalledOnce();
  expect(screen.getByLabelText('Current route')).toHaveTextContent('/audio/studio');
});


it('keeps session controls out of the loading navigation, even with a previous canvas in context', async () => {
  const { rerender } = renderNav(TopNav, '/video/video-1', { isWorkspaceLoading: true });
  expect(screen.queryByTestId('session-controls')).toBeNull();
  rerender(<MemoryRouter initialEntries={['/video/video-1']}><LocalizationProvider><NavCanvasControlContext.Provider value={{}}><TopNav isWorkspaceLoading={false} /><Location /></NavCanvasControlContext.Provider></LocalizationProvider></MemoryRouter>);
  expect(await screen.findByTestId('session-controls')).toBeVisible();
});

it.each([TopNav, MobileTopNav])('does not flash a login action before authentication resolves', Nav => {
  mocks.userState = { user: null, userFetching: true, userInitiated: false };
  renderNav(Nav, '/vidgenie/video-1');
  expect(screen.queryByRole('button', { name: 'Login' })).toBeNull();
  expect(document.querySelector('[data-app-top-nav]')).not.toBeNull();
});
