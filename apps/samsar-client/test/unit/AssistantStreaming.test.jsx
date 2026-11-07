import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { readAssistantSSE, assistantMessagesFromSnapshot } from '../../src/utils/assistantSSE.js';
import { useAssistantRequestGuard } from '../../src/hooks/useAssistantRequestGuard.js';

afterEach(() => vi.restoreAllMocks());
function response(frames) { return new Response(frames.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } }); }

it('renders partial snapshots once, then replaces them with the saved final reply', () => {
  const user = { id: 'q', role: 'user', content: 'Hello' };
  const snapshot = { sessionMessages: [user], assistantStream: { queryId: 'q', text: 'Partial', status: 'interrupted' } };
  expect(assistantMessagesFromSnapshot(snapshot)).toEqual([user, { id: 'q', role: 'assistant', content: 'Partial', assistantStreamStatus: 'interrupted' }]);
  const final = { id: 'q', role: 'assistant', content: 'Final' };
  expect(assistantMessagesFromSnapshot({ ...snapshot, sessionMessages: [user, final] })).toEqual([user, final]);
});

it('parses fragmented unicode and rejects non-streaming server responses for REST fallback', async () => {
  const encoded = new TextEncoder().encode('event: snapshot\r\ndata: {"text":"你好"}\r\n\r\n');
  const values = [];
  const stream = new ReadableStream({ start(controller) { for (const byte of encoded) controller.enqueue(new Uint8Array([byte])); controller.close(); } });
  await readAssistantSSE(new Response(stream, { headers: { 'content-type': 'text/event-stream' } }), (event, data) => values.push([event, data]));
  expect(values).toEqual([['snapshot', { text: '你好' }]]);
  await expect(readAssistantSSE(new Response('{}'), () => {})).rejects.toThrow('not supported');
});

it('subscribes with auth and accepts final snapshots without duplicating assistant messages', async () => {
  const snapshot = { assistantSessionVersion: 2, sessionMessages: [], sessionMessageGenerationPending: false,
    assistantStream: { queryId: 'q', text: 'Hello', status: 'streaming' } };
  const fetchMock = vi.fn().mockResolvedValue(response([['snapshot', snapshot], ['settled', {}]]));
  vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);
  const onSnapshot = vi.fn();
  const { result } = renderHook(() => useAssistantRequestGuard('session'));
  act(() => result.current.subscribe({ url: '/stream', headers: { Authorization: 'Bearer token' }, onSnapshot }));
  await waitFor(() => expect(onSnapshot).toHaveBeenCalledTimes(1));
  expect(onSnapshot.mock.calls[0][0].sessionMessages[0].content).toBe('Hello');
  expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer token');
});

it('clear and navigation abort old streams and reject snapshots from the old session', async () => {
  let finish; let signal;
  vi.spyOn(globalThis, 'fetch').mockImplementation((_url, options) => { signal = options.signal; return new Promise(resolve => { finish = resolve; }); });
  const onSnapshot = vi.fn();
  const { result, rerender } = renderHook(({ id }) => useAssistantRequestGuard(id), { initialProps: { id: 'a' } });
  act(() => result.current.subscribe({ url: '/stream', onSnapshot }));
  act(() => result.current.invalidate({ assistantSessionVersion: 3 }));
  expect(signal.aborted).toBe(true);
  await act(async () => finish(response([['snapshot', { assistantSessionVersion: 2, sessionMessages: [] }], ['settled', {}]])));
  expect(onSnapshot).not.toHaveBeenCalled();
  act(() => result.current.subscribe({ url: '/stream', onSnapshot }));
  rerender({ id: 'b' });
  expect(signal.aborted).toBe(true);
  await act(async () => finish(response([['settled', {}]])));
});

it('a new message invalidates outstanding polls and streams from the previous message', () => {
  const { result } = renderHook(() => useAssistantRequestGuard('session'));
  act(() => result.current.acceptSession({ assistantSessionVersion: 3 }));
  const old = result.current.capture();
  let next;
  act(() => { next = result.current.beginRequest(); });
  expect(result.current.isCurrent(old)).toBe(false);
  expect(result.current.isCurrent(next)).toBe(true);
  expect(next.serverVersion).toBe(3);
});

it('a delayed partial snapshot cannot replace the final reply already received through REST', () => {
  const { result } = renderHook(() => useAssistantRequestGuard('session'));
  const snapshot = { assistantSessionVersion: 1, assistantStream: { queryId: 'q', status: 'completed' } };
  expect(result.current.acceptSession(snapshot)).toBe(true);
  expect(result.current.acceptSession({ ...snapshot, assistantStream: { queryId: 'q', status: 'streaming' } })).toBe(false);
  expect(result.current.acceptSession({ ...snapshot, assistantStream: { queryId: 'next', status: 'queued' } })).toBe(true);
});

it('polling renders successive pending text, preserves history and ignores stale SSE snapshots', () => {
  const { result } = renderHook(() => useAssistantRequestGuard('session'));
  const user = { id: 'q', role: 'user', content: 'Question' };
  let messages = [user];
  const setMessages = update => { messages = typeof update === 'function' ? update(messages) : update; };
  const pending = (text, sequence) => ({ status: 'PENDING', assistantSessionVersion: 1,
    assistantStream: { queryId: 'q', text, sequence, status: 'streaming' } });
  expect(result.current.applyStatus(pending('First', 1), setMessages)).toBe(false);
  expect(messages.map(message => message.content)).toEqual(['Question', 'First']);
  result.current.applyStatus(pending('First sentence', 2), setMessages);
  expect(messages.map(message => message.content)).toEqual(['Question', 'First sentence']);
  expect(result.current.acceptSession(pending('First', 1))).toBe(false);
  const final = { ...user, role: 'assistant', content: 'Final answer' };
  expect(result.current.applyStatus({ status: 'COMPLETED', sessionDetails: {
    assistantSessionVersion: 1, sessionMessages: [user, final], assistantStream: { queryId: 'q', status: 'completed' },
  } }, setMessages)).toBe(true);
  expect(messages).toEqual([user, final]);
});

it('keeps transient polling failures retryable but stops delivery on lost access', () => {
  const { result } = renderHook(() => useAssistantRequestGuard('session'));
  const token = result.current.capture();
  for (const error of [new Error('Offline'), { response: { status: 503 } }, { response: { status: 429 } }]) {
    expect(result.current.stopOnAccessError(error)).toBe(false);
    expect(result.current.isCurrent(token)).toBe(true);
  }
  expect(result.current.stopOnAccessError({ response: { status: 403 } })).toBe(true);
  expect(result.current.isCurrent(token)).toBe(false);
});
