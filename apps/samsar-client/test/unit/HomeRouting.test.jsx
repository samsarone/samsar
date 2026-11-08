import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { BrowserRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';

const scenario = vi.hoisted(() => ({
  user: null, userFetching: false, userInitiated: true, mobile: false, standalone: false,
  colorMode: 'dark', authToken: null, storedRedirect: null, channels: [],
  getUserAPI: vi.fn(), resetUser: vi.fn(), persistAuthToken: vi.fn(),
  resolvePostAuthDestination: vi.fn(), resolvePostSignupDestination: vi.fn(), preload: vi.fn(),
}));
vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('react-responsive', () => ({ useMediaQuery: () => scenario.mobile }));
vi.mock('../../src/contexts/UserContext', () => ({ useUser: () => scenario }));
vi.mock('../../src/contexts/ColorMode.jsx', () => ({ useColorMode: () => ({ colorMode: scenario.colorMode }) }));
vi.mock('../../src/utils/environment.jsx', () => ({ get IS_STANDALONE_DEPLOYMENT() { return scenario.standalone; } }));
vi.mock('../../src/utils/web.jsx', () => ({
  getAuthToken: () => scenario.authToken,
  persistAuthToken: (...args) => scenario.persistAuthToken(...args),
  consumePostAuthRedirect: () => scenario.storedRedirect,
  getHeaders: () => null, hasAcceptedCookies: () => false, setPostAuthRedirect: vi.fn(),
}));
vi.mock('../../src/utils/authRedirect.js', async (importOriginal) => ({
  ...await importOriginal(),
  resolvePostAuthDestination: (...args) => scenario.resolvePostAuthDestination(...args),
  resolvePostSignupDestination: (...args) => scenario.resolvePostSignupDestination(...args),
}));

// Page contents are boundaries here: the routing component, history, guards,
// query handling and authentication effects are the real implementations.
vi.mock('../../src/components/editor/EditorHome.tsx', () => ({ default: () => <div>Page: image editor</div> }));
vi.mock('../../src/components/account/UserAccount.tsx', () => ({ default: () => <div>Page: account</div> }));
vi.mock('../../src/components/publication/PublicationHome.tsx', () => ({ default: () => <div>Page: publication</div> }));
vi.mock('../../src/components/verification/VerificationHome.tsx', () => ({ default: () => <div>Page: verify</div> }));
vi.mock('../../src/components/video/VideoHome.jsx', () => ({ default: () => <div>Page: studio editor</div> }));
vi.mock('../../src/components/video/VideoEditorLandingHome.jsx', () => ({ default: () => <div>Page: studio landing</div> }));
vi.mock('../../src/components/video/sessions/ListVideoSessions.jsx', () => ({ default: () => <div>Page: video projects</div> }));
vi.mock('../../src/components/quick_editor/QuickEditorContainer.jsx', () => ({ default: () => <div>Page: quick editor</div> }));
vi.mock('../../src/components/verification/EmailVerificationHome.jsx', () => ({ default: () => <div>Page: verify email</div> }));
vi.mock('../../src/components/oneshot_editor/OneshotEditorContainer.jsx', () => ({
  default: () => <div>Page: vidgenie editor</div>, preloadOneshotEditor: () => scenario.preload(),
}));
vi.mock('../../src/components/quick_editor/QuickEditorLandingHome.jsx', () => ({ default: () => <div>Page: quick landing</div> }));
vi.mock('../../src/components/mobile/MobileVideoLandingHome.jsx', () => ({ default: () => <div>Page: mobile landing</div> }));
vi.mock('../../src/components/auth/pages/LoginPage.jsx', () => ({ default: () => <div>Page: login</div> }));
vi.mock('../../src/components/auth/pages/ForgotPasswordPage.jsx', () => ({ default: () => <div>Page: forgot password</div> }));
vi.mock('../../src/components/auth/pages/ResetPasswordPage.jsx', () => ({ default: () => <div>Page: reset password</div> }));
vi.mock('../../src/components/auth/pages/RegisterPage.jsx', () => ({ default: () => <div>Page: register</div> }));
vi.mock('../../src/components/auth/ExtensionAuthBridge.jsx', () => ({ default: () => <div>Page: extension auth</div> }));
vi.mock('../../src/components/advideo_creator/AdVideoCreatorContainer.jsx', () => ({ default: () => <div>Page: ad creator</div> }));
vi.mock('../../src/components/payments/PaymentsSuccess.jsx', () => ({ default: () => <div>Page: payment success</div> }));
vi.mock('../../src/components/payments/PaymentsFailure.jsx', () => ({ default: () => <div>Page: payment failure</div> }));
vi.mock('../../src/components/payments/CreatePayment.jsx', () => ({ default: () => <div>Page: create payment</div> }));
vi.mock('../../src/components/movie_gen/MovieGeneratorContainer.jsx', () => ({ default: () => <div>Page: movie maker</div> }));
vi.mock('../../src/components/image/ImageStudioHome.jsx', () => ({ default: () => <div>Page: image studio</div> }));
vi.mock('../../src/components/image/sessions/ListImageSessions.jsx', () => ({ default: () => <div>Page: image projects</div> }));
vi.mock('../../src/components/image/ImageStudioLandingHome.jsx', () => ({ default: () => <div>Page: image landing</div> }));
vi.mock('../../src/components/audio/AudioStudioHome.jsx', () => ({ default: () => <div>Page: audio studio</div> }));
vi.mock('../../src/components/external/ExternalStudioDashboard.jsx', () => ({ default: () => <div>Page: external studio</div> }));
vi.mock('../../src/components/generations/GenerationsHome.jsx', () => ({ default: () => <div>Page: generations</div> }));
vi.mock('../../src/components/oneshot_editor/VidgenieSkeletonLoader.jsx', () => ({ default: () => <div>Loading Vidgenie page</div> }));
vi.mock('../../src/components/video/util/StudioSkeletonLoader.jsx', () => ({ default: () => <div>Loading Studio page</div> }));

import Home, { getRouteLoadingFallback } from '../../src/components/landing/Home.tsx';
const originalBroadcastChannel = globalThis.BroadcastChannel;

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}
async function settle() {
  await act(async () => { await vi.dynamicImportSettled(); });
}
function homeTree(strict = false) {
  const app = <BrowserRouter><Home /><LocationProbe /></BrowserRouter>;
  return strict ? <StrictMode>{app}</StrictMode> : app;
}
async function mount(path = '/', { strict = false } = {}) {
  window.history.replaceState(null, '', path);
  const rendered = render(homeTree(strict));
  await settle();
  return rendered;
}
function location() { return screen.getByTestId('location').textContent; }
function activeChannel() { return scenario.channels.findLast((channel) => !channel.close.mock.calls.length); }

