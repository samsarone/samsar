import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import axios from 'axios';
import { useAssistantRequestGuard } from '../../src/hooks/useAssistantRequestGuard.js';
import { readAssistantSSE } from '../../src/utils/assistantSSE.js';

vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const pending = { sessionId: 'session', assistantSessionVersion: 0, sessionMessages: [],
  sessionMessageGenerationPending: true, assistantStream: { queryId: 'q', sequence: 1, status: 'queued' } };
const completed = { ...pending, sessionMessageGenerationPending: false,
  sessionMessages: [{ id: 'q', role: 'assistant', content: 'Recovered reply' }],
  assistantStream: { queryId: 'q', status: 'completed' } };
const tick = ms => act(() => vi.advanceTimersByTimeAsync(ms));
const watchOptions = onSnapshot => ({ url: '/stream', statusUrl: '/status', headers: { Authorization: 'fixture' }, onSnapshot });
const httpFailure = (status, data) => Object.assign(new Error(`Request failed with status code ${status}`), {
  response: { status, data },
});

function heartbeatStream(onOpen) {
  let heartbeat, rotation;
  return new Response(new ReadableStream({
    start(controller) {
      onOpen(controller);
      const send = text => controller.enqueue(new TextEncoder().encode(text));
      heartbeat = setInterval(() => send(': heartbeat\n\n'), 10000);
      rotation = setTimeout(() => send('event: reconnect\ndata: {}\n\n'), 30000);
    },
    cancel() { clearInterval(heartbeat); clearTimeout(rotation); },
  }), { headers: { 'content-type': 'text/event-stream' } });
}

beforeEach(() => {
  vi.useFakeTimers();
  axios.get.mockReset(); axios.post.mockReset();
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
});

it('cancels a blocked SSE read when the conversation is cleared', async () => {
  const cancel = vi.fn();
  const controller = new AbortController();
  const promise = readAssistantSSE(new Response(new ReadableStream({ cancel }), {
    headers: { 'content-type': 'text/event-stream' },
  }), vi.fn(), controller.signal);
  controller.abort();
  await tick(0);
  expect(cancel).toHaveBeenCalledTimes(1);
  await promise;
});

it('releases a stream on its terminal event even when the proxy leaves the body open', async () => {
  const cancel = vi.fn();
  const body = new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode('event: settled\ndata: {}\n\n'));
  }, cancel });
  const read = readAssistantSSE(new Response(body, { headers: { 'content-type': 'text/event-stream' } }), vi.fn());
  await tick(0);
  expect(cancel).toHaveBeenCalledTimes(1);
  await read;
});

it('keeps one status request in flight and recovers a hanging poll with a bounded timeout', async () => {
  axios.get.mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue({ data: { status: 'COMPLETED', sessionDetails: completed } });
  const { result } = renderHook(() => useAssistantRequestGuard('session'));
  const onSnapshot = vi.fn();
  act(() => result.current.watch(watchOptions(onSnapshot)));
  await tick(9000);
  expect(axios.get).toHaveBeenCalledTimes(1);
  await tick(2000);
  expect(axios.get).toHaveBeenCalledTimes(2);
  expect(onSnapshot).toHaveBeenCalledWith(expect.objectContaining({ sessionMessages: completed.sessionMessages }));
  expect(axios.get.mock.calls[0][1].signal.aborted).toBe(true);
  await tick(30000);
  expect(axios.get).toHaveBeenCalledTimes(2);
});

it('retries an uncertain submission with the original identity and payload', async () => {
  axios.post.mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue({ data: { status: 'PENDING' } });
  const { result } = renderHook(() => useAssistantRequestGuard('session'));
  const onResponse = vi.fn();
  act(() => { result.current.beginRequest(); result.current.submit({ url: '/submit',
    payload: { query: 'Hello', client_request_id: 'same-request' }, onResponse }); });
  await tick(15000);
  expect(axios.post).toHaveBeenCalledTimes(2);
  expect(axios.post.mock.calls[1][1]).toEqual(axios.post.mock.calls[0][1]);
  expect(onResponse).toHaveBeenCalledTimes(1);
});

