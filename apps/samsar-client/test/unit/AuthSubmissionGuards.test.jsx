import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Login from '../../src/components/auth/Login.tsx';
import ForgotPassword from '../../src/components/auth/ForgotPassword.jsx';

const boundary = vi.hoisted(() => ({ post: vi.fn(), persist: vi.fn() }));
vi.mock('axios', () => ({ default: { post: boundary.post } }));
vi.mock('../../src/utils/web.jsx', () => ({ persistAuthToken: boundary.persist }));
vi.mock('../../src/contexts/ColorMode.jsx', () => ({ useColorMode: () => ({ colorMode: 'dark' }) }));
vi.mock('../../src/contexts/UserContext.jsx', () => ({ useUser: () => ({ user: null }) }));

beforeEach(() => vi.resetAllMocks());

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function mountLogin() {
  const handlers = {
    setCurrentLoginView: vi.fn(), signInWithGoogle: vi.fn(), setUser: vi.fn(),
    closeAlertDialog: vi.fn(), getOrCreateUserSession: vi.fn(),
  };
  const view = render(<MemoryRouter><Login {...handlers} /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText('Email', { exact: true }), { target: { value: 'Jane@Example.COM' } });
  fireEvent.change(screen.getByLabelText('Password', { exact: true }), { target: { value: ' private pass ' } });
  return { ...view, handlers, form: view.container.querySelector('form') };
}

describe('credential submission request guards', () => {
  it('synchronously rejects duplicate form submissions and exposes pending state', async () => {
    const request = deferred();
    boundary.post.mockReturnValue(request.promise);
    const { form, handlers } = mountLogin();
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    expect(boundary.post).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/\/users\/login$/), { email: 'jane@example.com', password: ' private pass ' });
    const submit = form.querySelector('button[type="submit"]');
    expect(submit).toBeDisabled();
    expect(submit).toHaveAttribute('aria-busy', 'true');
    await act(async () => request.resolve({ data: { _id: 'owner', authToken: 'owner-token' } }));
    expect(handlers.setUser).toHaveBeenCalledOnce();
    expect(boundary.persist).toHaveBeenCalledWith('owner-token');
    expect(submit).toBeEnabled();
  });

  it('keeps duplicate submissions blocked until the authenticated route is ready', async () => {
    const navigation = deferred();
    boundary.post.mockResolvedValue({ data: { _id: 'owner', authToken: 'owner-token' } });
    const { form, handlers } = mountLogin();
    handlers.getOrCreateUserSession.mockReturnValue(navigation.promise);
    fireEvent.submit(form);
    await waitFor(() => expect(handlers.getOrCreateUserSession).toHaveBeenCalledOnce());
    fireEvent.submit(form);
    expect(boundary.post).toHaveBeenCalledOnce();
    expect(form.querySelector('button[type="submit"]')).toBeDisabled();
    await act(async () => navigation.resolve());
    expect(form.querySelector('button[type="submit"]')).toBeEnabled();
  });

  it('unlocks after an error and permits one successful retry', async () => {
    boundary.post.mockRejectedValueOnce({ response: { data: { message: 'Try again' } } }).mockResolvedValueOnce({ data: { _id: 'owner', authToken: 'retry-token' } });
    const { form, handlers } = mountLogin();
    fireEvent.submit(form);
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again');
    expect(form.querySelector('button[type="submit"]')).toBeEnabled();
    fireEvent.submit(form);
    await waitFor(() => expect(handlers.setUser).toHaveBeenCalledOnce());
    expect(boundary.post).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('rejects whitespace-only email even if submission bypasses native validation', () => {
    const { form } = mountLogin();
    fireEvent.change(screen.getByLabelText('Email', { exact: true }), { target: { value: '  ' } });
    fireEvent.submit(form);
    expect(screen.getByRole('alert')).toHaveTextContent('Email and password are required.');
    expect(boundary.post).not.toHaveBeenCalled();
    expect(form.querySelector('button[type="submit"]')).toBeEnabled();
  });
});

describe('recovery email validation and request guards', () => {
  function mountRecovery() {
    const view = render(<ForgotPassword setCurrentLoginView={vi.fn()} />);
    return { ...view, form: view.container.querySelector('form') };
  }

  it.each(['', '  '])('rejects empty recovery input %j without sending email', (email) => {
    const { form } = mountRecovery();
    const input = screen.getByLabelText('Email', { exact: true });
    expect(input).toBeRequired();
    fireEvent.change(input, { target: { value: email } });
    fireEvent.submit(form);
    expect(screen.getByText('Email is required.')).toBeVisible();
    expect(boundary.post).not.toHaveBeenCalled();
  });

  it('normalizes a recovery address and permits only one pending request', async () => {
    const request = deferred();
    boundary.post.mockReturnValue(request.promise);
    const { form } = mountRecovery();
    fireEvent.change(screen.getByLabelText('Email', { exact: true }), { target: { value: 'Jane@Example.COM' } });
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    expect(boundary.post).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/\/users\/forgot_password$/), { email: 'jane@example.com', language: 'en' });
    expect(screen.getByRole('button', { name: 'Reset Password' })).toBeDisabled();
    await act(async () => request.resolve({ data: {} }));
    expect(screen.getByText('Check your email for password reset instructions.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Reset Password' })).toBeEnabled();
  });

  it('clears the previous result while a retry is pending and unlocks after failure', async () => {
    const retry = deferred();
    boundary.post.mockResolvedValueOnce({ data: {} }).mockReturnValueOnce(retry.promise);
    const { form } = mountRecovery();
    fireEvent.change(screen.getByLabelText('Email', { exact: true }), { target: { value: 'jane@example.com' } });
    fireEvent.submit(form);
    await screen.findByText('Check your email for password reset instructions.');
    fireEvent.submit(form);
    expect(screen.queryByText('Check your email for password reset instructions.')).not.toBeInTheDocument();
    await act(async () => retry.reject(new Error('offline')));
    expect(screen.getByText('Failed to send reset email. Please try again.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Reset Password' })).toBeEnabled();
  });
});
