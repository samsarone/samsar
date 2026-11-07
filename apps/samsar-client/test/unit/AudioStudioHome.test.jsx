import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';

const session = vi.hoisted(() => ({
  user: { _id: 'audio-user' }, getUserAPI: vi.fn(), colorMode: 'dark',
  openAlertDialog: vi.fn(), closeAlertDialog: vi.fn(),
  availability: {
    audioAvailability: { ttsProviders: ['OPENAI'], musicProviders: ['ELEVENLABS_MUSIC'], soundEffectProviders: ['SDAUDIO'] },
    isLoading: false,
  },
}));

vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../src/components/common/CommonContainer.tsx', () => ({ default: ({ children, openAudioActions }) => <><button onClick={openAudioActions}>Audio actions</button>{children}</> }));
vi.mock('../../src/contexts/AlertDialogContext.jsx', () => ({ useAlertDialog: () => session }));
vi.mock('../../src/contexts/UserContext.jsx', () => ({ useUser: () => session }));
vi.mock('../../src/contexts/ColorMode.jsx', () => ({ useColorMode: () => ({ colorMode: session.colorMode }) }));
vi.mock('../../src/hooks/useAudioProviderAvailability.js', () => ({ useAudioProviderAvailability: () => session.availability }));
vi.mock('../../src/utils/web.jsx', () => ({ getHeaders: () => ({ headers: { Authorization: 'test-session' } }) }));
vi.mock('../../src/utils/environment.jsx', () => ({ IS_STANDALONE_DEPLOYMENT: true }));

import AudioStudioHome from '../../src/components/audio/AudioStudioHome.jsx';

const pendingGenerationKey = 'audioStudioPendingRequestId';
const pendingJoinKey = 'audioStudioPendingJoinRequestId';
const item = (id, extra = {}) => ({
  _id: id, libraryType: 'music', title: `Track ${id}`, duration: 65,
  url: `https://audio.example/${id}.mp3`, ...extra,
});
const libraryResponse = (items = [], extra = {}) => ({ data: {
  items, page: 1, totalPages: 1, totalItems: items.length,
  categoryCounts: { music: items.length, speech: 0, sound_effect: 0 }, ...extra,
} });
const isEndpoint = (url, endpoint) => url.endsWith(endpoint);
async function tick(ms = 0) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}
async function mount() {
  const rendered = render(<AudioStudioHome />);
  await tick();
  return rendered;
}
function submitButton() {
  return screen.getAllByRole('button', { name: 'Generate audio', exact: true }).find((button) => button.type === 'submit');
}
function enterPrompt(text = '  Warm strings  ') {
  fireEvent.change(screen.getByLabelText(/^(Prompt|Script)$/), { target: { value: text } });
}
async function openJoin() {
  fireEvent.click(screen.getByRole('button', { name: 'Join Audio', exact: true }));
  await tick();
}
function selectJoin(id) {
  fireEvent.click(screen.getByRole('button', { name: `Select Track ${id}`, exact: true }));
}

beforeEach(() => {
  vi.useFakeTimers();
  axios.get.mockReset();
  axios.post.mockReset();
  session.getUserAPI.mockReset().mockResolvedValue(undefined);
  session.user = { _id: 'audio-user' };
  session.colorMode = 'dark';
  session.availability = {
    audioAvailability: { ttsProviders: ['OPENAI'], musicProviders: ['ELEVENLABS_MUSIC'], soundEffectProviders: ['SDAUDIO'] },
    isLoading: false,
  };
  axios.get.mockImplementation(async (url) => isEndpoint(url, '/audio/studio/library')
    ? libraryResponse()
    : { data: { status: 'PENDING' } });
  axios.post.mockResolvedValue({ data: { requestId: 'request-1' } });
});

