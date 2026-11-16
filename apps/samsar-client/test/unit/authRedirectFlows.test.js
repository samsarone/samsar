import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  standalone: false,
  headers: { headers: { Authorization: 'Bearer owner' } },
  storedRedirect: null,
  cookies: true,
  post: vi.fn(),
  resolveEntry: vi.fn(),
  createStudio: vi.fn(),
  ensureLayer: vi.fn(),
  fetchConfig: vi.fn(),
  extractAvailability: vi.fn(),
  extractInference: vi.fn(),
  hasPipeline: vi.fn(),
  initialPath: vi.fn(),
  setRedirect: vi.fn(),
  consumeRedirect: vi.fn(),
}));

vi.mock('axios', () => ({ default: { post: state.post } }));
vi.mock('../../src/utils/environment.jsx', () => ({ get IS_STANDALONE_DEPLOYMENT() { return state.standalone; } }));
vi.mock('../../src/utils/web.jsx', () => ({
  getHeaders: () => state.headers,
  hasAcceptedCookies: () => state.cookies,
  setPostAuthRedirect: state.setRedirect,
  consumePostAuthRedirect: state.consumeRedirect,
}));
vi.mock('../../src/utils/vidgenieRouting.js', () => ({
  appendRouteSearch: (path, search = '') => search ? `${path}${search.startsWith('?') ? search : `?${search}`}` : path,
  resolveAuthenticatedEntryPath: state.resolveEntry,
}));
vi.mock('../../src/utils/studioSessionApi.js', () => ({
  createStudioSession: state.createStudio,
  ensureInitialLayerForNewStudioSession: state.ensureLayer,
}));
vi.mock('../../src/utils/deploymentProviders.js', () => ({
  fetchDeploymentProviderConfig: state.fetchConfig,
  extractDeploymentModelAvailability: state.extractAvailability,
  extractDeploymentInferenceModelValues: state.extractInference,
}));
vi.mock('../../src/utils/standaloneInitialRoute.mjs', () => ({
  hasConfiguredStandaloneTextToVideoPipeline: state.hasPipeline,
  getStandaloneInitialEditorPath: state.initialPath,
}));

import {
  buildGoogleLoginUrl, buildLoginPathForRedirect, consumeResolvedAuthRedirect,
  getCurrentAuthRedirect, getRedirectParam, getRoutePath,
  persistAuthRedirectForFlow, resolvePostAuthDestination, resolvePostSignupDestination,
  sanitizeAuthRedirect,
} from '../../src/utils/authRedirect.js';
import { getDefaultAuthenticatedPath, hasInsufficientGenerationCredits } from '../../src/utils/defaultRoutes.js';

beforeEach(() => {
  vi.resetAllMocks();
  state.standalone = false;
  state.headers = { headers: { Authorization: 'Bearer owner' } };
  state.cookies = true;
  state.consumeRedirect.mockReturnValue(null);
  state.ensureLayer.mockResolvedValue({ _id: 'created', layers: [{ _id: 'first' }] });
  state.extractAvailability.mockReturnValue({ textToVideoImageModelValues: ['image'], textToVideoVideoModelValues: ['video'] });
  state.extractInference.mockReturnValue(['inference']);
  state.fetchConfig.mockResolvedValue({ deployment: 'configured' });
  state.hasPipeline.mockReturnValue(true);
  state.initialPath.mockReturnValue('/vidgenie');
});

