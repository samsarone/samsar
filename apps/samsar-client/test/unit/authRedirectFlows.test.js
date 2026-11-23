import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  standalone: false,
  headers: { headers: { Authorization: 'Bearer owner' } },
  cookies: true,
  post: vi.fn(),
  resolveEntry: vi.fn(),
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
import {
  buildGoogleLoginUrl, buildLoginPathForRedirect, consumeResolvedAuthRedirect,
  getCurrentAuthRedirect, getRedirectParam, getRoutePath,
  persistAuthRedirectForFlow, resolvePostAuthDestination, resolvePostSignupDestination,
  sanitizeAuthRedirect,
} from '../../src/utils/authRedirect.js';
import { hasInsufficientGenerationCredits } from '../../src/utils/defaultRoutes.js';

beforeEach(() => {
  vi.resetAllMocks();
  state.standalone = false;
  state.headers = { headers: { Authorization: 'Bearer owner' } };
  state.cookies = true;
  state.consumeRedirect.mockReturnValue(null);
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
  it('uses the default landing flow for a login from Create unless a return path was requested', () => {
    expect(getCurrentAuthRedirect({ pathname: '/create' })).toBeNull();
    expect(getCurrentAuthRedirect({ pathname: '/login', search: '?redirect=%2Fcreate' })).toBe('/create');
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

describe('new account routing', () => {
  it('opens Create after signup without allocating a project or resuming a public sample', () => {
    state.consumeRedirect.mockReturnValue('/vidgenie/public-sample');
    expect(resolvePostSignupDestination()).toBe('/create');
    expect(state.consumeRedirect).toHaveBeenCalledOnce();
    expect(state.post).not.toHaveBeenCalled();
    expect(state.resolveEntry).not.toHaveBeenCalled();
    expect(localStorage.getItem('videoSessionId')).toBeNull();
  });
});

describe('existing account routing', () => {
  it('returns explicit local destinations with their query and fragment intact', async () => {
    const redirect = '/video/existing?tab=images#timeline';
    await expect(resolvePostAuthDestination({ redirect, apiServer: '/api' })).resolves.toBe(redirect);
    expect(state.resolveEntry).not.toHaveBeenCalled();
  });

  it('includes search parameters in the unauthenticated fallback', async () => {
    state.headers = undefined;
    await expect(resolvePostAuthDestination({ search: 'tab=images' })).resolves.toBe('/create?tab=images');
    expect(state.resolveEntry).not.toHaveBeenCalled();
  });

  it.each([false, true])('uses the authenticated render resolver, including on standalone (standalone=%s)', async (standalone) => {
    state.standalone = standalone;
    state.resolveEntry.mockResolvedValue('/vidgenie/pending?view=preview');
    const user = { _id: 'owner' };
    await expect(resolvePostAuthDestination({ user, apiServer: '/api', search: '?tab=audio' })).resolves.toBe('/vidgenie/pending?view=preview');
    expect(state.resolveEntry).toHaveBeenCalledWith({ user, apiServer: '/api', headers: state.headers, search: standalone ? '' : '?tab=audio' });
  });

  it('resolves the pending destination with the external account identity', async () => {
    const user = { _id: 'external', isExternalUser: true };
    state.resolveEntry.mockResolvedValue('/external/studio?request=external-render');
    await expect(resolvePostAuthDestination({ user, apiServer: '/api' })).resolves.toBe('/external/studio?request=external-render');
    expect(state.resolveEntry).toHaveBeenCalledWith({ user, apiServer: '/api', headers: state.headers, search: '' });
  });

  it('falls back to Create if no pending destination is available', async () => {
    state.resolveEntry.mockResolvedValue(null);
    await expect(resolvePostAuthDestination({ search: '?tab=audio' })).resolves.toBe('/create?tab=audio');
    state.resolveEntry.mockRejectedValue(new Error('offline'));
    await expect(resolvePostAuthDestination({ user: { isExternalUser: true } })).resolves.toBe('/create');
  });

  it('keeps standalone sign-in local to the configured app entry', async () => {
    state.standalone = true;
    await expect(resolvePostAuthDestination({ user: {}, apiServer: '/api', redirect: '/video/public', search: '?public=1' })).resolves.toBe('/create');
    expect(state.resolveEntry).toHaveBeenCalledWith(expect.objectContaining({ search: '' }));
  });

  it.each([false, true])('returns to an explicitly requested Create page (standalone=%s)', async (standalone) => {
    state.standalone = standalone;
    await expect(resolvePostAuthDestination({ user: { _id: 'user' }, apiServer: '/api', redirect: '/create' })).resolves.toBe('/create');
    expect(state.resolveEntry).not.toHaveBeenCalled();
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
});
