import { useEffect } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { UserProvider, useUser } from '../../src/contexts/UserContext.jsx';
import { clearAuthData, persistAuthToken } from '../../src/utils/web.jsx';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), color: 'dark' }));
vi.mock('axios', () => ({ default: { get: api.get, post: api.post } }));
vi.mock('../../src/contexts/ColorMode.jsx', () => ({ useColorMode: () => ({ colorMode: api.color }) }));
vi.mock('../../src/components/common/OverflowContainer.tsx', () => ({ default: ({ children }) => <main>{children}</main> }));
vi.mock('../../src/components/oneshot_editor/OneshotEditor.jsx', () => ({
  default: function HeavyEditorBoundary() {
    const { id } = useParams();
    return <section aria-label="Project editor">Project: {id}</section>;
  },
}));

vi.stubEnv('VITE_PROCESSOR_API', 'https://processor.test');
const { default: OneshotEditorContainer, preloadOneshotEditor } = await import('../../src/components/oneshot_editor/OneshotEditorContainer.jsx');

function TestControls() {
  const navigate = useNavigate();
  const location = useLocation();
  const { getUserAPI, resetUser, setUser } = useUser();
  useEffect(() => { void getUserAPI(); }, [getUserAPI]);
  return <>
    <output aria-label="Current route">{location.pathname}{location.search}</output>
    <output aria-label="Navigation state">{JSON.stringify(location.state)}</output>
    <button onClick={() => navigate('/vidgenie/direct-project')}>Open direct project</button>
    <button onClick={() => navigate('/vidgenie?tab=images')}>Change query</button>
    <button onClick={() => navigate(-1)}>Back</button>
    <button onClick={() => { persistAuthToken('new-owner-token'); void getUserAPI(); }}>Sign in</button>
    <button onClick={resetUser}>Sign out</button>
    <button onClick={() => { clearAuthData(); setUser({ _id: 'owner' }); }}>Owner without token</button>
  </>;
}