describe('authentication redirect input', () => {
  it.each([undefined, null, 7, {}, '', '  ', 'https://evil.test/a', '//evil.test', 'javascript:alert(1)', 'video/a'])(
    'rejects non-local route input %s', (input) => expect(sanitizeAuthRedirect(input)).toBeNull(),
  );
  it.each(['/video/a', '/vidgenie/a?tab=images', '/library#images', ' /video/a '])('preserves safe local destination %s', (input) => {
    expect(sanitizeAuthRedirect(input)).toBe(input.trim());
  });
  it.each(['/\\evil.example', '/\n/evil.example', '/\t/evil.example'])(
    'rejects local-looking redirects that the browser normalizes to an external origin', (input) => {
      // The WHATWG URL parser canonicalizes these values to https://evil.example/.
      expect(new URL(input, 'https://app.samsar.gg').origin).toBe('https://evil.example');
      expect(sanitizeAuthRedirect(input)).toBeNull();
    },
  );
  it('retains the query in the current route and tolerates a missing location', () => {
    expect(getRoutePath({ pathname: '/video/project', search: '?tab=audio' })).toBe('/video/project?tab=audio');
    expect(getRoutePath()).toBe('/');
    expect(getRoutePath({ pathname: '/library' })).toBe('/library');
  });
  it('decodes a valid redirect query and rejects a remote one', () => {
    expect(getRedirectParam({ search: '?redirect=%2Fvideo%2Fa%3Fx%3D1' })).toBe('/video/a?x=1');
    expect(getRedirectParam({ search: '?redirect=https%3A%2F%2Fevil.test' })).toBeNull();
    expect(getRedirectParam()).toBeNull();
  });
  it('prefers explicit destination, then query, then the protected route', () => {
    const location = { pathname: '/video/current', search: '?redirect=%2Flibrary' };
    expect(getCurrentAuthRedirect(location, '/video/explicit')).toBe('/video/explicit');
    expect(getCurrentAuthRedirect(location, 'https://evil.test')).toBe('/library');
    expect(getCurrentAuthRedirect({ pathname: '/video/current', search: '?tab=audio' })).toBe('/video/current?tab=audio');
  });
  it.each(['/', '/login', '/register', '/forgot_password', '/reset_password', '/verify', '/verify_email'])(
    'does not resume the authentication screen %s', (pathname) => expect(getCurrentAuthRedirect({ pathname })).toBeNull(),
  );
  it('handles missing location and percent-encodes a login destination once', () => {
    expect(getCurrentAuthRedirect()).toBeNull();
    expect(buildLoginPathForRedirect('/video/a?title=A & B')).toBe('/login?redirect=%2Fvideo%2Fa%3Ftitle%3DA%20%26%20B');
    expect(buildLoginPathForRedirect('//evil.test')).toBe('/login');
  });
  it.each(['/vidgenie/a', '/vidgpt/a', '/videogpt/a', '/quick_video/a'])('remembers the quick-video media flow for %s', (path) => {
    expect(persistAuthRedirectForFlow(path)).toBe(path);
    expect(state.setRedirect).toHaveBeenCalledWith(path);
    expect(localStorage.getItem('currentMediaFlowPath')).toBe('quick_video');
  });
  it('uses the Studio media flow on desktop and quick-video on mobile', () => {
    persistAuthRedirectForFlow('/video/a');
    expect(localStorage.getItem('currentMediaFlowPath')).toBe('video');
    persistAuthRedirectForFlow(null, { isMobile: true });
    expect(localStorage.getItem('currentMediaFlowPath')).toBe('quick_video');
    expect(state.setRedirect).toHaveBeenCalledTimes(1);
  });
  it('does not block sign-in when flow storage is denied', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    expect(persistAuthRedirectForFlow('/video/a')).toBe('/video/a');
  });
  it.each([true, false])('encodes cookie consent and optional newsletter choice in the Google handoff', (consent) => {
    state.cookies = consent;
    const url = new URL(buildGoogleLoginUrl({ processorServer: 'https://api.test', redirect: '/video/a?b=1', subscribeToWeeklyNewsletter: false }));
    expect(url.origin + url.pathname).toBe('https://api.test/users/google_login');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      origin: window.location.origin, cookieConsent: consent ? 'accepted' : 'rejected',
      responseMode: 'redirect', subscribeToWeeklyNewsletter: 'false', redirect: '/video/a?b=1',
    });
  });
  it('omits invalid redirect and unselected optional consent from a Google handoff', () => {
    const url = new URL(buildGoogleLoginUrl({ processorServer: 'https://api.test', redirect: '//evil.test' }));
    expect(url.searchParams.has('redirect')).toBe(false);
    expect(url.searchParams.has('subscribeToWeeklyNewsletter')).toBe(false);
  });
  it('consumes the saved redirect even when an explicit fallback takes priority', () => {
    state.consumeRedirect.mockReturnValue('/video/saved');
    expect(consumeResolvedAuthRedirect('/library')).toBe('/library');
    expect(state.consumeRedirect).toHaveBeenCalledOnce();
    expect(consumeResolvedAuthRedirect('https://evil.test')).toBe('/video/saved');
    state.consumeRedirect.mockReturnValue('//evil.test');
    expect(consumeResolvedAuthRedirect()).toBeNull();
  });
});

