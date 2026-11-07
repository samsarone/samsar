import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import axios from 'axios';
import WorkspaceAssistant from '../../src/components/assistant/WorkspaceAssistant.jsx';

vi.mock('axios', () => ({ default: { post: vi.fn(), get: vi.fn() } }));
vi.mock('../../src/utils/web.jsx', () => ({ getHeaders: () => ({ headers: { Authorization: 'fixture' } }) }));
vi.mock('../../src/components/assistant/AssistantHome.jsx', () => ({ default: props => <>
  <button onClick={props.onOpen}>Open assistant</button>
  <button disabled={props.isAssistantQueryGenerating} onClick={() => props.submitAssistantQuery('Join my clips')}>Send query</button>
  <output>{props.sessionId || 'No conversation'}</output>
  {props.sessionMessages.map((message, i) => <p key={i}>{message.content}</p>)}
</> }));
const id = '123456789012345678901234';
beforeEach(() => {
  axios.post.mockReset(); axios.get.mockReset();
  axios.post.mockImplementation(async url => url.endsWith('/workspace') ? { data: { id } } : { data: { status: 'PENDING' } });
  axios.get.mockResolvedValue({ data: { sessionDetails: { sessionMessages: [], assistantSessionVersion: 3, sessionMessageGenerationPending: false } } });
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
});

it('creates the owner-scoped conversation lazily and submits fresh view context with the server version', async () => {
  const view = render(<WorkspaceAssistant ownerId="owner" context={{ version: 1, page: 'audio', view: 'generate' }} />);
  expect(axios.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Open assistant'));
  await waitFor(() => expect(screen.getByText(id)).toBeInTheDocument());
  await waitFor(() => expect(screen.getByText('Send query')).toBeEnabled());
  view.rerender(<WorkspaceAssistant ownerId="owner" context={{ version: 1, page: 'audio', view: 'join', selectedCount: 3 }} />);
  await act(async () => fireEvent.click(screen.getByText('Send query')));
  const call = axios.post.mock.calls.find(([url]) => url.endsWith('/submit_assistant_query'));
  expect(call[1]).toMatchObject({ id, workspace: 'audio', query: 'Join my clips', assistantSessionVersion: 3,
    assistantContext: { page: 'audio', view: 'join', selectedCount: 3 }, stream: true });
  expect(axios.get.mock.calls[0][0]).toContain('workspace=audio');
  view.unmount();
});

it('offers a retry after workspace initialization fails without creating a video project', async () => {
  axios.post.mockRejectedValueOnce(new Error('temporary'));
  render(<WorkspaceAssistant ownerId="owner" context={{ version: 1, page: 'audio', view: 'join' }} />);
  fireEvent.click(screen.getByText('Open assistant'));
  await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  fireEvent.click(screen.getByText('Retry'));
  await waitFor(() => expect(screen.getByText(id)).toBeInTheDocument());
  expect(axios.post.mock.calls.every(([url]) => url.endsWith('/assistants/workspace'))).toBe(true);
});
