import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import axios from 'axios';
import { getAuthToken, clearAuthData } from '../../src/utils/web.jsx';
import { UserProvider, useUser } from '../../src/contexts/UserContext.jsx';

vi.mock('axios', () => ({ default: { get: vi.fn() } }));
vi.mock('../../src/utils/web.jsx', () => ({
  getAuthToken: vi.fn(),
  getHeaders: vi.fn(() => ({ headers: { Authorization: 'Bearer test-token' } })),
  clearAuthData: vi.fn(),
}));
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
beforeEach(() => {
  vi.resetAllMocks();
  getAuthToken.mockReturnValue('test-token');
  window.history.replaceState(null, '', '/');
});

it('settles signed-out bootstrap without requesting a profile', async () => {
  getAuthToken.mockReturnValue(null);
  const { result } = renderHook(useUser, { wrapper: UserProvider });
  expect(result.current.userInitiated).toBe(true);
  expect(result.current.userFetching).toBe(false);
  await act(async () => { await result.current.getUserAPI(); });
  expect(axios.get).not.toHaveBeenCalled();
});

it('keeps login-token bootstrap pending until authentication resolves', () => {
  getAuthToken.mockReturnValue(null);
  window.history.replaceState(null, '', '/?loginToken=handoff');
  const { result } = renderHook(useUser, { wrapper: UserProvider });
  expect(result.current.userFetching).toBe(true);
  expect(result.current.userInitiated).toBe(false);
});

it('loads the authenticated profile and finishes bootstrap', async () => {
  axios.get.mockResolvedValue({ data: { _id: 'user-a' } });
  const { result } = renderHook(useUser, { wrapper: UserProvider });
  await act(async () => { await result.current.getUserAPI(); });
  expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('/users/verify_token'),
    expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } }));
  expect(result.current.user).toEqual({ _id: 'user-a' });
  expect(result.current.userFetching).toBe(false);
  expect(result.current.userInitiated).toBe(true);
});

it.each([400, 401, 403])('clears invalid authentication on HTTP %s', async (status) => {
  axios.get.mockRejectedValue({ response: { status } });
  const { result } = renderHook(useUser, { wrapper: UserProvider });
  await act(async () => { await result.current.getUserAPI(); });
  expect(clearAuthData).toHaveBeenCalledOnce();
  expect(result.current.user).toBeNull();
  expect(result.current.userFetching).toBe(false);
});

it('preserves stored authentication after a transient server failure', async () => {
  axios.get.mockRejectedValue({ response: { status: 503 } });
  const { result } = renderHook(useUser, { wrapper: UserProvider });
  await act(async () => { await result.current.getUserAPI(); });
  expect(clearAuthData).not.toHaveBeenCalled();
  expect(result.current.userFetching).toBe(false);
});

it('does not restore a user from an outstanding request after logout', async () => {
  const pending = deferred();
  axios.get.mockReturnValue(pending.promise);
  const { result } = renderHook(useUser, { wrapper: UserProvider });
  let request;
  act(() => { request = result.current.getUserAPI(); });
  act(() => result.current.resetUser());
  await act(async () => { pending.resolve({ data: { _id: 'old-user' } }); await request; });
  expect(result.current.user).toBeNull();
  expect(result.current.userFetching).toBe(false);
  expect(clearAuthData).toHaveBeenCalledOnce();
});

it('ignores an older profile response that arrives after a newer one', async () => {
  const older = deferred();
  axios.get.mockReturnValueOnce(older.promise).mockResolvedValueOnce({ data: { _id: 'new-user' } });
  const { result } = renderHook(useUser, { wrapper: UserProvider });
  let first;
  act(() => { first = result.current.getUserAPI(); });
  await act(async () => { await result.current.getUserAPI(); });
  await act(async () => { older.resolve({ data: { _id: 'old-user' } }); await first; });
  expect(result.current.user).toEqual({ _id: 'new-user' });
});