beforeEach(() => {
  scenario.user = null;
  scenario.userFetching = false;
  scenario.userInitiated = true;
  scenario.userLoadFailed = false;
  scenario.mobile = false;
  scenario.standalone = false;
  scenario.colorMode = 'dark';
  scenario.authToken = null;
  scenario.storedRedirect = null;
  scenario.channels = [];
  scenario.getUserAPI.mockReset().mockImplementation(async () => scenario.user);
  scenario.resetUser.mockReset().mockImplementation(() => { scenario.user = null; });
  scenario.persistAuthToken.mockReset();
  scenario.resolvePostAuthDestination.mockReset().mockResolvedValue('/vidgenie/default-project');
  scenario.resolvePostSignupDestination.mockReset().mockResolvedValue('/video/signup-project');
  scenario.preload.mockReset().mockResolvedValue(undefined);
  axios.get.mockReset().mockResolvedValue({ data: {} });
  vi.stubGlobal('BroadcastChannel', vi.fn(function (name) {
    const channel = { name, onmessage: null, close: vi.fn() };
    scenario.channels.push(channel);
    return channel;
  }));
});

describe('routing lifecycle and single-use handoff regressions', () => {
  it.each(['/video/existing-project', '/vidgenie/existing-project'])('preserves %s after profile loading fails and allows retry', async (path) => {
    scenario.authToken = 'valid-token';
    scenario.userLoadFailed = true;
    const view = await mount(path);
    expect(location()).toBe(path);
    expect(screen.getByRole('alert')).toBeVisible();
    const callsBeforeRetry = scenario.getUserAPI.mock.calls.length;
    scenario.getUserAPI.mockImplementation(async () => {
      scenario.user = { _id: 'recovered-user' };
      scenario.userLoadFailed = false;
      return scenario.user;
    });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await settle();
    view.rerender(homeTree());
    await settle();
    expect(location()).toBe(path);
    expect(scenario.getUserAPI).toHaveBeenCalledTimes(callsBeforeRetry + 1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('retries failed root authentication without redirecting valid credentials to login', async () => {
    scenario.authToken = 'valid-token';
    scenario.userInitiated = false;
    scenario.getUserAPI.mockImplementation(async () => {
      scenario.userInitiated = true;
      scenario.userLoadFailed = true;
      return null;
    });
    const view = await mount('/');
    view.rerender(homeTree());
    await settle();
    expect(location()).toBe('/');
    expect(screen.getByRole('alert')).toBeVisible();
    expect(scenario.getUserAPI).toHaveBeenCalledOnce();
    scenario.getUserAPI.mockImplementation(async () => {
      scenario.userLoadFailed = false;
      scenario.user = { _id: 'recovered-user' };
      return scenario.user;
    });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await settle();
    expect(scenario.getUserAPI).toHaveBeenCalledTimes(2);
    expect(location()).toBe('/vidgenie/default-project');
  });

  it.each(['/video/project-123', '/vidgemie/project-123'])('preserves public options without forwarding credentials from %s', async (path) => {
    scenario.mobile = true;
    await mount(`${path}?authToken=secret&theme=watercolor`);
    expect(location()).toBe('/vidgenie/project-123?theme=watercolor');
  });

  it('resolves the authenticated root only once during Strict Mode effect replay', async () => {
    scenario.user = { _id: 'user-1' };
    await mount('/?source=library', { strict: true });
    expect(location()).toBe('/vidgenie/default-project');
    expect(scenario.resolvePostAuthDestination).toHaveBeenCalledOnce();
    expect(scenario.resolvePostAuthDestination).toHaveBeenCalledWith(expect.objectContaining({ search: '?source=library' }));
  });

  it('shares in-flight root hydration during Strict Mode effect replay', async () => {
    let resolveUser;
    scenario.authToken = 'existing-token';
    scenario.userInitiated = false;
    scenario.getUserAPI.mockReturnValue(new Promise((resolve) => { resolveUser = resolve; }));
    await mount('/?authToken=secret&theme=watercolor', { strict: true });
    expect(scenario.getUserAPI).toHaveBeenCalledOnce();
    await act(async () => resolveUser({ _id: 'hydrated-user' }));
    await settle();
    expect(location()).toBe('/vidgenie/default-project');
    expect(scenario.resolvePostAuthDestination).toHaveBeenCalledOnce();
    expect(scenario.resolvePostAuthDestination).toHaveBeenCalledWith(expect.objectContaining({ search: '?theme=watercolor' }));
  });

  it('reuses in-flight destination lookup when the same authenticated user rerenders', async () => {
    let resolvePath;
    scenario.user = { _id: 'user-1' };
    scenario.resolvePostAuthDestination.mockReturnValue(new Promise((resolve) => { resolvePath = resolve; }));
    const view = await mount('/');
    scenario.user = { _id: 'user-1', username: 'refreshed profile' };
    view.rerender(homeTree());
    await settle();
    expect(scenario.resolvePostAuthDestination).toHaveBeenCalledOnce();
    await act(async () => resolvePath('/vidgenie/one-project'));
    await settle();
    expect(location()).toBe('/vidgenie/one-project');
  });

  it('invalidates an initial token-root destination when public route options change', async () => {
    const resolutions = [];
    scenario.authToken = 'existing-token';
    scenario.user = { _id: 'user-1' };
    scenario.resolvePostAuthDestination.mockImplementation((options) => new Promise((resolve) => resolutions.push({ options, resolve })));
    await mount('/?theme=old');
    await act(async () => {
      window.history.pushState(null, '', '/?theme=new');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(resolutions).toHaveLength(2);
    expect(resolutions[1].options.search).toBe('?theme=new');
    await act(async () => resolutions[0].resolve('/vidgenie/old-project?theme=old'));
    expect(location()).toBe('/?theme=new');
    await act(async () => resolutions[1].resolve('/vidgenie/new-project?theme=new'));
    await settle();
    expect(location()).toBe('/vidgenie/new-project?theme=new');
  });

  it('invalidates an initial token-root destination when the active account changes', async () => {
    const resolutions = [];
    scenario.authToken = 'existing-token';
    scenario.user = { _id: 'account-a' };
    scenario.resolvePostAuthDestination.mockImplementation((options) => new Promise((resolve) => resolutions.push({ options, resolve })));
    const view = await mount('/');
    scenario.user = { _id: 'account-b' };
    view.rerender(homeTree());
    await settle();
    expect(resolutions).toHaveLength(2);
    expect(resolutions[1].options.user._id).toBe('account-b');
    await act(async () => resolutions[0].resolve('/vidgenie/account-a-project'));
    expect(location()).toBe('/');
    await act(async () => resolutions[1].resolve('/vidgenie/account-b-project'));
    await settle();
    expect(location()).toBe('/vidgenie/account-b-project');
  });

  it('reuses initial token-root session creation after its hydrated profile appears in context', async () => {
    let resolveUser;
    let resolvePath;
    scenario.authToken = 'existing-token';
    scenario.userInitiated = false;
    scenario.getUserAPI.mockImplementation(async () => {
      const profile = await new Promise((resolve) => { resolveUser = resolve; });
      scenario.user = profile;
      scenario.userInitiated = true;
      return profile;
    });
    scenario.resolvePostAuthDestination.mockReturnValue(new Promise((resolve) => { resolvePath = resolve; }));
    const view = await mount('/', { strict: true });
    await act(async () => resolveUser({ _id: 'hydrated-account' }));
    view.rerender(homeTree(true));
    await settle();
    expect(scenario.getUserAPI).toHaveBeenCalledOnce();
    expect(scenario.resolvePostAuthDestination).toHaveBeenCalledOnce();
    await act(async () => resolvePath('/vidgenie/single-created-project'));
    await settle();
    expect(location()).toBe('/vidgenie/single-created-project');
  });

  it('does not navigate to an old root lookup result after the user has changed routes', async () => {
    let resolvePath;
    scenario.user = { _id: 'user-1' };
    scenario.resolvePostAuthDestination.mockReturnValue(new Promise((resolve) => { resolvePath = resolve; }));
    await mount('/');
    await act(async () => {
      window.history.pushState(null, '', '/account/profile');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await act(async () => resolvePath('/vidgenie/stale-project'));
    await settle();
    expect(location()).toBe('/account/profile');
  });

  it('returns to login if initial root authentication rejects', async () => {
    scenario.authToken = 'expired-token';
    scenario.userInitiated = false;
    scenario.getUserAPI.mockRejectedValue(new Error('Session expired'));
    await mount('/');
    expect(location()).toBe('/login');
    expect(scenario.resolvePostAuthDestination).not.toHaveBeenCalled();
  });

  it('retains public query options in the fallback when root destination lookup rejects', async () => {
    scenario.user = { _id: 'user-1' };
    scenario.resolvePostAuthDestination.mockRejectedValue(new Error('Workspace unavailable'));
    await mount('/?theme=watercolor&authToken=secret');
    expect(location()).toBe('/vidgenie?theme=watercolor');
  });

  it('exchanges and hydrates a one-use token once during Strict Mode effect replay', async () => {
    axios.get.mockResolvedValue({ data: { authToken: 'new-auth-token' } });
    scenario.getUserAPI.mockImplementation(async () => {
      scenario.user = { _id: 'signed-in' };
      return scenario.user;
    });
    await mount('/login?loginToken=one-use-token&redirect=%2Faccount%2Fprofile', { strict: true });
    expect(axios.get).toHaveBeenCalledOnce();
    expect(scenario.persistAuthToken).toHaveBeenCalledOnce();
    expect(scenario.getUserAPI).toHaveBeenCalledOnce();
    expect(scenario.resetUser).not.toHaveBeenCalled();
    expect(location()).toBe('/account/profile');
  });

  it.each([
    [true, false, '/video/project-1'],
    [false, true, '/my_sessions'],
  ])('completes the token handoff before mobile=%s or standalone=%s route redirects run', async (mobile, standalone, path) => {
    scenario.mobile = mobile;
    scenario.standalone = standalone;
    axios.get.mockResolvedValue({ data: { authToken: 'new-auth-token' } });
    scenario.getUserAPI.mockImplementation(async () => {
      scenario.user = { _id: 'signed-in' };
      return scenario.user;
    });
    await mount(`${path}?loginToken=one-use-token&theme=watercolor`);
    expect(axios.get).toHaveBeenCalledOnce();
    expect(scenario.persistAuthToken).toHaveBeenCalledExactlyOnceWith('new-auth-token');
    expect(scenario.resetUser).not.toHaveBeenCalled();
    expect(location()).toBe('/vidgenie/default-project');
  });

  it('keeps a successful sign-in when workspace destination resolution fails', async () => {
    axios.get.mockResolvedValue({ data: { authToken: 'new-auth-token' } });
    scenario.getUserAPI.mockImplementation(async () => {
      scenario.user = { _id: 'signed-in' };
      return scenario.user;
    });
    scenario.resolvePostAuthDestination.mockRejectedValue(new Error('Workspace unavailable'));
    await mount('/login?loginToken=one-use-token&theme=watercolor');
    expect(location()).toBe('/vidgenie?theme=watercolor');
    expect(scenario.resetUser).not.toHaveBeenCalled();
  });

  it('can revisit a completed token URL without consuming the token or resetting the user again', async () => {
    axios.get.mockResolvedValue({ data: { authToken: 'new-auth-token' } });
    scenario.getUserAPI.mockImplementation(async () => {
      scenario.user = { _id: 'signed-in' };
      return scenario.user;
    });
    const tokenUrl = '/login?loginToken=one-use-token&redirect=%2Faccount';
    await mount(tokenUrl);
    await act(async () => {
      window.history.pushState(null, '', tokenUrl);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await settle();
    expect(location()).toBe('/account');
    expect(axios.get).toHaveBeenCalledOnce();
    expect(scenario.persistAuthToken).toHaveBeenCalledOnce();
    expect(scenario.resetUser).not.toHaveBeenCalled();
  });

  it.each([false, true])('ignores verification completion after Home unmounts, rejected=%s', async (rejects) => {
    let complete;
    let fail;
    axios.get.mockReturnValue(new Promise((resolve, reject) => { complete = resolve; fail = reject; }));
    const view = await mount('/login?loginToken=in-flight-token');
    view.unmount();
    await act(async () => rejects ? fail(new Error('Token already consumed')) : complete({ data: { authToken: 'late-token' } }));
    expect(scenario.persistAuthToken).not.toHaveBeenCalled();
    expect(scenario.getUserAPI).not.toHaveBeenCalled();
    expect(scenario.resetUser).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/login');
    expect(window.location.search).toBe('?loginToken=in-flight-token');
  });

  it('does not let an obsolete token failure undo a newer successful sign-in', async () => {
    let failOldToken;
    axios.get.mockImplementation((_url, options) => options.params.loginToken === 'old-token'
      ? new Promise((_resolve, reject) => { failOldToken = reject; })
      : Promise.resolve({ data: { authToken: 'new-auth-token' } }));
    scenario.getUserAPI.mockImplementation(async () => {
      scenario.user = { _id: 'signed-in' };
      return scenario.user;
    });
    await mount('/login?loginToken=old-token');
    await act(async () => {
      window.history.pushState(null, '', '/login?loginToken=new-token&redirect=%2Faccount');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await settle();
    expect(location()).toBe('/account');
    await act(async () => failOldToken(new Error('Old token expired')));
    expect(location()).toBe('/account');
    expect(scenario.resetUser).not.toHaveBeenCalled();
    expect(scenario.persistAuthToken).toHaveBeenCalledExactlyOnceWith('new-auth-token');
  });

  it('does not navigate after unmounting during authenticated destination resolution', async () => {
    let resolvePath;
    axios.get.mockResolvedValue({ data: { authToken: 'new-auth-token' } });
    scenario.getUserAPI.mockResolvedValue({ _id: 'signed-in' });
    scenario.resolvePostAuthDestination.mockReturnValue(new Promise((resolve) => { resolvePath = resolve; }));
    const view = await mount('/login?loginToken=one-use-token');
    expect(scenario.resolvePostAuthDestination).toHaveBeenCalledOnce();
    view.unmount();
    await act(async () => resolvePath('/vidgenie/late-project'));
    expect(window.location.pathname).toBe('/login');
    expect(scenario.resetUser).not.toHaveBeenCalled();
  });
});
afterEach(() => {
  cleanup();
  globalThis.BroadcastChannel = originalBroadcastChannel;
});

describe('client route mapping and device restrictions', () => {
  it.each([
    ['/session/image-1', 'image editor'], ['/account/settings', 'account'], ['/publication/p1', 'publication'],
    ['/verify', 'verify'], ['/video/project-1', 'studio editor'], ['/video', 'studio landing'],
    ['/my_sessions', 'video projects'], ['/quick_video/q1', 'quick editor'], ['/quick_video', 'quick landing'],
    ['/verify_email', 'verify email'], ['/vidgenie/v1', 'vidgenie editor'], ['/vidgpt/v1', 'vidgenie editor'],
    ['/videogpt/v1', 'vidgenie editor'], ['/login', 'login'], ['/register', 'register'],
    ['/forgot_password', 'forgot password'], ['/reset_password', 'reset password'],
    ['/extension-auth', 'extension auth'], ['/adcreator/a1', 'ad creator'],
    ['/payment_success', 'payment success'], ['/payment_cancel', 'payment failure'], ['/create_payment', 'create payment'],
    ['/movie_maker/m1', 'movie maker'], ['/image/studio/i1', 'image studio'], ['/iamge/studio/i1', 'image studio'],
    ['/image/studio', 'image landing'], ['/iamge/studio', 'image landing'],
    ['/image_sessions', 'image projects'], ['/audio/studio', 'audio studio'], ['/generations', 'generations'],
  ])('mounts the expected authenticated page at %s', async (path, page) => {
    scenario.user = { _id: 'user-1' };
    await mount(path);
    expect(screen.getByText(`Page: ${page}`)).toBeInTheDocument();
    expect(location()).toBe(path);
    expect(scenario.getUserAPI).toHaveBeenCalledOnce();
  });

  it.each(['/video/share/shared-1', '/video/collab/editable-1'])('allows a hosted desktop guest to open %s', async (path) => {
    await mount(path);
    expect(screen.getByText('Page: studio editor')).toBeInTheDocument();
    expect(location()).toBe(path);
  });

  it.each(['/video/share/shared-1', '/video/collab/editable-1'])('shows desktop-only editing instructions on mobile at %s', async (path) => {
    scenario.mobile = true;
    scenario.colorMode = 'light';
    await mount(path);
    expect(screen.getByText('Open link on desktop to edit.')).toBeInTheDocument();
    expect(screen.queryByText('Page: studio editor')).not.toBeInTheDocument();
  });

  it.each(['/video', '/'])('uses the mobile landing for guests at %s', async (path) => {
    scenario.mobile = true;
    await mount(path);
    expect(screen.getByText('Page: mobile landing')).toBeInTheDocument();
  });

  it.each(['/quick_video', '/quick_video/q1'])('opens the one-shot editor on mobile at %s', async (path) => {
    scenario.mobile = true;
    scenario.user = { _id: 'u1' };
    await mount(path);
    expect(screen.getByText('Page: vidgenie editor')).toBeInTheDocument();
  });

  it('redirects mobile Studio sessions into the corresponding Vidgenie project', async () => {
    scenario.mobile = true;
    await mount('/video/project-123');
    expect(location()).toBe('/vidgenie/project-123');
    expect(screen.getByText('Page: vidgenie editor')).toBeInTheDocument();
  });

  it('preserves non-secret route options when redirecting a mobile Studio session', async () => {
    scenario.mobile = true;
    await mount('/video/project-123?theme=watercolor&source=library');
    expect(location()).toBe('/vidgenie/project-123?theme=watercolor&source=library');
  });

  it.each([
    ['/vidgemie', '/vidgenie'], ['/vidgemie/project-1', '/vidgenie/project-1'],
  ])('repairs legacy misspelling %s and retains route options', async (path, expected) => {
    await mount(`${path}?source=library`);
    expect(location()).toBe(`${expected}?source=library`);
  });
});

describe('guest and external-user guards', () => {
  it('keeps a hosted guest on the desktop landing', async () => {
    await mount('/');
    expect(screen.getByText('Page: studio landing')).toBeInTheDocument();
    expect(scenario.resolvePostAuthDestination).not.toHaveBeenCalled();
  });

  it('remembers a protected hosted route in the login redirect', async () => {
    await mount('/my_sessions?sort=newest');
    expect(location()).toBe('/login?redirect=%2Fmy_sessions%3Fsort%3Dnewest');
    expect(screen.getByText('Page: login')).toBeInTheDocument();
  });

  it.each(['/', '/register', '/video', '/video/share/shared', '/image/studio', '/generations'])
    ('requires standalone authentication at %s', async (path) => {
      scenario.standalone = true;
      await mount(path);
      expect(location()).toBe('/login');
      expect(screen.getByText('Page: login')).toBeInTheDocument();
    });

  it.each(['/login', '/forgot_password', '/reset_password', '/verify', '/verify_email'])
    ('leaves the standalone public authentication route %s accessible', async (path) => {
      scenario.standalone = true;
      await mount(path);
      expect(location()).toBe(path);
      expect(screen.queryByText('Page: studio editor')).not.toBeInTheDocument();
    });

  it.each([['userInitiated', false], ['userFetching', true]])
    ('does not prematurely redirect a user while %s=%s', async (field, value) => {
      scenario.standalone = true;
      scenario[field] = value;
      await mount('/');
      expect(location()).toBe('/');
      expect(screen.getByText('Loading Studio page')).toBeInTheDocument();
    });

  it('routes external users back to their dashboard while keeping verification reachable', async () => {
    scenario.user = { _id: 'external-1', isExternalUser: true };
    await mount('/video/project-1');
    expect(location()).toBe('/external/studio');
    expect(screen.getByText('Page: external studio')).toBeInTheDocument();
  });

  it('keeps external account verification reachable', async () => {
    scenario.user = { _id: 'external-1', isExternalUser: true };
    await mount('/verify');
    expect(location()).toBe('/verify');
    expect(screen.getByText('Page: verify')).toBeInTheDocument();
  });
});

describe('authenticated root bootstrap', () => {
  it('preserves public query options and strips credentials before authenticated-root destination lookup', async () => {
    scenario.user = { _id: 'user-1' };
    await mount('/?authToken=do-not-forward&theme=watercolor');
    expect(location()).toBe('/vidgenie/default-project');
    expect(scenario.resolvePostAuthDestination).toHaveBeenLastCalledWith(expect.objectContaining({
      user: scenario.user, isMobile: false, search: '?theme=watercolor', createIfMissing: true,
    }));
    expect(scenario.preload).toHaveBeenCalled();
  });

  it('uses the hosted fallback and retains public query options if destination resolution returns no path', async () => {
    scenario.user = { _id: 'user-1' };
    scenario.resolvePostAuthDestination.mockResolvedValue(null);
    await mount('/?source=library&authToken=secret');
    expect(location()).toBe('/vidgenie?source=library');
  });

  it('uses Studio as the standalone desktop fallback', async () => {
    scenario.standalone = true;
    scenario.user = { _id: 'user-1' };
    scenario.resolvePostAuthDestination.mockResolvedValue(null);
    await mount('/');
    expect(location()).toBe('/video');
    expect(screen.getByText('Page: studio landing')).toBeInTheDocument();
  });

  it('hydrates an existing token before opening its resolved project', async () => {
    scenario.authToken = 'existing-token';
    scenario.userInitiated = false;
    scenario.getUserAPI.mockImplementation(async () => {
      scenario.user = { _id: 'hydrated-user' };
      scenario.userInitiated = true;
      return scenario.user;
    });
    await mount('/');
    expect(location()).toBe('/vidgenie/default-project');
    expect(scenario.getUserAPI).toHaveBeenCalledOnce();
    expect(scenario.resolvePostAuthDestination).toHaveBeenCalledWith(expect.objectContaining({ user: scenario.user }));
  });

  it('returns an expired root token to login', async () => {
    scenario.authToken = 'expired-token';
    scenario.userInitiated = false;
    scenario.getUserAPI.mockImplementation(async () => { scenario.authToken = null; return null; });
    await mount('/');
    expect(location()).toBe('/login');
    expect(scenario.resolvePostAuthDestination).not.toHaveBeenCalled();
  });

  it('opens the external dashboard directly for a hydrated external account', async () => {
    scenario.authToken = 'external-token';
    scenario.user = { _id: 'external-user', isExternalUser: true };
    await mount('/');
    expect(location()).toBe('/external/studio');
    expect(screen.getByText('Page: external studio')).toBeInTheDocument();
  });
});

describe('login token handoff', () => {
  it('exchanges the single-use login token, persists the auth token, then consumes a hosted redirect', async () => {
    axios.get.mockResolvedValue({ data: { authToken: 'new-auth-token' } });
    scenario.getUserAPI.mockImplementation(async () => {
      scenario.user = { _id: 'signed-in' };
      return scenario.user;
    });
    await mount('/login?loginToken=handoff-token&redirect=%2Faccount%2Fsettings');
    expect(axios.get).toHaveBeenCalledWith(expect.stringMatching(/\/users\/verify_token$/), {
      params: { loginToken: 'handoff-token', _: expect.any(Number) },
      timeout: 30000, signal: expect.any(AbortSignal),
    });
    expect(scenario.persistAuthToken).toHaveBeenCalledWith('new-auth-token');
    expect(location()).toBe('/account/settings');
    expect(scenario.resolvePostAuthDestination).not.toHaveBeenCalled();
  });

  it('exchanges a one-use login token only once so a duplicate exchange cannot undo successful sign-in', async () => {
    axios.get.mockResolvedValueOnce({ data: { authToken: 'new-auth-token' } })
      .mockRejectedValue(new Error('Login token already consumed'));
    scenario.getUserAPI.mockImplementation(async () => {
      scenario.user = { _id: 'signed-in' };
      return scenario.user;
    });
    await mount('/login?loginToken=one-use-token&redirect=%2Faccount%2Fsettings');
    expect(location()).toBe('/account/settings');
    expect(scenario.resetUser).not.toHaveBeenCalled();
    expect(axios.get).toHaveBeenCalledOnce();
  });

  it('uses the default standalone workspace instead of a hosted redirect after token exchange', async () => {
    scenario.standalone = true;
    // User hydration is in progress so the login page remains mounted while
    // the one-time token is exchanged.
    scenario.userFetching = true;
    axios.get.mockResolvedValue({ data: { authToken: 'new-auth-token' } });
    scenario.getUserAPI.mockImplementation(async () => {
      scenario.user = { _id: 'signed-in' };
      scenario.userFetching = false;
      return scenario.user;
    });
    scenario.resolvePostAuthDestination.mockResolvedValue('/video/default-project');
    await mount('/login?loginToken=handoff-token&redirect=%2Faccount');
    expect(location()).toBe('/video/default-project');
    expect(scenario.resolvePostAuthDestination).toHaveBeenCalledWith(expect.objectContaining({ user: scenario.user }));
  });

  it.each([
    ['missing token', { data: {} }, false],
    ['rejected token', null, true],
  ])('returns to login for a %s and retains a safe redirect', async (_name, response, rejects) => {
    if (rejects) axios.get.mockRejectedValue(new Error('Invalid handoff'));
    else axios.get.mockResolvedValue(response);
    await mount('/login?loginToken=invalid&redirect=%2Faccount');
    expect(scenario.resetUser).toHaveBeenCalled();
    expect(location()).toBe('/login?redirect=%2Faccount');
    expect(scenario.persistAuthToken).not.toHaveBeenCalled();
  });

  it('clears the handoff when token exchange yields no authenticated user', async () => {
    axios.get.mockResolvedValue({ data: { authToken: 'unusable' } });
    await mount('/login?loginToken=valid-token');
    expect(scenario.persistAuthToken).toHaveBeenCalledWith('unusable');
    expect(scenario.resetUser).toHaveBeenCalled();
    expect(location()).toBe('/login');
  });

  it('does not exchange verification tokens on the account verification route', async () => {
    await mount('/verify?loginToken=email-verification-token');
    expect(axios.get).not.toHaveBeenCalled();
    expect(scenario.getUserAPI).toHaveBeenCalledOnce();
    expect(screen.getByText('Page: verify')).toBeInTheDocument();
  });

  it('rejects external redirect targets before returning from a failed exchange', async () => {
    await mount('/login?loginToken=invalid&redirect=https%3A%2F%2Fmalicious.example');
    expect(location()).toBe('/login');
    expect(scenario.resetUser).toHaveBeenCalled();
  });
});

describe('OAuth broadcast handoff', () => {
  it('ignores unrelated messages and closes its broadcast channel on unmount', async () => {
    const { unmount } = await mount('/login');
    const channel = activeChannel();
    expect(channel.name).toBe('oauth_channel');
    const userCalls = scenario.getUserAPI.mock.calls.length;
    await act(async () => { await channel.onmessage({ data: { type: 'unrelated' } }); });
    expect(scenario.getUserAPI).toHaveBeenCalledTimes(userCalls);
    unmount();
    expect(channel.close).toHaveBeenCalledOnce();
  });

  it('consumes a stored redirect after a legacy OAuth completion message', async () => {
    scenario.storedRedirect = '/account/profile';
    await mount('/login');
    scenario.user = { _id: 'oauth-user' };
    await act(async () => { await activeChannel().onmessage({ data: 'oauth_complete' }); });
    await settle();
    expect(location()).toBe('/account/profile');
  });

  it('creates a fresh signup project for a new OAuth user', async () => {
    scenario.mobile = true;
    await mount('/login');
    scenario.user = { _id: 'new-user' };
    scenario.resolvePostSignupDestination.mockResolvedValue('/vidgenie/signup-project');
    await act(async () => { await activeChannel().onmessage({ data: { type: 'oauth_complete', isNewUser: true } }); });
    await settle();
    expect(location()).toBe('/vidgenie/signup-project');
    expect(scenario.resolvePostSignupDestination).toHaveBeenCalledWith({
      isMobile: true,
      apiServer: import.meta.env.VITE_PROCESSOR_API,
    });
    expect(scenario.resolvePostAuthDestination).not.toHaveBeenCalled();
  });

  it('resolves the normal authenticated destination when OAuth has no stored redirect', async () => {
    await mount('/login?theme=watercolor&authToken=do-not-forward');
    scenario.user = { _id: 'oauth-user' };
    await act(async () => { await activeChannel().onmessage({ data: { type: 'oauth_complete' } }); });
    await settle();
    expect(location()).toBe('/vidgenie/default-project');
    expect(scenario.resolvePostAuthDestination).toHaveBeenCalledWith(expect.objectContaining({ search: '?theme=watercolor' }));
  });

  it('mounts normally in browsers without BroadcastChannel support', async () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    await mount('/login');
    expect(screen.getByText('Page: login')).toBeInTheDocument();
    expect(scenario.channels).toHaveLength(0);
  });
});

describe('page-specific lazy loading fallbacks', () => {
  it.each(['/vidgenie/a', '/vidgpt/a', '/videogpt/a', '/vidgemie/a'])('uses Vidgenie skeletons for %s', path => {
    render(getRouteLoadingFallback(path, false));
    expect(screen.getByText('Loading Vidgenie page')).toBeInTheDocument();
  });
  it.each([['/quick_video/a', 'quick'], ['/image/studio/a', 'image'], ['/iamge/studio/a', 'image'], ['/audio/studio', 'audio'], ['/account/settings', 'account'], ['/my_sessions', 'projects'], ['/login', 'auth']])('matches the destination layout at %s', (path, layout) => {
    const { container } = render(getRouteLoadingFallback(path, false));
    expect(container.querySelector('[data-loading-page]')).toHaveAttribute('data-loading-page', layout);
    expect(container.querySelector('.animate-spin')).toBeNull();
  });
  it('uses Vidgenie for mobile Studio projects and Quick Editor routes', () => {
    const view = render(getRouteLoadingFallback('/video/a', true));
    expect(screen.getByText('Loading Vidgenie page')).toBeInTheDocument();
    view.rerender(getRouteLoadingFallback('/quick_video/a', true));
    expect(screen.getByText('Loading Vidgenie page')).toBeInTheDocument();
    view.rerender(getRouteLoadingFallback('/video/share/token', true));
    expect(screen.queryByText('Loading Vidgenie page')).not.toBeInTheDocument();
  });
});