describe('Audio Studio library integration', () => {
  it('opens the audio picker only on request and selects sound effects without generating', async () => {
    await mount();
    expect(session.openAlertDialog).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Audio actions' }));
    render(session.openAlertDialog.mock.calls[0][0]);
    const dialog = screen.getByRole('dialog', { name: 'Audio actions' });
    expect(within(dialog).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Generate music', 'Generate speech', 'Generate sound effects', 'Join audio',
    ]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Generate sound effects' }));
    await tick();
    expect(screen.getByLabelText('Audio type')).toHaveValue('sound_effect');
    expect(session.closeAlertDialog).toHaveBeenCalledOnce();
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('opens the existing join workspace from the audio picker', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Audio actions' }));
    render(session.openAlertDialog.mock.calls[0][0]);
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Audio actions' })).getByRole('button', { name: 'Join audio' }));
    await tick();
    expect(screen.queryByLabelText('Audio type')).not.toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Audio categories' })).toBeInTheDocument();
    expect(session.closeAlertDialog).toHaveBeenCalledOnce();
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('loads the authenticated first page and disables empty generation', async () => {
    await mount();
    expect(axios.get).toHaveBeenCalledWith(expect.stringMatching(/\/audio\/studio\/library$/), {
      headers: { Authorization: 'test-session' }, params: { page: 1, limit: 18, libraryType: 'music' },
    });
    expect(screen.getByText('No music yet')).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
    enterPrompt('   ');
    expect(submitButton()).toBeDisabled();
  });

  it('makes no library request for a guest', async () => {
    session.user = null;
    await mount();
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('shows the first preview, supports selecting cards by keyboard, and falls back between audio URLs', async () => {
    axios.get.mockResolvedValue(libraryResponse([
      item('a', { title: '  Opening  ', prompt: 'A quiet introduction', remoteAudioLinks: ['https://audio.example/fallback.mp3'] }),
      item('b', { title: '', prompt: '', description: 'Gentle rain', projectName: 'Rain project', url: undefined }),
    ]));
    const { container } = await mount();
    const preview = screen.getByRole('region', { name: 'Selected audio preview' });
    expect(within(preview).getByRole('heading', { name: 'Opening' })).toBeInTheDocument();
    expect(within(preview).getByText('A quiet introduction')).toBeInTheDocument();
    const audio = preview.querySelector('audio');
    expect(audio).toHaveAttribute('src', 'https://audio.example/fallback.mp3');
    fireEvent.error(audio);
    expect(preview.querySelector('audio')).toHaveAttribute('src', 'https://audio.example/a.mp3');
    fireEvent.error(preview.querySelector('audio'));
    expect(within(preview).getByText('Preview unavailable')).toBeInTheDocument();
    const second = screen.getByRole('button', { name: /Gentle rain.*Audio library item b/ });
    fireEvent.keyDown(second, { key: 'x' });
    expect(within(preview).getByRole('heading', { name: 'Opening' })).toBeInTheDocument();
    fireEvent.keyDown(second, { key: 'Enter' });
    expect(within(preview).getByRole('heading', { name: 'Gentle rain' })).toBeInTheDocument();
    expect(container.querySelectorAll('audio')).toHaveLength(1);
  });

  it('renders recoverable library errors and retries from Refresh library', async () => {
    axios.get.mockRejectedValueOnce({ response: { data: { error: 'Library offline' } } });
    await mount();
    expect(screen.getByText('Library offline')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh library' }));
    await tick();
    expect(screen.queryByText('Library offline')).not.toBeInTheDocument();
    expect(screen.getByText('No music yet')).toBeInTheDocument();
  });

  it('debounces search, trims its request, and discards stale results', async () => {
    let resolveOld;
    axios.get.mockImplementation((_url, config) => {
      if (config.params.search === 'old') return new Promise((resolve) => { resolveOld = resolve; });
      return Promise.resolve(libraryResponse(config.params.search === 'new' ? [item('new')] : []));
    });
    await mount();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'old' } });
    await tick(249);
    expect(axios.get).toHaveBeenCalledTimes(1);
    await tick(1);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: ' new ' } });
    await tick(250);
    expect(screen.getByRole('button', { name: 'View Track new' })).toBeInTheDocument();
    await act(async () => { resolveOld(libraryResponse([item('old')])); });
    expect(screen.queryByRole('button', { name: 'View Track old' })).not.toBeInTheDocument();
    expect(axios.get.mock.calls.at(-1)[1].params.search).toBe('new');
  });

  it('appends the next page, de-duplicates ids, and removes the load-more button on the final page', async () => {
    axios.get.mockResolvedValueOnce(libraryResponse([item('a'), item('b')], { totalPages: 2, totalItems: 3 }))
      .mockResolvedValueOnce(libraryResponse([item('b'), item('c')], { page: 2, totalPages: 2, totalItems: 3 }));
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Load more (2 of 3)' }));
    await tick();
    expect(screen.getAllByRole('button', { name: /^View Track / })).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /Load more/ })).not.toBeInTheDocument();
    expect(axios.get.mock.calls.at(-1)[1].params.page).toBe(2);
  });

  it('switches the library category independently from the generation type', async () => {
    session.colorMode = 'light';
    await mount();
    fireEvent.click(screen.getByRole('tab', { name: /Speech/ }));
    await tick();
    expect(axios.get.mock.calls.at(-1)[1].params.libraryType).toBe('speech');
    expect(screen.getByRole('combobox', { name: 'Audio type' })).toHaveValue('music');
    expect(screen.getByText('No speech yet')).toBeInTheDocument();
  });
});