describe('new account project routing', () => {
  it.each([false, true])('creates an independent project for a signup (mobile=%s)', async (isMobile) => {
    state.consumeRedirect.mockReturnValue('/vidgenie/public-sample');
    state.post.mockResolvedValue({ data: { sessionId: '  new-project  ' } });
    await expect(resolvePostSignupDestination({ apiServer: '/api', isMobile })).resolves.toBe(isMobile ? '/vidgenie/new-project' : '/video/new-project');
    expect(state.post).toHaveBeenCalledWith('/api/video_sessions/create_signup_project', { editor: isMobile ? 'vidgenie' : 'studio' }, state.headers);
    expect(state.consumeRedirect).toHaveBeenCalledOnce();
    expect(localStorage.getItem('videoSessionId')).toBe('new-project');
    expect(state.ensureLayer).toHaveBeenCalledTimes(isMobile ? 0 : 1);
  });
  it.each(['session_id', '_id', 'id'])('supports signup response id alias %s', async (key) => {
    state.post.mockResolvedValue({ data: { [key]: 'project' } });
    await expect(resolvePostSignupDestination({ apiServer: '/api', isMobile: true })).resolves.toBe('/vidgenie/project');
  });
  it('accepts a database id with a meaningful string representation', async () => {
    state.post.mockResolvedValue({ data: { id: { toString: () => 'db-project' } } });
    await expect(resolvePostSignupDestination({ apiServer: '/api', isMobile: true })).resolves.toBe('/vidgenie/db-project');
  });
  it.each([{}, { id: {} }, { id: ' ' }, { id: { toString: () => '' } }])('rejects a signup without a usable project id', async (data) => {
    state.post.mockResolvedValue({ data });
    await expect(resolvePostSignupDestination({ apiServer: '/api' })).rejects.toThrow('did not include a session id');
    expect(state.ensureLayer).not.toHaveBeenCalled();
    expect(localStorage.getItem('videoSessionId')).toBeNull();
  });
  it('returns the editor fallback without making unauthenticated requests', async () => {
    state.headers = undefined;
    await expect(resolvePostSignupDestination({ apiServer: '/api' })).resolves.toBe('/video');
    await expect(resolvePostSignupDestination({ apiServer: '/api', isMobile: true })).resolves.toBe('/vidgenie');
    expect(state.post).not.toHaveBeenCalled();
  });
  it('does not issue a signup request without an API server', async () => {
    await expect(resolvePostSignupDestination()).resolves.toBe('/video');
    expect(state.post).not.toHaveBeenCalled();
  });
  it.each([404, 405])('uses the legacy mobile creation endpoint for unsupported signup API (%s)', async (status) => {
    state.post.mockRejectedValueOnce({ response: { status } }).mockResolvedValueOnce({ data: { id: 'legacy' } });
    await expect(resolvePostSignupDestination({ apiServer: '/api', isMobile: true })).resolves.toBe('/vidgenie/legacy');
    expect(state.post).toHaveBeenNthCalledWith(2, '/api/vidgenie/create_blank', {}, state.headers);
  });
  it('creates a legacy Studio session and ensures its first scene', async () => {
    state.post.mockRejectedValue({ response: { status: 404 } });
    state.createStudio.mockResolvedValue({ _id: 'legacy-studio' });
    await expect(resolvePostSignupDestination({ apiServer: '/api' })).resolves.toBe('/video/legacy-studio');
    expect(state.createStudio).toHaveBeenCalledWith({ processorServer: '/api', headers: state.headers, payload: { prompts: [] } });
    expect(state.ensureLayer).toHaveBeenCalledWith({ processorServer: '/api', headers: state.headers, sessionId: 'legacy-studio', payload: { prompts: [] } });
  });
  it.each([401, 403, 429, 500])('preserves unexpected signup errors instead of creating a second project (%s)', async (status) => {
    const error = { response: { status } };
    state.post.mockRejectedValue(error);
    await expect(resolvePostSignupDestination({ apiServer: '/api' })).rejects.toBe(error);
    expect(state.createStudio).not.toHaveBeenCalled();
    expect(state.post).toHaveBeenCalledOnce();
  });
  it('does not publish a Studio destination until the first scene is ready', async () => {
    state.post.mockResolvedValue({ data: { id: 'project' } });
    state.ensureLayer.mockRejectedValue(new Error('scene missing'));
    await expect(resolvePostSignupDestination({ apiServer: '/api' })).rejects.toThrow('scene missing');
    expect(localStorage.getItem('videoSessionId')).toBeNull();
  });
  it('routes successfully after creation if local storage is unavailable', async () => {
    state.post.mockResolvedValue({ data: { id: 'project' } });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    await expect(resolvePostSignupDestination({ apiServer: '/api' })).resolves.toBe('/video/project');
  });
});

