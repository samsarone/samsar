import { useEffect, useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import axios from 'axios';
import AssistantHome from '../../src/components/assistant/AssistantHome.jsx';
import { useAssistantRequestGuard } from '../../src/hooks/useAssistantRequestGuard.js';

const mocks = vi.hoisted(() => ({
  user: { _id: 'owner' },
  options: [{ value: 'gpt-6-astra', label: 'GPT 6 Astra High' },
    { value: 'gpt-6-astra-xhigh', label: 'GPT 6 Astra XHigh' }],
}));

vi.mock('axios', () => ({ default: { post: vi.fn() } }));
vi.mock('../../src/contexts/ColorMode.jsx', () => ({ useColorMode: () => ({ colorMode: 'dark' }) }));
vi.mock('../../src/contexts/UserContext.jsx', () => ({ useUser: () => ({ user: mocks.user, getUserAPI: vi.fn() }) }));
vi.mock('../../src/utils/web.jsx', () => ({ getHeaders: () => ({ headers: { Authorization: 'test-auth' } }) }));
vi.mock('../../src/hooks/useDeploymentModelAvailability.js', () => ({ useDeploymentModelAvailability: () => ({ primaryAdapterByModel: {} }) }));
vi.mock('../../src/hooks/useInferenceModelAvailability.js', () => ({
  useInferenceModelAvailability: () => ({ isStandaloneDeployment: false, isLoading: false,
    hasConfiguredInferenceModels: true, assistantModelOptions: mocks.options }),
}));

const history = [{ role: 'user', id: 'old', content: 'Old question' }, { role: 'assistant', id: 'old', content: 'Old reply' }];
const cleared = { data: { sessionDetails: { sessionMessages: [], sessionMessageGenerationPending: false } } };

beforeEach(() => {
  axios.post.mockReset();
  axios.post.mockResolvedValue(cleared);
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = vi.fn();
});

export function Conversation({ id = 'session-a', initialMessages = history, pending = false, subscribe = false, ...props }) {
  const [messages, setMessages] = useState(initialMessages);
  const [generating, setGenerating] = useState(pending);
  const guard = useAssistantRequestGuard(id);
  useEffect(() => {
    if (subscribe) guard.subscribe({ url: '/assistant-stream', onSnapshot: snapshot => {
      setMessages(snapshot.sessionMessages);
      setGenerating(snapshot.sessionMessageGenerationPending);
    } });
  }, [guard, subscribe]);
  return <AssistantHome sessionId={id} sessionMessages={messages} isAssistantQueryGenerating={generating}
    onSessionMessagesChange={setMessages} onAssistantQueryGeneratingChange={setGenerating}
    onSessionCleared={guard.invalidate} submitAssistantQuery={vi.fn()} {...props} />;
}

function open() { fireEvent.click(screen.getByRole('button', { name: 'Assistant', exact: true })); }
function requestClear() { fireEvent.click(screen.getByRole('button', { name: 'Clear session', exact: true })); }
function confirmClear() { fireEvent.click(screen.getByRole('button', { name: 'Clear messages', exact: true })); }

it('uses the selected model as the header picker and retains an accessible clear action', async () => {
  render(<Conversation />);
  open();
  expect(screen.getByRole('button', { name: 'Clear session', exact: true })).toBeEnabled();
  const modelPicker = screen.getByRole('combobox', { name: 'Assistant model', exact: true });
  const header = modelPicker.closest('header');
  expect(header).not.toBeNull();
  expect(within(header).queryByText('Assistant', { exact: true })).not.toBeInTheDocument();
  expect(screen.getAllByRole('combobox')).toHaveLength(1);
  expect(modelPicker.closest('form')).toBeNull();
  expect(screen.queryByText('Get help with prompts, captions, titles, descriptions, or edits.')).not.toBeInTheDocument();
  fireEvent.keyDown(modelPicker, { key: 'ArrowDown' });
  fireEvent.click(screen.getByRole('option', { name: 'GPT 6 Astra XHigh' }));
  await waitFor(() => expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/users/update'),
    { selectedAssistantModel: 'gpt-6-astra-xhigh' }, { headers: { Authorization: 'test-auth' } }));
  expect(within(header).getByText('GPT 6 Astra XHigh')).toBeInTheDocument();
});

