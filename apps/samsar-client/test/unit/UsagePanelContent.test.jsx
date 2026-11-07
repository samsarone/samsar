import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import axios from 'axios';
import UsagePanelContent from '../../src/components/account/UsagePanelContent.jsx';

vi.mock('axios', () => ({ default: { get: vi.fn() } }));
vi.mock('../../src/contexts/ColorMode.jsx', () => ({ useColorMode: () => ({ colorMode: 'dark' }) }));
vi.mock('../../src/contexts/UserContext.jsx', () => ({ useUser: () => ({ user: { _id: 'owner' } }) }));
vi.mock('../../src/utils/environment.jsx', () => ({ IS_STANDALONE_DEPLOYMENT: false }));
vi.mock('../../src/utils/web.jsx', () => ({ getHeaders: () => ({ headers: { Authorization: 'test' } }) }));
vi.mock('react-toastify', () => ({ toast: { error: vi.fn() } }));

function response(page = 1, pageSize = 25, totalItems = 53) {
  const count = Math.max(0, Math.min(pageSize, totalItems - (page - 1) * pageSize));
  return { data: {
    items: Array.from({ length: count }, (_, index) => ({
      id: `entry-${(page - 1) * pageSize + index}`, source: `entry_${(page - 1) * pageSize + index}`, credits: 2,
    })),
    pagination: {
      page, pageSize, totalItems, totalPages: Math.ceil(totalItems / pageSize),
      hasNextPage: page * pageSize < totalItems, hasPreviousPage: page > 1,
    },
  } };
}

beforeEach(() => {
  axios.get.mockReset();
  axios.get.mockImplementation(async (_url, { params }) => response(params.page, params.pageSize));
});

it('fetches only the selected page, replaces rows, and bounds navigation', async () => {
  render(<UsagePanelContent />);
  await screen.findByText('Entry 24');
  expect(axios.get).toHaveBeenLastCalledWith(expect.stringContaining('/users/usage/logs'), expect.objectContaining({
    params: { page: 1, pageSize: 25 }, headers: { Authorization: 'test' },
  }));
  screen.getAllByRole('button', { name: 'Previous' }).forEach(button => expect(button).toBeDisabled());
  fireEvent.click(screen.getAllByRole('button', { name: 'Next' })[0]);
  await screen.findByText('Entry 49');
  expect(screen.queryByText('Entry 0')).not.toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('button', { name: 'Next' }).at(-1));
  await screen.findByText('Entry 52');
  screen.getAllByRole('button', { name: 'Next' }).forEach(button => expect(button).toBeDisabled());
  expect(screen.getAllByText('Showing 51–53 of 53')).toHaveLength(2);
  fireEvent.click(screen.getAllByRole('button', { name: 'Previous' })[0]);
  await screen.findByText('Entry 25');
});

it('resets to page one when the page size changes and retains it on refresh', async () => {
  render(<UsagePanelContent />);
  await screen.findByText('Entry 24');
  fireEvent.click(screen.getAllByRole('button', { name: 'Next' })[0]);
  await screen.findByText('Entry 49');
  fireEvent.change(screen.getByRole('combobox', { name: 'Rows per page' }), { target: { value: '10' } });
  await waitFor(() => expect(axios.get).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ params: { page: 1, pageSize: 10 } })));
  await screen.findByText('Entry 9');
  expect(screen.queryByText('Entry 10')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => expect(axios.get).toHaveBeenCalledTimes(4));
  expect(axios.get.mock.lastCall[1].params).toEqual({ page: 1, pageSize: 10 });
});

it('disables navigation while loading and keeps the current page after a failed request', async () => {
  render(<UsagePanelContent />);
  await screen.findByText('Entry 24');
  let rejectRequest;
  axios.get.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectRequest = reject; }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Next' })[0]);
  screen.getAllByRole('button', { name: /Next|Previous|Refresh/ }).forEach(button => expect(button).toBeDisabled());
  expect(screen.getByRole('combobox', { name: 'Rows per page' })).toBeDisabled();
  await act(async () => { rejectRequest(new Error('offline')); });
  expect(screen.getByRole('alert')).toHaveTextContent('Unable to load usage logs');
  expect(screen.getByText('Entry 0')).toBeInTheDocument();
  expect(screen.getAllByText('Page 1 of 3')).toHaveLength(2);
  fireEvent.click(screen.getAllByRole('button', { name: 'Next' })[0]);
  await screen.findByText('Entry 25');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('shows an empty page with both directions disabled', async () => {
  axios.get.mockResolvedValue(response(1, 25, 0));
  render(<UsagePanelContent />);
  await screen.findByText('No usage yet', { selector: 'p.text-lg' });
  screen.getAllByRole('button', { name: /Next|Previous/ }).forEach(button => expect(button).toBeDisabled());
  expect(screen.getAllByText('Showing 0–0 of 0')).toHaveLength(2);
});

it('cancels in-flight requests when the panel unmounts', async () => {
  axios.get.mockImplementation(() => new Promise(() => {}));
  const { unmount } = render(<UsagePanelContent />);
  const signal = axios.get.mock.lastCall[1].signal;
  expect(signal?.aborted).toBe(false);
  unmount();
  expect(signal.aborted).toBe(true);
});