it('stops spinning after delivery loss and Retry fetches the existing response without submitting again', async () => {
  axios.get.mockRejectedValue(new Error('Offline'));
  const { result } = renderHook(() => useAssistantRequestGuard('session'));
  const onSnapshot = vi.fn(), onError = vi.fn();
  act(() => result.current.watch({ ...watchOptions(onSnapshot), onError }));
  await tick(60000);
  expect(onError).toHaveBeenCalledTimes(1);
  expect(result.current.error?.retryable).toBe(true);
  axios.get.mockResolvedValue({ data: { status: 'COMPLETED', sessionDetails: completed } });
  act(() => result.current.retry());
  await tick(0);
  expect(onSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({ sessionMessageGenerationPending: false }));
  expect(result.current.error).toBeNull();
  expect(axios.post).not.toHaveBeenCalled();
});

it('does not let older sessions or lower sequence terminal snapshots stop the current request', () => {
  const { result } = renderHook(() => useAssistantRequestGuard('session'));
  expect(result.current.acceptSession(pending)).toBe(true);
  expect(result.current.acceptSession({ ...completed, sessionId: 'different' })).toBe(false);
  expect(result.current.acceptSession({ ...pending, assistantStream: { ...pending.assistantStream, sequence: 4, status: 'interrupted' }, sessionMessageGenerationPending: false })).toBe(true);
  expect(result.current.acceptSession({ ...pending, assistantStream: { ...pending.assistantStream, sequence: 2 } })).toBe(false);
});

it('rotates a stalled SSE body while healthy REST delivery continues', async () => {
  const cancel = vi.fn();
  globalThis.fetch.mockImplementation(() => Promise.resolve(new Response(new ReadableStream({ cancel }), {
    headers: { 'content-type': 'text/event-stream' },
  })));
  axios.get.mockResolvedValue({ data: { status: 'PENDING', sessionDetails: pending } });
  const { result } = renderHook(() => useAssistantRequestGuard('session'));
  const onError = vi.fn();
  act(() => result.current.watch({ ...watchOptions(vi.fn()), onError }));
  await tick(46000);
  expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(onError).not.toHaveBeenCalled();
  axios.get.mockResolvedValue({ data: { status: 'COMPLETED', sessionDetails: completed } });
  await tick(1000);
  expect(cancel).toHaveBeenCalledTimes(2);
});

it('preserves history when a legacy server sends only pending stream metadata', async () => {
  const user = { id: 'q', role: 'user', content: 'Question' };
  axios.get.mockResolvedValue({ data: { status: 'PENDING', assistantSessionVersion: 0,
    assistantStream: { queryId: 'q', sequence: 2, status: 'streaming', text: 'Partial reply' } } });
  const { result } = renderHook(() => useAssistantRequestGuard('session'));
  const onSnapshot = vi.fn();
  result.current.acceptSession({ ...pending, sessionMessages: [user] });
  act(() => result.current.watch(watchOptions(onSnapshot)));
  await tick(0);
  expect(onSnapshot.mock.lastCall[0].sessionMessages.map(message => message.content)).toEqual(['Question', 'Partial reply']);
});

it('waits through healthy reasoning pauses but offers recovery for a persistently stuck job', async () => {
  axios.get.mockResolvedValue({ data: { status: 'PENDING', sessionDetails: pending } });
  const { result } = renderHook(() => useAssistantRequestGuard('session'));
  const onError = vi.fn();
  act(() => result.current.watch({ ...watchOptions(vi.fn()), onError }));
  await tick(120000);
  expect(onError).not.toHaveBeenCalled();
  await tick(10 * 60000);
  expect(onError).toHaveBeenCalledTimes(1);
  expect(result.current.error.retryable).toBe(true);
  expect(axios.post).not.toHaveBeenCalled();
});