it('shows successive SSE chunks in the popup before the response stream closes', async () => {
  let controller;
  const body = new ReadableStream({ start(value) { controller = value; } });
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, {
    headers: { 'content-type': 'text/event-stream' },
  }));
  const user = { id: 'live', role: 'user', content: 'Live question' };
  const send = (event, data) => controller.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  const snapshot = (text, sequence) => ({ sessionMessages: [user], assistantSessionVersion: 1,
    sessionMessageGenerationPending: true, assistantStream: { queryId: 'live', text, sequence, status: 'streaming' } });
  try {
    render(<Conversation initialMessages={[user]} pending subscribe />);
    open();
    await act(async () => send('snapshot', snapshot('First words', 1)));
    await waitFor(() => expect(screen.getByText('First words')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
    await act(async () => send('snapshot', snapshot('First words continue', 2)));
    await waitFor(() => expect(screen.getByText('First words continue')).toBeInTheDocument());
    expect(screen.queryByText('First words', { exact: true })).not.toBeInTheDocument();
    await act(async () => {
      send('snapshot', { ...snapshot('', 3), sessionMessageGenerationPending: false,
        sessionMessages: [user, { id: 'live', role: 'assistant', content: 'Final reply' }],
        assistantStream: { queryId: 'live', sequence: 3, status: 'completed' } });
      send('settled', {});
    });
    await waitFor(() => expect(screen.getAllByText('Final reply')).toHaveLength(1));
    expect(screen.queryByText('First words continue')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Next question' } });
    expect(screen.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  } finally { controller.close(); fetchMock.mockRestore(); }
});

it('confirms before clearing and allows cancellation without a server request', () => {
  render(<Conversation />);
  open(); requestClear();
  expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  expect(axios.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  expect(screen.getByText('Old reply')).toBeInTheDocument();
});

it('clears on the server even while generating and resets history, draft and attachment', async () => {
  render(<Conversation pending getFrameImageData={vi.fn()} />);
  open();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Draft message' } });
  requestClear(); confirmClear();
  await waitFor(() => expect(screen.queryByText('Old reply')).not.toBeInTheDocument());
  expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/assistants/reset_session_messages'),
    { id: 'session-a' }, { headers: { Authorization: 'test-auth' } });
  expect(screen.getByRole('textbox')).toHaveValue('');
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  expect(screen.getByText('How can I help with your session?')).toBeInTheDocument();
});

it('retains history and shows a retryable error when clearing fails', async () => {
  axios.post.mockRejectedValueOnce({ response: { data: { error: 'Unable to clear' } } });
  render(<Conversation />);
  open(); requestClear(); confirmClear();
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unable to clear'));
  expect(screen.getByText('Old reply')).toBeInTheDocument();
  confirmClear();
  await waitFor(() => expect(screen.queryByText('Old reply')).not.toBeInTheDocument());
});

it('does not apply an old clear response after navigating to another session', async () => {
  let resolve;
  axios.post.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const { rerender } = render(<Conversation />);
  open(); requestClear(); confirmClear();
  rerender(<Conversation id="session-b" />);
  await act(async () => resolve(cleared));
  expect(screen.getByText('Old reply')).toBeInTheDocument();
});

it('discards a frame capture completed after the conversation was cleared', async () => {
  let resolve;
  const submit = vi.fn();
  render(<Conversation submitAssistantQuery={submit} getFrameImageData={() => new Promise(done => { resolve = done; })} />);
  open();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Review frame' } });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Send', exact: true }));
  requestClear(); confirmClear();
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  await act(async () => resolve({ dataUrl: 'data:image/png;base64,frame' }));
  expect(submit).not.toHaveBeenCalled();
});

it('invalidates polling responses and timers on clear, navigation and unmount', () => {
  vi.useFakeTimers();
  let guard;
  function Guard({ id }) { guard = useAssistantRequestGuard(id); return null; }
  const { rerender, unmount } = render(<Guard id="a" />);
  const old = guard.capture();
  const poll = vi.fn();
  guard.setInterval(poll, 1000);
  guard.invalidate();
  vi.advanceTimersByTime(2000);
  expect(poll).not.toHaveBeenCalled();
  expect(guard.isCurrent(old)).toBe(false);
  guard.invalidate({ assistantSessionVersion: 1 });
  expect(guard.acceptSession({ sessionMessages: history })).toBe(false);
  expect(guard.acceptSession({ assistantSessionVersion: 1, sessionMessages: [] })).toBe(true);
  expect(guard.capture().serverVersion).toBe(1);
  const fresh = guard.capture();
  expect(guard.isCurrent(fresh)).toBe(true);
  rerender(<Guard id="b" />);
  expect(guard.isCurrent(fresh)).toBe(false);
  const navigated = guard.capture();
  unmount();
  expect(guard.isCurrent(navigated)).toBe(false);
});


it('renders retrieved public documentation citations safely without interpreting arbitrary markup', () => {
  render(<Conversation initialMessages={[{ id: 'cited', role: 'assistant', content: '[Audio reference](https://docs.samsar.one/audio) **Current guidance** [Unsafe](javascript:alert(1))' }]} />);
  open();
  expect(screen.getByRole('link', { name: 'Audio reference' })).toHaveAttribute('href', 'https://docs.samsar.one/audio');
  expect(screen.getByRole('link')).toHaveAttribute('rel', 'noopener noreferrer');
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.getByText('Current guidance')).toBeInTheDocument();
});

it('preserves server line breaks, empty paragraphs and indentation around formatted text', () => {
  const content = '**Story idea**\n\nA fox enters the forest.\n  - Follow the lanterns.\n\n\n[Guide](https://docs.samsar.one/video)\n';
  render(<Conversation initialMessages={[{ id: 'formatted', role: 'assistant', content }]} />);
  open();
  const body = screen.getByText('Story idea').parentElement;
  expect(body.textContent).toBe('Story idea\n\nA fox enters the forest.\n  - Follow the lanterns.\n\n\nGuide\n');
  expect(within(body).getByRole('link', { name: 'Guide' })).toHaveAttribute('href', 'https://docs.samsar.one/video');
});