function mount({ path = '/vidgenie', history = [path] } = {}) {
  return render(<UserProvider><MemoryRouter initialEntries={history} initialIndex={history.length - 1}>
    <TestControls />
    <Routes>
      <Route path="/vidgenie/:id?" element={<OneshotEditorContainer />} />
      <Route path="/login" element={<div>Login screen</div>} />
      <Route path="*" element={<div>Other screen</div>} />
    </Routes>
  </MemoryRouter></UserProvider>);
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const pending = (id = 'owner-project') => ({ _id: id, videoGenerationPending: true, inputPrompt: 'A mountain scene' });
const guest = (id = 'sample-project') => ({ _id: id, isGuestSession: true, videoLink: '/sample.mp4' });

beforeEach(() => {
  vi.resetAllMocks();
  clearAuthData();
  localStorage.clear();
  sessionStorage.clear();
  api.color = 'dark';
  api.get.mockImplementation(async (url) => {
    if (url.endsWith('/users/verify_token')) return { data: { _id: 'owner' } };
    if (url.endsWith('/video_sessions/fetch_guest_session')) return { data: guest() };
    if (url.endsWith('/video_sessions/get_session')) return { data: pending() };
    throw new Error(`Unexpected GET ${url}`);
  });
  api.post.mockResolvedValue({ data: { sessionId: 'created-project' } });
});
afterEach(() => clearAuthData());
afterAll(() => vi.unstubAllEnvs());

describe('Vidgenie container authentication and project entry integration', () => {
  it('waits for token verification before mounting a directly requested private editor', async () => {
    persistAuthToken('private-owner-token');
    const verification = deferred();
    api.get.mockReturnValue(verification.promise);
    mount({ path: '/vidgenie/private-project' });
    expect(screen.getByRole('status', { name: 'Loading VidGenie' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('region', { name: 'Project editor' })).not.toBeInTheDocument();
    expect(api.get).toHaveBeenCalledOnce();
    expect(api.get).toHaveBeenCalledWith(expect.stringMatching(/\/users\/verify_token$/), expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer private-owner-token' }) }));
    await act(async () => verification.resolve({ data: { _id: 'owner' } }));
    expect(await screen.findByText('Project: private-project')).toBeVisible();
    expect(api.get).toHaveBeenCalledOnce();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('does not resolve an entry project while initial authentication is pending', async () => {
    persistAuthToken('private-owner-token');
    const verification = deferred();
    api.get.mockImplementation((url) => url.endsWith('/verify_token') ? verification.promise : Promise.resolve({ data: pending() }));
    mount({ path: '/vidgenie?tab=audio' });
    expect(screen.getByRole('status', { name: 'Loading VidGenie' })).toBeVisible();
    expect(api.get).toHaveBeenCalledOnce();
    await act(async () => verification.resolve({ data: { _id: 'owner' } }));
    expect(await screen.findByText('Project: owner-project')).toBeVisible();
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/vidgenie/owner-project?tab=audio');
    const latestCall = api.get.mock.calls.find(([url]) => url.endsWith('/video_sessions/get_session'));
    expect(latestCall[1]).toEqual({ headers: { 'Content-Type': 'application/json', Authorization: 'Bearer private-owner-token' } });
    expect(api.post).not.toHaveBeenCalled();
    expect(localStorage.getItem('videoSessionId')).toBe('owner-project');
  });

  it('opens a public sample for a guest without creating or requesting a private project', async () => {
    mount({ path: '/vidgenie?tab=images' });
    expect(await screen.findByText('Project: sample-project')).toBeVisible();
    expect(api.get).toHaveBeenCalledExactlyOnceWith('https://processor.test/video_sessions/fetch_guest_session');
    expect(api.post).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/vidgenie/sample-project?tab=images');
    expect(JSON.parse(screen.getByLabelText('Navigation state').textContent)).toEqual({ guestSession: guest() });
    expect(localStorage.getItem('videoSessionId')).toBeNull();
  });

  it('keeps a direct project route intact for a signed-out visitor', async () => {
    mount({ path: '/vidgenie/shared-project?tab=images' });
    expect(await screen.findByText('Project: shared-project')).toBeVisible();
    expect(api.get).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/vidgenie/shared-project?tab=images');
  });

  it('creates a new blank owner project when the latest project is complete', async () => {
    persistAuthToken('owner-token');
    api.get.mockImplementation(async (url) => ({ data: url.endsWith('/verify_token') ? { _id: 'owner' } : { _id: 'completed', videoLink: '/done.mp4', videoGenerationPending: false } }));
    mount();
    expect(await screen.findByText('Project: created-project')).toBeVisible();
    expect(api.post).toHaveBeenCalledExactlyOnceWith('https://processor.test/vidgenie/create_blank', {}, { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner-token' } });
    expect(localStorage.getItem('videoSessionId')).toBe('created-project');
    expect(screen.getByLabelText('Navigation state')).toHaveTextContent('null');
  });

  it('replaces the entry route in history so Back leaves the editor', async () => {
    mount({ history: ['/library', '/vidgenie'] });
    await screen.findByText('Project: sample-project');
    fireEvent.click(screen.getByRole('button', { name: 'Back', exact: true }));
    expect(await screen.findByText('Other screen')).toBeVisible();
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/library');
  });

  it.each(['dark', 'light'])('renders the actual loading and project shells in %s mode', async (color) => {
    api.color = color;
    const request = deferred();
    api.get.mockReturnValue(request.promise);
    mount();
    const loader = screen.getByRole('status', { name: 'Loading VidGenie' });
    expect(loader.className).toContain(color === 'dark' ? 'text-slate-100' : 'text-slate-900');
    await act(async () => request.resolve({ data: guest() }));
    const editor = await screen.findByRole('region', { name: 'Project editor' });
    // The project shell's foreground now comes from the theme token; its background stays theme-specific.
    const shellClassName = editor.closest('main').parentElement.className;
    expect(shellClassName).toContain('text-fg');
    expect(shellClassName).toContain(color === 'dark' ? 'bg-[#0c0d12]' : 'from-[#e9edf7]');
  });

  it('keeps an existing authenticated project mounted during background profile refresh', async () => {
    persistAuthToken('owner-token');
    mount({ path: '/vidgenie/direct-project' });
    await screen.findByText('Project: direct-project');
    const refresh = deferred();
    api.get.mockReturnValue(refresh.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in', exact: true }));
    expect(screen.getByText('Project: direct-project')).toBeVisible();
    expect(screen.queryByRole('status', { name: 'Loading VidGenie' })).not.toBeInTheDocument();
    await act(async () => refresh.resolve({ data: { _id: 'owner', name: 'Updated profile' } }));
    expect(screen.getByText('Project: direct-project')).toBeVisible();
  });

  it('does not request a private entry route for an owner whose auth token has disappeared', async () => {
    const guestRequest = deferred();
    api.get.mockReturnValue(guestRequest.promise);
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Owner without token' }));
    await act(async () => guestRequest.resolve({ data: guest() }));
    expect(screen.getByRole('status', { name: 'Loading VidGenie' })).toBeVisible();
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/vidgenie');
    expect(api.get).toHaveBeenCalledOnce();
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe('Vidgenie entry failures, retries, and stale work', () => {
  it.each([null, {}, { _id: 'private-project', isGuestSession: false }])('rejects a missing or non-public sample response without opening an editor', async (data) => {
    api.get.mockResolvedValue({ data });
    mount();
    expect(await screen.findByRole('heading', { name: 'VidGenie sample unavailable' })).toBeVisible();
    expect(screen.getByText('The sample project is unavailable. Log in to create in VidGenie.')).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Project editor' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Log in to create', exact: true }));
    expect(await screen.findByText('Login screen')).toBeVisible();
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/login?redirect=%2Fvidgenie');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('shows a recoverable owner error when project creation is rejected', async () => {
    persistAuthToken('owner-token');
    api.get.mockImplementation(async (url) => ({ data: url.endsWith('/verify_token') ? { _id: 'owner' } : null }));
    api.post.mockRejectedValue(new Error('quota exhausted'));
    mount();
    expect(await screen.findByText('Unable to open VidGenie.')).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Project editor' })).not.toBeInTheDocument();
    expect(api.post).toHaveBeenCalledOnce();
  });

  it('recovers from an owner entry error on a new route request', async () => {
    persistAuthToken('owner-token');
    api.get.mockImplementation(async (url) => ({ data: url.endsWith('/verify_token') ? { _id: 'owner' } : null }));
    api.post.mockRejectedValueOnce(new Error('temporary failure')).mockResolvedValueOnce({ data: { sessionId: 'retry-project' } });
    mount();
    await screen.findByText('Unable to open VidGenie.');
    fireEvent.click(screen.getByRole('button', { name: 'Change query', exact: true }));
    expect(await screen.findByText('Project: retry-project')).toBeVisible();
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/vidgenie/retry-project?tab=images');
    expect(screen.queryByText('Unable to open VidGenie.')).not.toBeInTheDocument();
    expect(api.post).toHaveBeenCalledTimes(2);
  });

  it('falls back to the guest route after initial authentication is rejected', async () => {
    persistAuthToken('expired-token');
    api.get.mockImplementation(async (url) => {
      if (url.endsWith('/verify_token')) throw { response: { status: 401 } };
      return { data: guest() };
    });
    mount();
    expect(await screen.findByText('Project: sample-project')).toBeVisible();
    expect(localStorage.getItem('authToken')).toBeNull();
    expect(api.get.mock.calls.map(([url]) => url)).toEqual([expect.stringMatching(/\/verify_token$/), 'https://processor.test/video_sessions/fetch_guest_session']);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('ignores a late guest response after the visitor signs in', async () => {
    const oldGuest = deferred();
    api.get.mockImplementation((url) => {
      if (url.endsWith('/fetch_guest_session')) return oldGuest.promise;
      return Promise.resolve({ data: url.endsWith('/verify_token') ? { _id: 'owner' } : pending() });
    });
    mount();
    expect(api.get).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in', exact: true }));
    expect(await screen.findByText('Project: owner-project')).toBeVisible();
    await act(async () => oldGuest.resolve({ data: guest('stale-guest') }));
    expect(screen.getByText('Project: owner-project')).toBeVisible();
    expect(screen.queryByText('Project: stale-guest')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Navigation state')).toHaveTextContent('null');
  });

  it('ignores a late entry response after direct navigation to another project', async () => {
    const oldEntry = deferred();
    api.get.mockReturnValue(oldEntry.promise);
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Open direct project', exact: true }));
    expect(await screen.findByText('Project: direct-project')).toBeVisible();
    await act(async () => oldEntry.resolve({ data: guest('stale-sample') }));
    expect(screen.getByText('Project: direct-project')).toBeVisible();
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/vidgenie/direct-project');
  });

  it('ignores a late guest failure after direct navigation', async () => {
    const oldEntry = deferred();
    api.get.mockReturnValue(oldEntry.promise);
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Open direct project', exact: true }));
    await screen.findByText('Project: direct-project');
    await act(async () => oldEntry.reject(new Error('old request unavailable')));
    expect(screen.queryByRole('heading', { name: 'VidGenie sample unavailable' })).not.toBeInTheDocument();
    expect(screen.getByText('Project: direct-project')).toBeVisible();
  });

  it('uses the newest query request when guest responses arrive out of order', async () => {
    const first = deferred();
    const second = deferred();
    api.get.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Change query', exact: true }));
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    await act(async () => second.resolve({ data: guest('newest-sample') }));
    await screen.findByText('Project: newest-sample');
    await act(async () => first.resolve({ data: guest('old-sample') }));
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/vidgenie/newest-sample?tab=images');
    expect(screen.getByText('Project: newest-sample')).toBeVisible();
  });

  it('does not mutate navigation or start further work after unmount', async () => {
    const request = deferred();
    api.get.mockReturnValue(request.promise);
    const view = mount();
    expect(api.get).toHaveBeenCalledOnce();
    view.unmount();
    await act(async () => request.resolve({ data: guest() }));
    expect(api.get).toHaveBeenCalledOnce();
    expect(api.post).not.toHaveBeenCalled();
    expect(view.container).toBeEmptyDOMElement();
  });

  it('exposes a preload function that resolves the same lazy editor boundary', async () => {
    const preloaded = await preloadOneshotEditor();
    expect(typeof preloaded.default).toBe('function');
    mount({ path: '/vidgenie/preloaded' });
    expect(await screen.findByText('Project: preloaded')).toBeVisible();
  });
});
