import { act, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import axios from 'axios';
import ExternalStudioDashboard from '../../src/components/external/ExternalStudioDashboard.jsx';

const scenario = vi.hoisted(() => ({ user: null, headers: null }));
vi.mock('axios', () => ({ default: Object.assign(vi.fn(), { get: vi.fn() }) }));
vi.mock('../../src/contexts/UserContext.jsx', () => ({
  useUser: () => ({ user: scenario.user, userInitiated: true, userFetching: false, resetUser: vi.fn() }),
}));
vi.mock('../../src/utils/web.jsx', async (importOriginal) => ({
  ...await importOriginal(), getHeaders: () => scenario.headers,
}));
vi.mock('../../src/components/common/OverflowContainer.tsx', () => ({ default: ({ children }) => children }));
vi.mock('../../src/hooks/useDeploymentModelAvailability.js', () => ({
  useDeploymentModelAvailability: () => ({ isStandaloneDeployment: false }),
}));

async function mount(path = '/external/studio?request=ext-first') {
  const router = createMemoryRouter([
    { path: '/external/studio', element: <ExternalStudioDashboard /> },
    { path: '*', element: <div>Other page</div> },
  ], { initialEntries: [path] });
  const view = render(<RouterProvider router={router} />);
  await act(async () => {});
  return { router, view };
}

beforeEach(() => {
  scenario.user = { _id: 'partner', isExternalUser: true };
  scenario.headers = { headers: { Authorization: 'Bearer partner-test' } };
  axios.mockReset();
  axios.get.mockReset();
});

it('polls the scoped request, displays the finished video, and stops fetching', async () => {
  vi.useFakeTimers();
  const resultUrl = 'https://example.com/video.mp4';
  axios.get.mockResolvedValueOnce({ data: { status: 'PENDING' } })
    .mockResolvedValueOnce({ data: { status: 'IN_PROGRESS' } })
    .mockResolvedValueOnce({ data: { status: 'COMPLETED', result_url: resultUrl } });
  const { view } = await mount();
  expect(screen.getByRole('status')).toHaveTextContent('Pending');
  expect(screen.getByRole('link', { name: 'Create' })).toHaveAttribute('href', '/create');
  expect(screen.getByRole('link', { name: 'External Studio' })).toHaveAttribute('href', '/external/studio');
  expect(axios.get).toHaveBeenCalledWith(expect.stringMatching(/\/v1\/external_users\/status$/), expect.objectContaining({
    headers: scenario.headers.headers, params: { request_id: 'ext-first' },
  }));
  expect(axios).not.toHaveBeenCalled();

  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(screen.getByRole('status')).toHaveTextContent('Processing');
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(screen.getByRole('status')).toHaveTextContent('Completed');
  expect(view.container.querySelector('video')).toHaveAttribute('src', resultUrl);
  await act(async () => vi.advanceTimersByTimeAsync(60000));
  expect(axios.get).toHaveBeenCalledTimes(3);
});

it('displays a failed render with its reason and stops polling', async () => {
  vi.useFakeTimers();
  axios.get.mockResolvedValue({ data: { status: 'FAILED', error: { message: 'The source image was missing.' } } });
  await mount();
  expect(screen.getByRole('status')).toHaveTextContent('Failed');
  expect(screen.getByText('The source image was missing.')).toBeVisible();
  await act(async () => vi.advanceTimersByTimeAsync(60000));
  expect(axios.get).toHaveBeenCalledOnce();
});

it('retries temporary status failures and lets the user retry a rejected request', async () => {
  vi.useFakeTimers();
  axios.get.mockRejectedValueOnce({ response: { status: 503 } })
    .mockRejectedValueOnce({ response: { status: 404, data: { message: 'Request not found.' } } })
    .mockResolvedValueOnce({ data: { status: 'PAUSED' } });
  await mount();
  expect(screen.getByRole('alert')).toBeVisible();
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(screen.getByRole('alert')).toHaveTextContent('Request not found.');
  await act(async () => vi.advanceTimersByTimeAsync(10000));
  expect(axios.get).toHaveBeenCalledTimes(2);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Try again' })));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Paused');
});

it('aborts the old request on navigation and discards its late result', async () => {
  vi.useFakeTimers();
  let resolveOld;
  axios.get.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
    .mockResolvedValueOnce({ data: { status: 'RUNNING' } });
  const { router, view } = await mount();
  const oldSignal = axios.get.mock.calls[0][1].signal;
  await act(async () => router.navigate('/external/studio?request=ext-second'));
  expect(oldSignal.aborted).toBe(true);
  expect(axios.get.mock.calls[1][1].params).toEqual({ request_id: 'ext-second' });
  await act(async () => resolveOld({ data: { status: 'COMPLETED', result_url: 'https://example.com/old.mp4' } }));
  expect(screen.getByRole('status')).toHaveTextContent('Running');
  expect(view.container.querySelector('video')).toBeNull();
  view.unmount();
  await act(async () => vi.advanceTimersByTimeAsync(60000));
  expect(axios.get).toHaveBeenCalledTimes(2);
});

it.each([null, { _id: 'internal' }])('guards external status reads when the user is %s', async user => {
  scenario.user = user;
  await mount();
  expect(screen.getByText('Other page')).toBeVisible();
  expect(axios.get).not.toHaveBeenCalled();
});

it('shows a sign-in message when external credentials are missing', async () => {
  scenario.headers = null;
  await mount();
  expect(screen.getByRole('alert')).toHaveTextContent('Please sign in again.');
  expect(axios.get).not.toHaveBeenCalled();
});

it('scrolls to credit purchases after the dashboard has loaded', async () => {
  let finishCredits;
  axios.mockImplementation(({ url }) => url.endsWith('/credits')
    ? new Promise(resolve => { finishCredits = resolve; })
    : Promise.resolve({ data: { requests: [] } }));
  const scroll = vi.fn();
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll });
  try {
    await mount('/external/studio#credits');
    expect(scroll).not.toHaveBeenCalled();
    await act(async () => finishCredits({ data: { remainingCredits: 123 } }));
    expect(scroll).toHaveBeenCalledOnce();
    expect(scroll.mock.instances[0]).toBe(screen.getByRole('heading', { name: 'Top up credits' }).closest('section#credits'));
  } finally {
    if (original) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', original);
    else delete HTMLElement.prototype.scrollIntoView;
  }
});