it('a late response for the previous query cannot end delivery of a newly acknowledged query', async () => {
  axios.post.mockResolvedValue({ data: { queryId: 'new-query' } });
  axios.get.mockResolvedValueOnce({ data: { status: 'COMPLETED', sessionDetails: completed } })
    .mockResolvedValue({ data: { status: 'PENDING', sessionDetails: { ...pending, assistantStream: { queryId: 'new-query', status: 'queued' } } } });
  const { result } = renderHook(() => useAssistantRequestGuard('session'));
  const onSnapshot = vi.fn();
  act(() => {
    result.current.beginRequest();
    void result.current.submit({ url: '/submit', payload: { query: 'New', client_request_id: 'new' },
      onResponse: () => result.current.watch(watchOptions(onSnapshot)) });
  });
  await tick(0);
  expect(onSnapshot).not.toHaveBeenCalled();
  await tick(1000);
  expect(onSnapshot.mock.lastCall[0].sessionMessageGenerationPending).toBe(true);
});

it('clear aborts submit retries and outstanding polls without restoring old errors or replies', async () => {
  axios.post.mockImplementation(() => new Promise(() => {}));
  const { result } = renderHook(() => useAssistantRequestGuard('session'));
  const onResponse = vi.fn(), onError = vi.fn();
  act(() => { result.current.beginRequest(); void result.current.submit({ url: '/submit', payload: { client_request_id: 'old' }, onResponse, onError }); });
  act(() => result.current.invalidate({ assistantSessionVersion: 1 }));
  await tick(60000);
  expect(axios.post).toHaveBeenCalledTimes(1);
  expect(axios.post.mock.calls[0][2].signal.aborted).toBe(true);
  expect(onResponse).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
  expect(result.current.error).toBeNull();
});

it('shows terminal server errors and releases polling while preserving interrupted text', async () => {
  axios.get.mockResolvedValue({ data: { status: 'COMPLETED', sessionDetails: {
    ...pending, sessionMessageGenerationPending: false, sessionMessageGenerationError: 'Provider unavailable',
    assistantStream: { queryId: 'q', status: 'interrupted', text: 'Partial reply', sequence: 4 },
  } } });
  const { result } = renderHook(() => useAssistantRequestGuard('session'));
  const onSnapshot = vi.fn();
  act(() => result.current.watch(watchOptions(onSnapshot)));
  await tick(0);
  expect(result.current.error).toMatchObject({ message: 'Provider unavailable', retryable: false });
  expect(onSnapshot.mock.lastCall[0]).toMatchObject({ sessionMessageGenerationPending: false,
    sessionMessages: [{ content: 'Partial reply', assistantStreamStatus: 'interrupted' }] });
  await tick(10000);
  expect(axios.get).toHaveBeenCalledTimes(1);
});

it('restarts delivery on reconnect without submitting a new query or overlapping status requests', async () => {
  axios.get.mockResolvedValue({ data: { status: 'PENDING', sessionDetails: pending } });
  const { result } = renderHook(() => useAssistantRequestGuard('session'));
  const onSnapshot = vi.fn();
  act(() => result.current.watch(watchOptions(onSnapshot)));
  await tick(0);
  axios.get.mockResolvedValue({ data: { status: 'COMPLETED', sessionDetails: completed } });
  act(() => window.dispatchEvent(new Event('online')));
  await tick(0);
  expect(onSnapshot.mock.lastCall[0].sessionMessageGenerationPending).toBe(false);
  expect(axios.get).toHaveBeenCalledTimes(2);
  expect(axios.post).not.toHaveBeenCalled();
});

it.each([undefined, '', '0\r\n\r\n', '<html>Bad Request</html>', { error: 'Bad Request' }])(
  'recovers an unstructured status 400 (%j) without replaying the acknowledged submission', async data => {
    axios.post.mockResolvedValue({ data: { queryId: 'q', status: 'PENDING' } });
    axios.get.mockRejectedValueOnce(httpFailure(400, data))
      .mockResolvedValue({ data: { status: 'COMPLETED', sessionDetails: completed } });
    const { result } = renderHook(() => useAssistantRequestGuard('session'));
    const onSnapshot = vi.fn(), onError = vi.fn();
    act(() => {
      result.current.beginRequest();
      void result.current.submit({ url: '/submit', payload: { query: 'Hello', client_request_id: 'original' },
        onResponse: () => result.current.watch({ ...watchOptions(onSnapshot), onError }) });
    });
    await tick(0);
    expect(result.current.error).toBeNull();
    expect(onError).not.toHaveBeenCalled();
    await tick(1000);
    expect(onSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({ sessionMessages: completed.sessionMessages }));
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.get).toHaveBeenCalledTimes(2);
  },
);

