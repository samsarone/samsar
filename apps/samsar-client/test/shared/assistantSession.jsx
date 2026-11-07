import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import axios from 'axios';
import AssistantHome from '../../src/components/assistant/AssistantHome.jsx';
import { useAssistantRequestGuard } from '../../src/hooks/useAssistantRequestGuard.js';

const mocks = vi.hoisted(() => ({
  user: { _id: 'owner' },
  options: [{ value: 'gpt-6-astra', label: 'GPT 6 Astra' }],
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

export function Conversation({ id = 'session-a', initialMessages = history, pending = false, ...props }) {
  const [messages, setMessages] = useState(initialMessages);
  const [generating, setGenerating] = useState(pending);
  const guard = useAssistantRequestGuard(id);
  return <AssistantHome sessionId={id} sessionMessages={messages} isAssistantQueryGenerating={generating}
    onSessionMessagesChange={setMessages} onAssistantQueryGeneratingChange={setGenerating}
    onSessionCleared={guard.invalidate} submitAssistantQuery={vi.fn()} {...props} />;
}

function open() { fireEvent.click(screen.getByRole('button', { name: 'Assistant', exact: true })); }
function requestClear() { fireEvent.click(screen.getByRole('button', { name: 'Clear session', exact: true })); }
function confirmClear() { fireEvent.click(screen.getByRole('button', { name: 'Clear messages', exact: true })); }

it('keeps model controls collapsed and exposes an explicit clear action', () => {
  render(<Conversation />);
  open();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Clear session', exact: true })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Assistant model settings' }));
  expect(screen.getByRole('combobox', { name: 'Assistant model', exact: true })).toBeInTheDocument();
  expect(screen.queryByText('Get help with prompts, captions, titles, descriptions, or edits.')).not.toBeInTheDocument();
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