describe('existing account routing', () => {
  it('resumes an explicit local destination without creating another project', async () => {
    await expect(resolvePostAuthDestination({ redirect: '/video/existing', apiServer: '/api' })).resolves.toBe('/video/existing');
    expect(state.resolveEntry).not.toHaveBeenCalled();
  });
  it('includes search parameters in the unauthenticated fallback', async () => {
    state.headers = undefined;
    await expect(resolvePostAuthDestination({ search: 'tab=images' })).resolves.toBe('/vidgenie?tab=images');
    expect(state.resolveEntry).not.toHaveBeenCalled();
  });
  it('passes routing policy to the entry resolver', async () => {
    state.resolveEntry.mockResolvedValue('/vidgenie/existing');
    const user = { _id: 'owner' };
    await expect(resolvePostAuthDestination({ user, isMobile: true, apiServer: '/api', search: '?tab=audio', createIfMissing: false })).resolves.toBe('/vidgenie/existing');
    expect(state.resolveEntry).toHaveBeenCalledWith({ user, isMobile: true, apiServer: '/api', headers: state.headers, search: '?tab=audio', createIfMissing: false, defaultPath: '/vidgenie' });
  });
  it.each([null, undefined, ''])('falls back when entry resolution produces no route (%s)', async (value) => {
    state.resolveEntry.mockResolvedValue(value);
    await expect(resolvePostAuthDestination({ search: '?tab=audio' })).resolves.toBe('/vidgenie?tab=audio');
  });
  it('falls back when entry lookup fails and respects external accounts', async () => {
    state.resolveEntry.mockRejectedValue(new Error('offline'));
    await expect(resolvePostAuthDestination({ user: { isExternalUser: true }, search: '?a=b' })).resolves.toBe('/external/studio?a=b');
  });
  it('uses deployment capabilities for standalone desktop and discards public redirects', async () => {
    state.standalone = true;
    state.resolveEntry.mockResolvedValue(null);
    await expect(resolvePostAuthDestination({ user: {}, apiServer: '/api', redirect: '/video/public', search: '?public=1' })).resolves.toBe('/vidgenie');
    expect(state.fetchConfig).toHaveBeenCalledWith('/api', state.headers);
    expect(state.hasPipeline).toHaveBeenCalledWith({ inferenceModelValues: ['inference'], textToVideoImageModelValues: ['image'], textToVideoVideoModelValues: ['video'] });
    expect(state.initialPath).toHaveBeenCalledWith({ isStandaloneDeployment: true, hasTextToVideoPipeline: true });
    expect(state.resolveEntry).toHaveBeenCalledWith(expect.objectContaining({ search: '', defaultPath: '/vidgenie' }));
  });

  it.each([false, true])('returns to the simple create page after signing in (standalone=%s)', async standalone => {
    state.standalone = standalone;
    await expect(resolvePostAuthDestination({ user: { _id: 'user' }, apiServer: '/api', redirect: '/create' })).resolves.toBe('/create');
    expect(state.resolveEntry).not.toHaveBeenCalled();
    expect(state.fetchConfig).not.toHaveBeenCalled();
  });
  it('fails closed to Studio if standalone capability discovery fails', async () => {
    state.standalone = true;
    state.fetchConfig.mockRejectedValue(new Error('offline'));
    await expect(resolvePostAuthDestination({ apiServer: '/api' })).resolves.toBe('/video');
  });
  it.each([{ isMobile: true }, { user: { isExternalUser: true } }, { apiServer: undefined }])('does not discover standalone capabilities outside the desktop owner flow', async (overrides) => {
    state.standalone = true;
    await resolvePostAuthDestination({ apiServer: '/api', ...overrides });
    expect(state.fetchConfig).not.toHaveBeenCalled();
  });
});

describe('authenticated route and credit policy', () => {
  it.each([
    [undefined, false], [null, false], [{ isExternalUser: true }, false],
    [{}, true], [{ generationCredits: 99 }, true], [{ generationCredits: 100 }, false],
    [{ generationCredits: '101' }, false], [{ generationCredits: -1 }, true],
  ])('evaluates the generation credit threshold for %j', (user, insufficient) => {
    expect(hasInsufficientGenerationCredits(user)).toBe(insufficient);
  });
  it('supports an operation-specific credit threshold', () => {
    expect(hasInsufficientGenerationCredits({ generationCredits: 20 }, 21)).toBe(true);
    expect(hasInsufficientGenerationCredits({ generationCredits: 20 }, 20)).toBe(false);
  });
  it('routes external users to their dashboard on every device and deployment', () => {
    for (const standalone of [false, true]) {
      state.standalone = standalone;
      for (const isMobile of [false, true]) expect(getDefaultAuthenticatedPath({ isExternalUser: true }, { isMobile })).toBe('/external/studio');
    }
  });
  it('selects Studio for standalone desktop and Vidgenie for mobile or hosted users', () => {
    expect(getDefaultAuthenticatedPath({})).toBe('/vidgenie');
    state.standalone = true;
    expect(getDefaultAuthenticatedPath({})).toBe('/video');
    expect(getDefaultAuthenticatedPath({}, { isMobile: true })).toBe('/vidgenie');
  });
});