it('bounds repeated opaque 400 delivery failures and Retry reads the saved answer without another submission', async () => {
  axios.get.mockRejectedValue(httpFailure(400, '0\r\n\r\n'));
  const { result } = renderHook(() => useAssistantRequestGuard('session'));
  const onSnapshot = vi.fn(), onError = vi.fn();
  act(() => result.current.watch({ ...watchOptions(onSnapshot), onError }));
  await tick(60000);
  expect(onError).toHaveBeenCalledTimes(1);
  expect(result.current.error).toMatchObject({ retryable: true, message: 'Unable to load. Please try again.' });
  const reads = axios.get.mock.calls.length;
  await tick(20000);
  expect(axios.get).toHaveBeenCalledTimes(reads);
  axios.get.mockResolvedValue({ data: { status: 'COMPLETED', sessionDetails: completed } });
  act(() => result.current.retry());
  await tick(0);
  expect(onSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({ sessionMessageGenerationPending: false }));
  expect(result.current.error).toBeNull();
  expect(axios.post).not.toHaveBeenCalled();
});

it('keeps healthy SSE heartbeats alive past the contact deadline while status polls return opaque 400s', async () => {
  let stream;
  globalThis.fetch.mockImplementation(() => Promise.resolve(heartbeatStream(controller => { stream = controller; })));
  axios.get.mockRejectedValue(httpFailure(400, 'Bad Request'));
  const { result } = renderHook(() => useAssistantRequestGuard('session'));
  const onSnapshot = vi.fn(), onError = vi.fn();
  act(() => result.current.watch({ ...watchOptions(onSnapshot), onError }));
  await tick(70000);
  expect(onError).not.toHaveBeenCalled();
  expect(result.current.error).toBeNull();
  expect(globalThis.fetch.mock.calls[0][1].cache).toBe('no-store');
  act(() => stream.enqueue(new TextEncoder().encode(`event: snapshot\ndata: ${JSON.stringify(completed)}\n\n`)));
  await tick(0);
  expect(onSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({ sessionMessages: completed.sessionMessages }));
  expect(axios.post).not.toHaveBeenCalled();
});

it('heartbeats do not extend the no-progress deadline indefinitely', async () => {
  globalThis.fetch.mockImplementation(() => Promise.resolve(heartbeatStream(() => {})));
  axios.get.mockRejectedValue(httpFailure(400, 'Bad Request'));
  const { result } = renderHook(() => useAssistantRequestGuard('session'));
  const onError = vi.fn();
  act(() => result.current.watch({ ...watchOptions(vi.fn()), onError }));
  await tick(12 * 60000);
  expect(onError).toHaveBeenCalledTimes(1);
  expect(result.current.error?.retryable).toBe(true);
  expect(axios.post).not.toHaveBeenCalled();
});

it.each([
  [400, { error: 'Invalid session ID.' }],
  [400, { code: 'INVALID_SESSION_ID' }],
  [401, 'Unauthorized'], [403, 'Forbidden'], [404, 'Not found'],
])('stops status delivery on application validation or access rejection HTTP %i (%j)', async (status, data) => {
  axios.get.mockRejectedValue(httpFailure(status, data));
  const { result } = renderHook(() => useAssistantRequestGuard('session'));
  const onError = vi.fn();
  act(() => result.current.watch({ ...watchOptions(vi.fn()), onError }));
  await tick(10000);
  expect(onError).toHaveBeenCalledTimes(1);
  expect(result.current.error?.retryable).toBe(false);
  expect(axios.get).toHaveBeenCalledTimes(1);
  expect(axios.post).not.toHaveBeenCalled();
});

