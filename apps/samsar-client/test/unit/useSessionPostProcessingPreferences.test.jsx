import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import axios from 'axios';
import { useSessionPostProcessingPreferences } from '../../src/hooks/useSessionPostProcessingPreferences.js';

vi.mock('axios', () => ({ default: { post: vi.fn() } }));
vi.mock('../../src/utils/web.jsx', () => ({ getHeaders: () => ({ headers: { Authorization: 'test' } }) }));
beforeEach(() => axios.post.mockReset().mockResolvedValue({ data: {} }));
const defaults = { translationEnableSubtitles: false, translationTranslateOutro: false, translationTranslateFooter: false };

it('sends only changed preferences with authorization to the target session', async () => {
  const { result } = renderHook(() => useSessionPostProcessingPreferences({ session: { _id: 'source' }, apiServer: 'https://processor.example/' }));
  expect(result.current.preferences).toEqual(defaults);
  act(() => result.current.updatePreference('translationTranslateFooter', true));
  expect(result.current.preferences.translationTranslateFooter).toBe(true);
  await act(async () => { await result.current.flushPreferences(); });
  expect(axios.post).toHaveBeenCalledExactlyOnceWith('https://processor.example/video_sessions/post_processing_preferences', {
    sessionId: 'source', preferences: { translationTranslateFooter: true },
  }, { headers: { Authorization: 'test' }, timeout: 15000 });
});

it('hydrates late session data, protects user toggles from polls, and resets immediately on route changes', async () => {
  const { result, rerender } = renderHook(({ sessionId, session }) => useSessionPostProcessingPreferences({ sessionId, session }), {
    initialProps: { sessionId: 'source', session: null },
  });
  rerender({ sessionId: 'source', session: { session: { _id: 'source', postProcessingPreferences: { translationTranslateOutro: true } } } });
  expect(result.current.preferences.translationTranslateOutro).toBe(true);
  act(() => result.current.updatePreference('translationTranslateFooter', true));
  await act(async () => { await result.current.flushPreferences(); });
  rerender({ sessionId: 'source', session: { _id: 'source', postProcessingPreferences: { translationTranslateFooter: false } } });
  expect(result.current.preferences.translationTranslateFooter).toBe(true);
  rerender({ sessionId: 'next', session: { _id: 'source', postProcessingPreferences: { translationTranslateFooter: true } } });
  expect(result.current.preferences).toEqual(defaults);
  act(() => result.current.updatePreference('translationEnableSubtitles', true));
  await act(async () => { await result.current.flushPreferences(); });
  expect(axios.post.mock.calls.at(-1)[1]).toEqual({ sessionId: 'next', preferences: { translationEnableSubtitles: true } });
});

it('surfaces save failures and permits retrying preferences without a model request', async () => {
  const onError = vi.fn();
  axios.post.mockRejectedValueOnce({ response: { data: { message: 'Preference save failed' } } });
  const { result } = renderHook(() => useSessionPostProcessingPreferences({ session: { _id: 'source' }, onError }));
  act(() => result.current.updatePreference('translationTranslateFooter', true));
  await waitFor(() => expect(result.current.error?.message).toBe('Preference save failed'));
  expect(onError).toHaveBeenCalledTimes(1);
  expect(axios.post).toHaveBeenCalledTimes(1);
  await act(async () => { await result.current.flushPreferences(); });
  expect(axios.post).toHaveBeenCalledTimes(2);
  expect(result.current.error).toBeNull();
  expect(axios.post.mock.calls.every(([url]) => url.endsWith('/video_sessions/post_processing_preferences'))).toBe(true);
});

it('rejects a pending submission flush after the route switches and ignores an old write error', async () => {
  let rejectSave;
  axios.post.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectSave = reject; }));
  const onError = vi.fn();
  const { result, rerender } = renderHook(({ sessionId }) => useSessionPostProcessingPreferences({ sessionId, session: null, onError }), {
    initialProps: { sessionId: 'old' },
  });
  act(() => result.current.updatePreference('translationTranslateFooter', true));
  await waitFor(() => expect(axios.post).toHaveBeenCalledTimes(1));
  const flushing = result.current.flushPreferences().catch(error => error);
  rerender({ sessionId: 'new' });
  await act(async () => { rejectSave(new Error('Old save failed')); await flushing; });
  expect((await flushing).code).toBe('POST_PROCESSING_PREFERENCE_SESSION_CHANGED');
  expect(result.current.preferences).toEqual(defaults);
  expect(result.current.error).toBeNull();
  expect(onError).not.toHaveBeenCalled();
});
