import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import axios from 'axios';
import ListVideoSessions from '../../src/components/video/sessions/ListVideoSessions.jsx';
vi.mock('axios', () => ({ default: { get: vi.fn() } }));
vi.mock('../../src/components/common/OverflowContainer.tsx', () => ({ default: ({ children }) => <main>{children}</main> }));
vi.mock('../../src/utils/web', () => ({ getHeaders: () => ({ headers: { Authorization: 'owner' } }) }));
function Destination() { return <output>{useLocation().pathname}</output>; }
afterEach(() => vi.restoreAllMocks());

it.each(['project-id', { $oid: 'project-id' }])('opens a selected project even when browser storage is full (id=%j)', async id => {
  axios.get.mockResolvedValue({ data: { data: [{ id, recordType: 'session', sessionType: 'video', layerCount: 2, sessionName: 'Selected project' }], total: 1 } });
  render(<MemoryRouter initialEntries={['/my_sessions']}><Routes><Route path="/my_sessions" element={<ListVideoSessions />} /><Route path="/video/:id" element={<Destination />} /></Routes></MemoryRouter>);
  const card = await screen.findByText('Selected project');
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
  fireEvent.click(card);
  expect(await screen.findByText('/video/project-id')).toBeVisible();
});
