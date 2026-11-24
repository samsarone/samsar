import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import axios from 'axios';
import ListVideoSessions from '../../src/components/video/sessions/ListVideoSessions.jsx';
vi.mock('axios', () => ({ default: { get: vi.fn() } }));
vi.mock('../../src/components/common/OverflowContainer.tsx', () => ({ default: ({ children }) => <main>{children}</main> }));
vi.mock('../../src/utils/web', () => ({ getHeaders: () => ({ headers: { Authorization: 'owner' } }) }));
function Destination() {
  const { pathname, search } = useLocation();
  return <output>{pathname}{search}</output>;
}
function mount() {
  return render(<MemoryRouter initialEntries={['/my_sessions']}><Routes><Route path="/my_sessions" element={<ListVideoSessions />} /><Route path="*" element={<Destination />} /></Routes></MemoryRouter>);
}
afterEach(() => vi.restoreAllMocks());

it.each(['project-id', { $oid: 'project-id' }])('opens a selected project even when browser storage is full (id=%j)', async id => {
  axios.get.mockResolvedValue({ data: { data: [{ id, recordType: 'session', sessionType: 'video', layerCount: 2, sessionName: 'Selected project' }], total: 1 } });
  mount();
  const card = await screen.findByText('Selected project');
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
  fireEvent.click(card);
  expect(await screen.findByText('/video/project-id')).toBeVisible();
});

it.each([
  [{ projectEditor: 'studio' }, '/video/project-id'],
  [{ projectEditor: 'vidgenie' }, '/vidgenie/project-id'],
  [{ renderStatus: 'pending' }, '/vidgenie/project-id?view=preview'],
  [{ renderStatus: 'paused' }, '/vidgenie/project-id?view=preview'],
  [{ projectEditor: 'vidgenie', renderStatus: 'completed' }, '/video/project-id'],
  [{ renderStatus: 'pending', isImportedSession: true }, '/video/project-id'],
])('opens a listed zero-layer project at its destination (%j)', async (details, path) => {
  axios.get.mockResolvedValue({ data: { data: [{
    id: 'project-id', recordType: 'session', sessionType: 'video', isListedProject: true,
    layerCount: 0, sessionName: 'Just created', ...details,
  }], total: 1 } });
  mount();
  const link = await screen.findByRole('link', { name: 'Just created' });
  expect(link).toHaveAttribute('href', path);
  fireEvent.click(link);
  expect(await screen.findByText(path)).toBeVisible();
});

it('refreshes when returning to Projects, keeps the cards visible, and ignores a superseded response', async () => {
  const project = (id) => ({ id, recordType: 'session', sessionType: 'video', isListedProject: true, layerCount: 0, sessionName: id });
  const result = (...ids) => ({ data: { data: ids.map(project), total: ids.length } });
  let finishOlder;
  let finishNewer;
  axios.get.mockReset().mockResolvedValueOnce(result('Original draft'))
    .mockImplementationOnce(() => new Promise((resolve) => { finishOlder = resolve; }))
    .mockImplementationOnce(() => new Promise((resolve) => { finishNewer = resolve; }));
  mount();
  expect(await screen.findByRole('link', { name: 'Original draft' })).toBeVisible();
  fireEvent(window, new Event('focus'));
  fireEvent(document, new Event('visibilitychange'));
  await waitFor(() => expect(axios.get).toHaveBeenCalledTimes(2));
  expect(screen.getByRole('link', { name: 'Original draft' })).toBeVisible();
  fireEvent(window, new StorageEvent('storage', { storageArea: localStorage, key: 'videoSessionId', newValue: 'New queued render' }));
  await waitFor(() => expect(axios.get).toHaveBeenCalledTimes(3));
  await act(async () => finishNewer(result('New queued render', 'Original draft')));
  await act(async () => finishOlder(result('Original draft')));
  expect(screen.getByRole('link', { name: 'New queued render' })).toBeVisible();
});
