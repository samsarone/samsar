import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { page, userEvent } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import Login from '../../src/components/auth/Login.tsx';
import Register from '../../src/components/auth/Register.tsx';
import ForgotPassword from '../../src/components/auth/ForgotPassword.jsx';
import { ColorModeProvider } from '../../src/contexts/ColorMode.jsx';
import { persistAuthToken } from '../../src/utils/web.jsx';

vi.mock('axios', () => ({ default: { post: vi.fn() } }));
vi.mock('../../src/contexts/UserContext.jsx', () => ({ useUser: () => ({ user: null }) }));
vi.mock('../../src/utils/web.jsx', () => ({ persistAuthToken: vi.fn() }));

beforeEach(() => { axios.post.mockReset(); });

function mount(element, theme = 'dark') {
  localStorage.setItem('colorMode', theme);
  return render(<MemoryRouter><ColorModeProvider>{element}</ColorModeProvider></MemoryRouter>);
}

function loginProps() {
  return {
    setCurrentLoginView: vi.fn(), signInWithGoogle: vi.fn(), setUser: vi.fn(),
    closeAlertDialog: vi.fn(), getOrCreateUserSession: vi.fn(),
  };
}

async function fillCredentials(email = 'Jane.Example@Example.COM', password = 'secret pass') {
  await page.getByLabelText('Email', { exact: true }).fill(email);
  await page.getByLabelText('Password', { exact: true }).fill(password);
}

