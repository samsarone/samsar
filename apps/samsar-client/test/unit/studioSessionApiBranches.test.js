import { describe, expect, it, vi } from 'vitest';
import {
  createStudioSession, ensureInitialLayerForNewStudioSession, fetchStudioSessionDetails,
} from '../../src/utils/studioSessionApi.js';

const headers = { headers: { Authorization: 'Bearer test-owner' } };
const withFirstLayer = { _id: 'project', layers: [{ _id: 'first' }] };
const options = (httpClient, extra = {}) => ({ processorServer: '/api', headers, httpClient, ...extra });

describe('Studio initial-scene lifecycle', () => {
  it('does not create or fetch a second scene when the response already has one', async () => {
    const client = { post: vi.fn(), get: vi.fn() };
    await expect(ensureInitialLayerForNewStudioSession(options(client, { session: withFirstLayer }))).resolves.toBe(withFirstLayer);
    expect(client.post).not.toHaveBeenCalled();
    expect(client.get).not.toHaveBeenCalled();
  });

  it.each([
    [4, 8, 4], ['5', 8, 5], [null, 7, 7], [undefined, '9', 9],
    [0, 8, 2], [-1, 8, 2], [Infinity, 8, 2], ['invalid', 8, 2],
    [undefined, undefined, 2],
  ])('uses a valid scene duration or a two-second fallback (session=%s,payload=%s)', async (duration, payloadDuration, expected) => {
    const client = { post: vi.fn().mockResolvedValue({ data: { session: withFirstLayer } }), get: vi.fn() };
    await expect(ensureInitialLayerForNewStudioSession(options(client, {
      session: { _id: 'project', layers: [], defaultSceneDuration: duration }, payload: { prompts: [], durationPerScene: payloadDuration },
    }))).resolves.toBe(withFirstLayer);
    expect(client.post).toHaveBeenCalledExactlyOnceWith('/api/video_sessions/add_layer', { sessionId: 'project', duration: expected, position: 'end' }, headers);
    expect(client.get).not.toHaveBeenCalled();
  });

  it('uses an explicitly requested session id when fetching partial session details', async () => {
    const client = { post: vi.fn(), get: vi.fn().mockResolvedValue({ data: withFirstLayer }) };
    await expect(ensureInitialLayerForNewStudioSession(options(client, { sessionId: 'project' }))).resolves.toBe(withFirstLayer);
    expect(client.get).toHaveBeenCalledExactlyOnceWith('/api/video_sessions/session_details', { timeout: 30000, signal: expect.any(AbortSignal), ...headers, params: { id: 'project', cacheBust: expect.any(Number) } });
    expect(client.post).not.toHaveBeenCalled();
  });

  it('uses the persisted scene duration when a partial create response needs repair', async () => {
    const client = {
      get: vi.fn().mockResolvedValue({ data: { _id: 'project', layers: [], defaultSceneDuration: 11 } }),
      post: vi.fn().mockResolvedValue({ data: { session: withFirstLayer } }),
    };
    await ensureInitialLayerForNewStudioSession(options(client, { sessionId: 'project', payload: { prompts: [], durationPerScene: 5 } }));
    expect(client.post).toHaveBeenCalledWith('/api/video_sessions/add_layer', { sessionId: 'project', duration: 11, position: 'end' }, headers);
  });

  it.each([{}, { _id: 'project' }, { _id: 'project', layers: null }, { _id: 'project', layers: {} }])('rejects persisted details that cannot establish scene ownership', async (data) => {
    const client = { get: vi.fn().mockResolvedValue({ data }), post: vi.fn() };
    await expect(ensureInitialLayerForNewStudioSession(options(client, { sessionId: 'project' }))).rejects.toThrow('did not include a layers array');
    expect(client.post).not.toHaveBeenCalled();
  });

  it.each([{}, { session: null }, { session: { _id: 'project', layers: [] } }])('does not route to a repaired project without a confirmed first scene', async (data) => {
    const client = { post: vi.fn().mockResolvedValue({ data }) };
    await expect(ensureInitialLayerForNewStudioSession(options(client, { session: { _id: 'project', layers: [] } }))).rejects.toThrow('did not include its initial layer');
  });

  it('rejects a missing session id before making a network request', async () => {
    const client = { get: vi.fn(), post: vi.fn() };
    await expect(ensureInitialLayerForNewStudioSession(options(client))).rejects.toThrow('did not include an id');
    expect(client.get).not.toHaveBeenCalled();
    expect(client.post).not.toHaveBeenCalled();
  });

  it('propagates an initial-scene failure without retrying a project creation', async () => {
    const failure = new Error('scene unavailable');
    const client = { post: vi.fn().mockRejectedValue(failure) };
    await expect(ensureInitialLayerForNewStudioSession(options(client, { session: { _id: 'project', layers: [] } }))).rejects.toBe(failure);
    expect(client.post).toHaveBeenCalledOnce();
  });

  it('propagates a persisted-details failure without creating a speculative scene', async () => {
    const failure = new Error('details unavailable');
    const client = { get: vi.fn().mockRejectedValue(failure), post: vi.fn() };
    await expect(ensureInitialLayerForNewStudioSession(options(client, { sessionId: 'project' }))).rejects.toBe(failure);
    expect(client.post).not.toHaveBeenCalled();
  });

  it('creates the default empty project and reuses its atomically-created scene', async () => {
    const client = { post: vi.fn().mockResolvedValue({ data: withFirstLayer }), get: vi.fn() };
    await expect(createStudioSession(options(client))).resolves.toBe(withFirstLayer);
    expect(client.post).toHaveBeenCalledExactlyOnceWith('/api/video_sessions/create_video_session', { prompts: [] }, headers);
    expect(client.get).not.toHaveBeenCalled();
  });

  it('preserves custom creation payload and server failure identity', async () => {
    const failure = new Error('quota exceeded');
    const client = { post: vi.fn().mockRejectedValue(failure) };
    const payload = { prompts: ['a scene'], durationPerScene: 4 };
    await expect(createStudioSession(options(client, { payload }))).rejects.toBe(failure);
    expect(client.post).toHaveBeenCalledWith('/api/video_sessions/create_video_session', payload, headers);
  });
});

describe('Studio session detail fetches', () => {
  it.each([{ processorServer: '', sessionId: 'project' }, { processorServer: '/api', sessionId: '' }, {}])('does not request incomplete session details', async (params) => {
    const client = { get: vi.fn() };
    await expect(fetchStudioSessionDetails({ ...params, httpClient: client })).resolves.toBeNull();
    expect(client.get).not.toHaveBeenCalled();
  });
  it('passes authorization and a clock-based cache-buster to detail requests', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(123456);
    const client = { get: vi.fn().mockResolvedValue({ data: withFirstLayer }) };
    await expect(fetchStudioSessionDetails(options(client, { sessionId: 'project' }))).resolves.toBe(withFirstLayer);
    expect(client.get).toHaveBeenCalledWith('/api/video_sessions/session_details', { timeout: 30000, signal: expect.any(AbortSignal), ...headers, params: { id: 'project', cacheBust: 123456 } });
  });
  it('returns null for an empty response without requiring request headers', async () => {
    const client = { get: vi.fn().mockResolvedValue({ data: null }) };
    await expect(fetchStudioSessionDetails({ processorServer: '/api', sessionId: 'project', httpClient: client })).resolves.toBeNull();
    expect(client.get).toHaveBeenCalledWith('/api/video_sessions/session_details', { timeout: 30000, signal: expect.any(AbortSignal), params: { id: 'project', cacheBust: expect.any(Number) } });
  });
});
