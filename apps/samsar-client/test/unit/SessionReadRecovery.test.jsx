import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import axios from 'axios';
import { deduplicatedGet, boundedGet, READ_REQUEST_TIMEOUT_MS } from '../../src/utils/deduplicatedGet.mjs';
import useSessionDetailsPreload from '../../src/hooks/useSessionDetailsPreload.js';
import { consumeInitialSessionDetails } from '../../src/utils/sessionDetailsRequest.js';

const auth = vi.hoisted(() => ({ token: 'owner' }));
vi.mock('axios', () => ({ default: { get: vi.fn() } }));
vi.mock('../../src/utils/web.jsx', () => ({ getHeaders: () => auth.token ? { headers: { Authorization: auth.token } } : null }));
const headers = () => ({ headers: { Authorization: auth.token } });
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => { auth.token = 'owner'; axios.get.mockReset(); });
afterEach(() => { vi.useRealTimers(); });

it('expires and aborts a stalled shared read, then allows a fresh retry even if the old transport resolves late', async () => {
  vi.useFakeTimers();
  const old = deferred();
  const client = { get: vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce({ data: 'fresh' }) };
  const first = deduplicatedGet(client, '/session');
  expect(deduplicatedGet(client, '/session')).toBe(first);
  const failed = expect(first).rejects.toMatchObject({ code: 'ECONNABORTED' });
  await vi.advanceTimersByTimeAsync(READ_REQUEST_TIMEOUT_MS);
  await failed;
  expect(client.get.mock.calls[0][1].signal.aborted).toBe(true);
  expect((await deduplicatedGet(client, '/session')).data).toBe('fresh');
  old.resolve({ data: 'stale' });
  await old.promise;
  expect(client.get).toHaveBeenCalledTimes(2);
});

it('honors caller cancellation without canceling another consumer', async () => {
  const controller = new AbortController();
  const pending = deferred();
  const client = { get: vi.fn().mockReturnValue(pending.promise) };
  const shared = deduplicatedGet(client, '/session');
  const canceled = boundedGet(client, '/session', { signal: controller.signal });
  const rejected = expect(canceled).rejects.toMatchObject({ code: 'ERR_CANCELED' });
  controller.abort();
  await rejected;
  expect(client.get.mock.calls[0][1].signal.aborted).toBe(false);
  pending.resolve({ data: 'ready' });
  expect((await shared).data).toBe('ready');
});

it.each(['/vidgenie/project', '/video/project'])('starts %s before mounting the editor and hands off a result that already arrived without refetching', async pathname => {
  axios.get.mockResolvedValue({ data: { _id: 'project' } });
  const { result } = renderHook(() => useSessionDetailsPreload(pathname, '/api'));
  await act(async () => {});
  expect(axios.get).toHaveBeenCalledTimes(1);
  expect((await consumeInitialSessionDetails('/api', 'project', headers(), result.current)).data._id).toBe('project');
  expect(axios.get).toHaveBeenCalledTimes(1);
  expect(result.current.current).toBeNull();
  await consumeInitialSessionDetails('/api', 'project', headers(), result.current);
  expect(axios.get).toHaveBeenCalledTimes(2);
});

it('discards preload failures and never reuses a previous account or route response', async () => {
  axios.get.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ data: { _id: 'other' } });
  const { result, rerender } = renderHook(({ path }) => useSessionDetailsPreload(path, '/api'), { initialProps: { path: '/vidgenie/project' } });
  await act(async () => {});
  await expect(consumeInitialSessionDetails('/api', 'project', headers(), result.current)).rejects.toThrow('offline');
  expect(result.current.current).toBeNull();
  auth.token = 'other-owner';
  rerender({ path: '/video/other' });
  await act(async () => {});
  await consumeInitialSessionDetails('/api', 'other', headers(), result.current);
  expect(axios.get.mock.calls[1][1].headers.Authorization).toBe('other-owner');
  expect(axios.get).toHaveBeenCalledTimes(2);
});

it('does not prefetch anonymous, entry, or token-sharing routes', () => {
  auth.token = null;
  const { rerender } = renderHook(({ path }) => useSessionDetailsPreload(path, '/api'), { initialProps: { path: '/video/project' } });
  auth.token = 'owner';
  for (const path of ['/video', '/vidgenie', '/video/share/token', '/video/collab/token']) rerender({ path });
  expect(axios.get).not.toHaveBeenCalled();
});