describe('sign in with the browser form', () => {
  it('uses native required-field validation before making a request', async () => {
    mount(<Login {...loginProps()} />);
    await page.getByRole('button', { name: 'Login', exact: true }).last().click();
    expect(axios.post).not.toHaveBeenCalled();
    expect(document.querySelector('#login-email').validity.valueMissing).toBe(true);
  });

  it('uses native email validation before making a request', async () => {
    mount(<Login {...loginProps()} />);
    await fillCredentials('not-an-email');
    await page.getByRole('button', { name: 'Login', exact: true }).last().click();
    expect(axios.post).not.toHaveBeenCalled();
    expect(document.querySelector('#login-email').validity.typeMismatch).toBe(true);
  });

  it.each(['dark', 'light'])('normalizes email, preserves the password and commits a successful login in %s mode', async (theme) => {
    const props = loginProps();
    const user = { _id: 'user-1', authToken: 'session-token', username: 'jane' };
    axios.post.mockResolvedValue({ data: user });
    mount(<Login {...props} />, theme);
    await fillCredentials('Jane.Example@Example.COM', '  private pass  ');
    await page.getByLabelText('Password', { exact: true }).click();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(props.getOrCreateUserSession).toHaveBeenCalledWith(user));
    expect(axios.post).toHaveBeenCalledWith(expect.stringMatching(/\/users\/login$/), {
      email: 'jane.example@example.com', password: '  private pass  ',
    });
    expect(persistAuthToken).toHaveBeenCalledWith('session-token');
    expect(props.setUser).toHaveBeenCalledWith(user);
    expect(props.closeAlertDialog).toHaveBeenCalledOnce();
    expect(persistAuthToken.mock.invocationCallOrder[0]).toBeLessThan(props.setUser.mock.invocationCallOrder[0]);
  });

  it.each([
    [{ response: { data: { message: 'Please verify your email first.' } } }, 'Please verify your email first.'],
    [new Error('network unavailable'), 'Invalid email or password. Please try again.'],
  ])('shows server or fallback errors without persisting credentials', async (failure, message) => {
    const props = loginProps();
    axios.post.mockRejectedValue(failure);
    mount(<Login {...props} />);
    await fillCredentials();
    await page.getByRole('button', { name: 'Login', exact: true }).last().click();
    await expect.element(page.getByRole('alert')).toHaveTextContent(message);
    expect(persistAuthToken).not.toHaveBeenCalled();
    expect(props.setUser).not.toHaveBeenCalled();
    expect(props.closeAlertDialog).not.toHaveBeenCalled();
  });

  it('clears an old login error while a retry is pending and permits successful recovery', async () => {
    let resolveRetry;
    axios.post.mockRejectedValueOnce(new Error('offline')).mockImplementationOnce(() => new Promise((resolve) => { resolveRetry = resolve; }));
    const props = loginProps();
    mount(<Login {...props} />);
    await fillCredentials();
    await page.getByRole('button', { name: 'Login', exact: true }).last().click();
    await expect.element(page.getByRole('alert')).toBeVisible();
    await page.getByRole('button', { name: 'Login', exact: true }).last().click();
    await expect.element(page.getByRole('alert')).not.toBeInTheDocument();
    expect(props.setUser).not.toHaveBeenCalled();
    resolveRetry({ data: { _id: 'recovered', authToken: 'new-token' } });
    await waitFor(() => expect(props.setUser).toHaveBeenCalledWith({ _id: 'recovered', authToken: 'new-token' }));
  });

  it('prevents duplicate credential submissions while the first request is pending', async () => {
    // A pending authentication request must not be submitted twice by double click.
    axios.post.mockReturnValue(new Promise(() => {}));
    mount(<Login {...loginProps()} />);
    await fillCredentials();
    await page.getByRole('button', { name: 'Login', exact: true }).last().click();
    const submit = document.querySelector('form button[type="submit"]');
    if (!submit.disabled) await page.getByRole('button', { name: 'Login', exact: true }).last().click();
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  it('routes signup, Google auth and password recovery through their respective actions', async () => {
    const props = loginProps();
    mount(<Login {...props} />);
    await page.getByRole('button', { name: 'Sign up', exact: true }).first().click();
    await page.getByRole('button', { name: 'Sign up', exact: true }).last().click();
    expect(props.setCurrentLoginView).toHaveBeenCalledTimes(2);
    expect(props.setCurrentLoginView).toHaveBeenCalledWith('register');
    await page.getByRole('button', { name: 'Continue with Google' }).click();
    expect(props.signInWithGoogle).toHaveBeenCalledOnce();
    await expect.element(page.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', '/forgot_password');
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('honors hosted signup and Google-auth visibility settings', async () => {
    mount(<Login {...loginProps()} showSignupButton={false} showGoogleAuth={false} />);
    await expect.element(page.getByRole('button', { name: 'Sign up', exact: true })).not.toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Continue with Google' })).not.toBeInTheDocument();
    await expect.element(page.getByLabelText('Email', { exact: true })).toBeVisible();
  });
});

describe('account registration', () => {
  function props() { return { registerUserWithEmail: vi.fn(), registerWithGoogle: vi.fn(), setCurrentLoginView: vi.fn() }; }

  it('does not submit missing or malformed credentials', async () => {
    const handlers = props();
    mount(<Register {...handlers} />);
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    expect(handlers.registerUserWithEmail).not.toHaveBeenCalled();
    await fillCredentials('invalid');
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    expect(handlers.registerUserWithEmail).not.toHaveBeenCalled();
  });

  it.each([
    ['Jane.Example+film@Example.COM', 'jane_example_film'],
    ['___Jane___@Example.COM', 'jane'],
    [`${'x'.repeat(40)}@example.com`, 'x'.repeat(32)],
  ])('creates a safe username for %s without changing password contents', async (email, username) => {
    const handlers = props();
    mount(<Register {...handlers} />);
    await fillCredentials(email, ' Pass word ');
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    expect(handlers.registerUserWithEmail).toHaveBeenCalledWith({
      email: email.toLowerCase(), password: ' Pass word ', username,
      preferredLanguage: 'en', subscribeToWeeklyNewsletter: false,
    }, expect.any(Function));
    expect(localStorage.getItem('isPaymentPopupVisible')).toBe('true');
  });

  it('uses a fallback username for an email local part with no supported characters', async () => {
    const handlers = props();
    mount(<Register {...handlers} />);
    await fillCredentials('+++@example.com');
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    expect(handlers.registerUserWithEmail).toHaveBeenCalledWith(expect.objectContaining({ username: expect.stringMatching(/^user_[a-z0-9]+$/) }), expect.any(Function));
  });

  it('surfaces a rejected registration and clears its message when choosing Google', async () => {
    const handlers = props();
    handlers.registerUserWithEmail.mockImplementation((_payload, reject) => reject('Email already exists.'));
    mount(<Register {...handlers} />);
    await fillCredentials();
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect.element(page.getByRole('alert')).toHaveTextContent('An account with this email already exists. Please log in.');
    await page.getByRole('button', { name: 'Register with Google' }).click();
    await expect.element(page.getByRole('alert')).not.toBeInTheDocument();
    expect(handlers.registerWithGoogle).toHaveBeenCalledWith({ subscribeToWeeklyNewsletter: false });
  });

  it('allows returning to login and exposes safe external policy links', async () => {
    const handlers = props();
    mount(<Register {...handlers} />, 'light');
    await page.getByRole('button', { name: 'Login', exact: true }).first().click();
    expect(handlers.setCurrentLoginView).toHaveBeenCalledWith('login');
    for (const name of ['terms', 'privacy policy']) {
      await expect.element(page.getByRole('link', { name, exact: true })).toHaveAttribute('rel', 'noopener noreferrer');
      await expect.element(page.getByRole('link', { name, exact: true })).toHaveAttribute('target', '_blank');
    }
  });
});

describe('password recovery email', () => {
  it('submits a recovery request and shows success only after the server responds', async () => {
    let finish;
    axios.post.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    mount(<ForgotPassword setCurrentLoginView={vi.fn()} />);
    await page.getByPlaceholder('Email', { exact: true }).fill('jane@example.com');
    await page.getByRole('button', { name: 'Reset Password' }).click();
    expect(axios.post).toHaveBeenCalledWith(expect.stringMatching(/\/users\/forgot_password$/), { email: 'jane@example.com', language: 'en' });
    await expect.element(page.getByText('Check your email for password reset instructions.')).not.toBeInTheDocument();
    finish({ data: {} });
    await expect.element(page.getByText('Check your email for password reset instructions.')).toBeVisible();
  });

  it('replaces a failed request with success when a retry succeeds', async () => {
    axios.post.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: {} });
    mount(<ForgotPassword setCurrentLoginView={vi.fn()} />);
    await page.getByPlaceholder('Email', { exact: true }).fill('jane@example.com');
    await page.getByRole('button', { name: 'Reset Password' }).click();
    await expect.element(page.getByText('Failed to send reset email. Please try again.')).toBeVisible();
    await page.getByRole('button', { name: 'Reset Password' }).click();
    await expect.element(page.getByText('Check your email for password reset instructions.')).toBeVisible();
    await expect.element(page.getByText('Failed to send reset email. Please try again.')).not.toBeInTheDocument();
  });

  it('rejects a blank recovery email without contacting the server', async () => {
    axios.post.mockResolvedValue({ data: {} });
    mount(<ForgotPassword setCurrentLoginView={vi.fn()} />);
    await page.getByRole('button', { name: 'Reset Password' }).click();
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('returns to login without submitting the recovery form', async () => {
    const back = vi.fn();
    mount(<ForgotPassword setCurrentLoginView={back} />);
    await page.getByRole('link', { name: 'Back to Login' }).click();
    expect(back).toHaveBeenCalledWith('login');
    expect(axios.post).not.toHaveBeenCalled();
  });
});
