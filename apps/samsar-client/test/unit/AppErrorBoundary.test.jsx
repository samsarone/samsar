import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AppErrorBoundary from '../../src/components/common/AppErrorBoundary.jsx';
import { APP_ERROR_REVEAL_DELAY_MS, APP_STARTUP_ERROR_WINDOW_MS } from '../../src/utils/appErrorRecovery.mjs';

function BrokenPage() { throw new Error('test render failure'); }
// React dispatches expected render failures as window errors in development.
const suppressExpectedError = (event) => {
  if (event.error?.message === 'test render failure') event.preventDefault();
};
afterEach(() => window.removeEventListener('error', suppressExpectedError));
beforeEach(() => {
  window.addEventListener('error', suppressExpectedError);
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

it('renders healthy content normally', () => {
  render(<AppErrorBoundary><h1>Project</h1></AppErrorBoundary>);
  expect(screen.getByRole('heading', { name: 'Project' })).toBeVisible();
});

it('shows a loading screen during startup recovery, then offers reload', () => {
  render(<AppErrorBoundary><BrokenPage /></AppErrorBoundary>);
  expect(screen.getByText('Opening workspace...')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Reload page' })).not.toBeInTheDocument();
  act(() => vi.advanceTimersByTime(APP_ERROR_REVEAL_DELAY_MS));
  expect(screen.getByRole('button', { name: 'Reload page' })).toBeVisible();
});

it('shows errors immediately after the startup window', () => {
  const { rerender } = render(<AppErrorBoundary><div>Ready</div></AppErrorBoundary>);
  act(() => vi.advanceTimersByTime(APP_STARTUP_ERROR_WINDOW_MS + 1));
  rerender(<AppErrorBoundary><BrokenPage /></AppErrorBoundary>);
  expect(screen.getByRole('button', { name: 'Reload page' })).toBeVisible();
});

it('clears the recovery timer when the boundary unmounts', () => {
  const { unmount } = render(<AppErrorBoundary><BrokenPage /></AppErrorBoundary>);
  expect(vi.getTimerCount()).toBe(1);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
