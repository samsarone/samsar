import { StrictMode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';
import VideoEditorLandingHome from '../../src/components/video/VideoEditorLandingHome.jsx';
import { createStudioSession } from '../../src/utils/studioSessionApi.js';
vi.hoisted(() => { vi.stubEnv('VITE_PROCESSOR_API', '/api'); });
const auth = vi.hoisted(() => ({ user: { _id: 'owner' }, userFetching: false, userInitiated: true }));
vi.mock('axios', () => ({ default: { get: vi.fn() } }));
vi.mock('../../src/contexts/UserContext', () => ({ useUser: () => auth }));
vi.mock('../../src/utils/web', () => ({ getAuthToken: () => 'owner-token', getHeaders: () => ({ headers: { Authorization: 'owner-token' } }) }));
vi.mock('../../src/components/video/VideoHome.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/video/util/StudioSkeletonLoader.jsx', () => ({ default: () => <div role="status">Loading studio</div> }));
vi.mock('../../src/utils/studioSessionApi.js', async original => ({ ...await original(), createStudioSession: vi.fn() }));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; }
function Harness() {
  const navigate = useNavigate();
  return <><output>{useLocation().pathname}</output><button onClick={() => navigate('/video/selected')}>Select project</button>
    <Routes><Route path="/video" element={<VideoEditorLandingHome />} /><Route path="*" element={<p>Session page</p>} /></Routes></>;
}
function mount() { render(<StrictMode><MemoryRouter initialEntries={['/video']}><Harness /></MemoryRouter></StrictMode>); }
beforeEach(() => { axios.get.mockReset(); createStudioSession.mockReset(); });

it('never redirects a selected project when an older Studio entry lookup completes late', async () => {
  const pending = deferred();
  localStorage.setItem('videoSessionId', 'previous');
  axios.get.mockReturnValue(pending.promise);
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Select project' }));
  expect(await screen.findByText('/video/selected')).toBeVisible();
  await act(async () => pending.resolve({ data: { _id: 'previous', layers: [{}] } }));
  expect(screen.getByText('/video/selected')).toBeVisible();
  expect(axios.get).toHaveBeenCalledTimes(1);
  expect(createStudioSession).not.toHaveBeenCalled();
});

it('keeps the selected session after a server failure and lets the user retry without creating a new project', async () => {
  localStorage.setItem('videoSessionId', 'previous');
  axios.get.mockRejectedValueOnce({ response: { status: 503 } }).mockResolvedValue({ data: { _id: 'previous', layers: [] } });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('/video/previous')).toBeVisible();
  expect(localStorage.getItem('videoSessionId')).toBe('previous');
  expect(createStudioSession).not.toHaveBeenCalled();
  expect(axios.get).toHaveBeenCalledTimes(2);
});

it('creates only one replacement for an explicitly missing stored session during Strict Mode replay', async () => {
  localStorage.setItem('videoSessionId', 'missing');
  axios.get.mockRejectedValue({ response: { status: 404 } });
  createStudioSession.mockResolvedValue({ _id: 'new-session', layers: [{}] });
  mount();
  expect(await screen.findByText('/video/new-session')).toBeVisible();
  expect(createStudioSession).toHaveBeenCalledTimes(1);
});


it('does not create a replacement if a missing-project response arrives after leaving Studio entry', async () => {
  let reject;
  localStorage.setItem('videoSessionId', 'missing');
  axios.get.mockReturnValue(new Promise((_, fail) => { reject = fail; }));
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Select project' }));
  expect(await screen.findByText('/video/selected')).toBeVisible();
  await act(async () => reject({ response: { status: 404 } }));
  expect(createStudioSession).not.toHaveBeenCalled();
  expect(localStorage.getItem('videoSessionId')).toBe('missing');
});