describe('Audio Studio generation integration', () => {
  it('submits trimmed music options, blocks duplicate requests, and refreshes completed audio and credits', async () => {
    axios.get.mockImplementation(async (url) => isEndpoint(url, '/audio/studio/library')
      ? libraryResponse()
      : { data: { status: 'PENDING' } });
    await mount();
    enterPrompt();
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: '  Opening theme  ' } });
    fireEvent.change(screen.getByRole('slider'), { target: { value: '45' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Instrumental track' }));
    fireEvent.click(submitButton());
    await tick();
    expect(axios.post).toHaveBeenCalledWith(expect.stringMatching(/\/audio\/studio\/generate$/), {
      generationType: 'music', prompt: 'Warm strings', title: 'Opening theme',
      model: 'ELEVENLABS_MUSIC', duration: 45, isInstrumental: false,
    }, { headers: { Authorization: 'test-session' } });
    expect(screen.getByRole('button', { name: 'Generating…' })).toBeDisabled();
    expect(localStorage.getItem(pendingGenerationKey)).toBe('request-1');
    axios.get.mockImplementation(async (url) => isEndpoint(url, '/audio/studio/library')
      ? libraryResponse([item('finished')])
      : { data: { status: 'COMPLETED', item: item('finished') } });
    await tick(2500);
    expect(screen.getByRole('heading', { name: 'Track finished', level: 2 })).toBeInTheDocument();
    expect(screen.getByText('Audio ready')).toBeInTheDocument();
    expect(localStorage.getItem(pendingGenerationKey)).toBeNull();
    expect(session.getUserAPI).toHaveBeenCalledTimes(2);
    expect(axios.post).toHaveBeenCalledOnce();
  });

  it('submits speech with the selected provider and voice without music-only fields', async () => {
    await mount();
    fireEvent.change(screen.getByLabelText('Audio type'), { target: { value: 'speech' } });
    enterPrompt('  Hello world  ');
    fireEvent.change(screen.getByLabelText('Voice'), { target: { value: 'echo' } });
    fireEvent.click(submitButton());
    await tick();
    expect(axios.post.mock.calls[0][1]).toMatchObject({
      generationType: 'speech', prompt: 'Hello world', model: 'OPENAI', provider: 'OPENAI', speaker: 'echo',
    });
    expect(axios.post.mock.calls[0][1]).not.toHaveProperty('duration');
    expect(axios.post.mock.calls[0][1]).not.toHaveProperty('isInstrumental');
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });

  it('switches to sound effects with a short duration and its configured model', async () => {
    await mount();
    fireEvent.change(screen.getByLabelText('Audio type'), { target: { value: 'sound_effect' } });
    expect(screen.getByRole('slider')).toHaveValue('5');
    enterPrompt('  Door closing  ');
    fireEvent.click(submitButton());
    await tick();
    expect(axios.post.mock.calls[0][1]).toEqual({
      generationType: 'sound_effect', prompt: 'Door closing', model: 'SDAUDIO', duration: 5,
    });
  });

  it.each([
    [{ response: { data: { error: 'No credits' } } }, 'No credits'],
    [{ response: { data: { message: 'Provider down' } } }, 'Provider down'],
    [new Error('Network unavailable'), 'Network unavailable'],
  ])('shows a generation request failure and enables a retry', async (error, message) => {
    axios.post.mockRejectedValue(error);
    await mount();
    enterPrompt();
    fireEvent.click(submitButton());
    await tick();
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(submitButton()).toBeEnabled();
    expect(localStorage.getItem(pendingGenerationKey)).toBeNull();
  });

  it('rejects a generation response without a request id', async () => {
    axios.post.mockResolvedValue({ data: {} });
    await mount();
    enterPrompt();
    fireEvent.click(submitButton());
    await tick();
    expect(screen.getByText('The audio generation response did not include a request id.')).toBeInTheDocument();
    expect(submitButton()).toBeEnabled();
  });

  it.each(['FAILED', 'ERROR', 'CANCELLED'])('stops a resumed %s generation and clears persisted polling', async (status) => {
    localStorage.setItem(pendingGenerationKey, 'resume-generation');
    axios.get.mockImplementation(async (url) => isEndpoint(url, '/audio/studio/library')
      ? libraryResponse() : { data: { status, error: 'Generation stopped' } });
    await mount();
    expect(screen.getByText('Generation stopped')).toBeInTheDocument();
    expect(localStorage.getItem(pendingGenerationKey)).toBeNull();
    const count = axios.get.mock.calls.length;
    await tick(10000);
    expect(axios.get).toHaveBeenCalledTimes(count);
  });

  it.each(['SUCCEEDED', 'SUCCESS', 'DONE'])('accepts the terminal success alias %s from a resumed request', async (status) => {
    localStorage.setItem(pendingGenerationKey, 'resume-generation');
    axios.get.mockImplementation(async (url) => isEndpoint(url, '/audio/studio/library')
      ? libraryResponse() : { data: { status } });
    await mount();
    expect(screen.getByText('Audio ready')).toBeInTheDocument();
    expect(localStorage.getItem(pendingGenerationKey)).toBeNull();
  });

  it.each([401, 404])('clears an expired resumed generation after HTTP %s', async (status) => {
    localStorage.setItem(pendingGenerationKey, 'expired');
    axios.get.mockImplementation(async (url) => {
      if (isEndpoint(url, '/audio/studio/library')) return libraryResponse();
      throw { response: { status, data: { message: 'Request expired' } } };
    });
    await mount();
    expect(screen.getByText('Request expired')).toBeInTheDocument();
    expect(localStorage.getItem(pendingGenerationKey)).toBeNull();
  });

  it('retries transient polling failures and cancels the retry when unmounted', async () => {
    localStorage.setItem(pendingGenerationKey, 'retry');
    axios.get.mockImplementation(async (url) => {
      if (isEndpoint(url, '/audio/studio/library')) return libraryResponse();
      throw new Error('Temporary network failure');
    });
    const { unmount } = await mount();
    const statusCalls = () => axios.get.mock.calls.filter(([url]) => isEndpoint(url, '/audio/studio/status')).length;
    expect(statusCalls()).toBe(1);
    await tick(2500);
    expect(statusCalls()).toBe(2);
    unmount();
    await tick(10000);
    expect(statusCalls()).toBe(2);
    expect(localStorage.getItem(pendingGenerationKey)).toBe('retry');
  });

  it('does not restart generation polling when an in-flight response arrives after unmount', async () => {
    localStorage.setItem(pendingGenerationKey, 'in-flight');
    let resolveStatus;
    axios.get.mockImplementation((url) => isEndpoint(url, '/audio/studio/library')
      ? Promise.resolve(libraryResponse())
      : new Promise((resolve) => { resolveStatus = resolve; }));
    const { unmount } = await mount();
    unmount();
    await act(async () => { resolveStatus({ data: { status: 'PENDING' } }); });
    await tick(2500);
    expect(axios.get.mock.calls.filter(([url]) => isEndpoint(url, '/audio/studio/status'))).toHaveLength(1);
  });

  it('shows a queued status while a resumed generation is initialized', async () => {
    localStorage.setItem(pendingGenerationKey, 'initializing');
    axios.get.mockImplementation(async (url) => isEndpoint(url, '/audio/studio/library')
      ? libraryResponse() : { data: { status: 'INIT' } });
    await mount();
    expect(screen.getByRole('status')).toHaveTextContent('Generating your audio…');
    expect(localStorage.getItem(pendingGenerationKey)).toBe('initializing');
  });

  it('disables generation while providers load and when the active type has no configured provider', async () => {
    session.availability = { audioAvailability: { ttsProviders: [], musicProviders: [], soundEffectProviders: [] }, isLoading: true };
    const { rerender } = await mount();
    enterPrompt();
    expect(submitButton()).toBeDisabled();
    expect(screen.queryByText('No provider for this audio type is configured on this deployment.')).not.toBeInTheDocument();
    session.availability = { ...session.availability, isLoading: false };
    rerender(<AudioStudioHome />);
    expect(screen.getByText('No provider for this audio type is configured on this deployment.')).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Audio type'), { target: { value: 'speech' } });
    expect(screen.getByLabelText('Voice')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Audio type'), { target: { value: 'sound_effect' } });
    expect(screen.getByLabelText('Provider')).toBeDisabled();
  });
});

describe('Audio Studio joining integration', () => {
  beforeEach(() => {
    axios.get.mockImplementation(async (url) => isEndpoint(url, '/audio/studio/library')
      ? libraryResponse([item('a'), item('b'), item('c')]) : { data: { status: 'PENDING' } });
  });

  it.each(['PENDING', 'COMPLETED', 'FAILED'])('ignores an in-flight %s join status after unmount and leaves it available to resume', async (status) => {
    localStorage.setItem(pendingJoinKey, 'in-flight-join');
    let resolveStatus;
    axios.get.mockImplementation((url) => isEndpoint(url, '/audio/studio/library')
      ? Promise.resolve(libraryResponse())
      : new Promise((resolve) => { resolveStatus = resolve; }));
    const { unmount } = await mount();
    unmount();
    await act(async () => { resolveStatus({ data: { status, item: item('late-result') } }); });
    await tick(5000);
    expect(axios.get.mock.calls.filter(([url]) => isEndpoint(url, '/audio/join/status'))).toHaveLength(1);
    expect(localStorage.getItem(pendingJoinKey)).toBe('in-flight-join');
    expect(session.getUserAPI).not.toHaveBeenCalled();
  });

  it('does not schedule a retry for a join status rejection received after unmount', async () => {
    localStorage.setItem(pendingJoinKey, 'failed-in-flight-join');
    let rejectStatus;
    axios.get.mockImplementation((url) => isEndpoint(url, '/audio/studio/library')
      ? Promise.resolve(libraryResponse())
      : new Promise((_resolve, reject) => { rejectStatus = reject; }));
    const { unmount } = await mount();
    unmount();
    await act(async () => { rejectStatus(new Error('late network failure')); });
    await tick(5000);
    expect(axios.get.mock.calls.filter(([url]) => isEndpoint(url, '/audio/join/status'))).toHaveLength(1);
  });

  it('requires at least two selected clips, supports keyboard selection and reordering, and clears selection by category', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Use in Join Audio' }));
    await tick();
    selectJoin('a');
    expect(screen.getByRole('button', { name: 'Submit join' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('checkbox', { name: /Track b/ }), { key: ' ' });
    expect(screen.getByRole('button', { name: 'Submit join' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Move Track a earlier' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Move Track b earlier' }));
    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('listitem').map((node) => node.textContent)).toEqual(['1Track b', '2Track a']);
    fireEvent.click(screen.getByRole('button', { name: 'Move Track b later' }));
    expect(within(list).getAllByRole('listitem').map((node) => node.textContent)).toEqual(['1Track a', '2Track b']);
    fireEvent.click(within(list).getByRole('button', { name: 'Remove Track a' }));
    expect(screen.getByText('1/25 selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Speech/ }));
    await tick();
    expect(screen.getByText('0/25 selected')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit join' })).not.toBeInTheDocument();
  });

  it('submits clips in playback order with fade and title, then shows the completed joined track', async () => {
    await mount();
    await openJoin();
    selectJoin('a');
    selectJoin('b');
    fireEvent.click(screen.getByRole('button', { name: 'Move Track b earlier' }));
    fireEvent.change(screen.getByLabelText(/Output title/), { target: { value: '  Joined score  ' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Fade audio at ends/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit join' }));
    await tick();
    expect(axios.post).toHaveBeenCalledWith(expect.stringMatching(/\/audio\/join$/), {
      audioItemIds: ['b', 'a'], libraryType: 'music', fadeAudioAtEnds: true, title: 'Joined score',
    }, { headers: { Authorization: 'test-session' } });
    expect(screen.getByRole('button', { name: 'Joining…' })).toBeDisabled();
    expect(localStorage.getItem(pendingJoinKey)).toBe('request-1');
    axios.get.mockImplementation(async (url) => isEndpoint(url, '/audio/studio/library')
      ? libraryResponse([item('joined')]) : { data: { status: 'COMPLETED', joinedItemCount: 2, item: item('joined') } });
    await tick(1500);
    expect(screen.getByRole('heading', { name: 'Track joined', level: 2 })).toBeInTheDocument();
    expect(localStorage.getItem(pendingJoinKey)).toBeNull();
    expect(session.getUserAPI).toHaveBeenCalledOnce();
    await openJoin();
    expect(screen.getByText('0/25 selected')).toBeInTheDocument();
    expect(screen.getByLabelText(/Output title/)).toHaveValue('');
  });

  it('shows a rejected join and retains selected clips for retry', async () => {
    axios.post.mockRejectedValue({ response: { data: { error: 'Invalid clip' } } });
    await mount();
    await openJoin();
    selectJoin('a');
    selectJoin('b');
    fireEvent.click(screen.getByRole('button', { name: 'Submit join' }));
    await tick();
    expect(screen.getByText('Invalid clip')).toBeInTheDocument();
    expect(screen.getByText('2/25 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit join' })).toBeEnabled();
    expect(localStorage.getItem(pendingJoinKey)).toBeNull();
  });

  it('rejects a join response without an id', async () => {
    axios.post.mockResolvedValue({ data: {} });
    await mount();
    await openJoin();
    selectJoin('a');
    selectJoin('b');
    fireEvent.click(screen.getByRole('button', { name: 'Submit join' }));
    await tick();
    expect(screen.getByText('The audio join response did not include a request id.')).toBeInTheDocument();
  });

  it.each(['FAILED', 'ERROR', 'CANCELLED'])('stops a resumed join with %s and displays its error', async (status) => {
    localStorage.setItem(pendingJoinKey, 'resume-join');
    axios.get.mockImplementation(async (url) => isEndpoint(url, '/audio/studio/library')
      ? libraryResponse() : { data: { status, message: 'Join stopped' } });
    await mount();
    await openJoin();
    expect(screen.getByText('Join stopped')).toBeInTheDocument();
    expect(localStorage.getItem(pendingJoinKey)).toBeNull();
  });

  it.each([401, 404])('clears a persisted join after HTTP %s', async (status) => {
    localStorage.setItem(pendingJoinKey, 'expired-join');
    axios.get.mockImplementation(async (url) => {
      if (isEndpoint(url, '/audio/studio/library')) return libraryResponse();
      throw { response: { status, data: { error: 'Join expired' } } };
    });
    await mount();
    await openJoin();
    expect(screen.getByText('Join expired')).toBeInTheDocument();
    expect(localStorage.getItem(pendingJoinKey)).toBeNull();
  });

  it('retries a transient join status error, shows processing, and clears retry timers on unmount', async () => {
    localStorage.setItem(pendingJoinKey, 'retry-join');
    let statusCalls = 0;
    axios.get.mockImplementation(async (url) => {
      if (isEndpoint(url, '/audio/studio/library')) return libraryResponse();
      statusCalls += 1;
      if (statusCalls === 1) throw new Error('Transient failure');
      return { data: { status: 'PROCESSING' } };
    });
    const { unmount } = await mount();
    await openJoin();
    expect(statusCalls).toBe(1);
    await tick(1500);
    expect(statusCalls).toBe(2);
    expect(screen.getByText('Joining selected audio…')).toBeInTheDocument();
    unmount();
    await tick(10000);
    expect(statusCalls).toBe(2);
    expect(localStorage.getItem(pendingJoinKey)).toBe('retry-join');
  });

  it('limits a join to 25 clips and allows removing an item to admit another', async () => {
    axios.get.mockResolvedValue(libraryResponse(Array.from({ length: 26 }, (_, index) => item(String(index)))));
    await mount();
    await openJoin();
    for (let index = 0; index < 26; index += 1) selectJoin(String(index));
    expect(screen.getByText('25/25 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select Track 25', exact: true })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('list')).getByRole('button', { name: 'Remove Track 0', exact: true }));
    selectJoin('25');
    expect(screen.getByText('25/25 selected')).toBeInTheDocument();
    expect(within(screen.getByRole('list')).getByText('Track 25')).toBeInTheDocument();
  });
});