it('reconnects an opaque SSE handshake 400 and receives the existing answer', async () => {
  globalThis.fetch.mockResolvedValueOnce(new Response('0\r\n\r\n', { status: 400 }))
    .mockResolvedValueOnce(new Response(`event: snapshot\ndata: ${JSON.stringify(completed)}\n\n`, {
      headers: { 'content-type': 'text/event-stream' },
    }));
  axios.get.mockRejectedValue(new Error('Offline'));
  const { result } = renderHook(() => useAssistantRequestGuard('session'));
  const onSnapshot = vi.fn(), onError = vi.fn();
  act(() => result.current.watch({ ...watchOptions(onSnapshot), onError }));
  await tick(1000);
  expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  expect(onSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({ sessionMessages: completed.sessionMessages }));
  expect(onError).not.toHaveBeenCalled();
  expect(axios.post).not.toHaveBeenCalled();
});

it('preserves structured validation errors from the SSE handshake', async () => {
  globalThis.fetch.mockResolvedValue(new Response(JSON.stringify({ error: 'Invalid session ID.' }), { status: 400 }));
  axios.get.mockResolvedValue({ data: { status: 'PENDING', sessionDetails: pending } });
  const { result } = renderHook(() => useAssistantRequestGuard('session'));
  const onError = vi.fn();
  act(() => result.current.watch({ ...watchOptions(vi.fn()), onError }));
  await tick(10000);
  expect(onError).toHaveBeenCalledTimes(1);
  expect(result.current.error).toMatchObject({ message: 'Invalid session ID.', retryable: false });
  expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  expect(axios.post).not.toHaveBeenCalled();
});

it('falls back to REST when a legacy SSE endpoint returns an empty JSON 404', async () => {
  globalThis.fetch.mockResolvedValue(new Response('{}', { status: 404 }));
  axios.get.mockResolvedValueOnce({ data: { status: 'PENDING', sessionDetails: pending } })
    .mockResolvedValue({ data: { status: 'COMPLETED', sessionDetails: completed } });
  const { result } = renderHook(() => useAssistantRequestGuard('session'));
  const onSnapshot = vi.fn(), onError = vi.fn();
  act(() => result.current.watch({ ...watchOptions(onSnapshot), onError }));
  await tick(1000);
  expect(onSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({ sessionMessages: completed.sessionMessages }));
  expect(onError).not.toHaveBeenCalled();
  expect(result.current.error).toBeNull();
  expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  expect(axios.post).not.toHaveBeenCalled();
});

it.each([{ error: 'Video session not found.' }, { code: 'SESSION_NOT_FOUND' }])(
  'preserves meaningful SSE access 404 responses (%j)', async data => {
    globalThis.fetch.mockResolvedValue(new Response(JSON.stringify(data), { status: 404 }));
    axios.get.mockResolvedValue({ data: { status: 'PENDING', sessionDetails: pending } });
    const { result } = renderHook(() => useAssistantRequestGuard('session'));
    const onError = vi.fn();
    act(() => result.current.watch({ ...watchOptions(vi.fn()), onError }));
    await tick(10000);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(result.current.error?.retryable).toBe(false);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(axios.post).not.toHaveBeenCalled();
  },
);

it('keeps the previous snapshot on 304 reads and still receives the saved final reply', async () => {
  axios.get.mockResolvedValue({ status: 304, data: '' });
  const { result } = renderHook(() => useAssistantRequestGuard('session'));
  const onSnapshot = vi.fn(), onError = vi.fn();
  result.current.acceptSession(pending);
  act(() => result.current.watch({ ...watchOptions(onSnapshot), onError }));
  await tick(70000);
  expect(onSnapshot).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
  expect(axios.get.mock.calls[0][1].validateStatus(304)).toBe(true);
  axios.get.mockResolvedValue({ status: 200, data: { status: 'COMPLETED', sessionDetails: completed } });
  await tick(1000);
  expect(onSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({ sessionMessages: completed.sessionMessages }));
  expect(axios.post).not.toHaveBeenCalled();
});
