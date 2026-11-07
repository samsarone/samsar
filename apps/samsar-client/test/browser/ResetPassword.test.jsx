import { render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import ResetPasswordPage from '../../src/components/auth/pages/ResetPasswordPage.jsx';
import { ColorModeProvider } from '../../src/contexts/ColorMode.jsx';

vi.mock('axios', () => ({ default: { post: vi.fn() } }));
// The page shell has unrelated authenticated navigation and session creation;
// the password-reset form and its router are rendered without replacing them.
vi.mock('../../src/components/common/OverflowContainer.tsx', () => ({ default: ({ children }) => <main>{children}</main> }));

beforeEach(() => { axios.post.mockReset(); });

function mount(query = '?email=jane%40example.com&code=reset-code&lang=en', theme = 'dark') {
  localStorage.setItem('colorMode', theme);
  return render(<ColorModeProvider><MemoryRouter initialEntries={[`/reset_password${query}`]}>
    <Routes>
      <Route path='/reset_password' element={<ResetPasswordPage />} />
      <Route path='/login' element={<h1>Login destination</h1>} />
    </Routes>
  </MemoryRouter></ColorModeProvider>);
}

async function passwords(password = 'new-secret', confirmation = password) {
  const fields = document.querySelectorAll('input[type="password"]');
  await page.elementLocator(fields[0]).fill(password);
  await page.elementLocator(fields[1]).fill(confirmation);
}

describe('password reset', () => {
  it('prefills the email from the link and keeps the initial form editable', async () => {
    mount();
    await expect.element(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
    await expect.element(page.getByRole('textbox', { name: 'Email', exact: true })).toHaveValue('jane@example.com');
    await expect.element(page.getByRole('button', { name: 'Reset password', exact: true })).toBeEnabled();
    await expect.element(page.getByRole('button', { name: 'Send new reset email' })).not.toBeInTheDocument();
  });

  it('does not send mismatched passwords to the server', async () => {
    mount();
    await passwords('first-secret', 'different-secret');
    await page.getByRole('button', { name: 'Reset password', exact: true }).click();
    await expect.element(page.getByText('Passwords do not match', { exact: true })).toBeVisible();
    expect(axios.post).not.toHaveBeenCalled();
  });

  it.each([
    ['?code=reset-code&lang=en', 'Email is required'],
    ['?email=jane%40example.com&code=reset-code&lang=en', 'New password is required'],
  ])('checks missing fields for %s', async (query, message) => {
    mount(query);
    await page.getByRole('button', { name: 'Reset password', exact: true }).click();
    await expect.element(page.getByText(message, { exact: true })).toBeVisible();
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('rejects a missing reset code and provides a route to request another', async () => {
    mount('?email=jane%40example.com&lang=en');
    await expect.element(page.getByText('Reset code is missing or invalid', { exact: true })).toBeVisible();
    await passwords();
    await page.getByRole('button', { name: 'Reset password', exact: true }).click();
    expect(axios.post).not.toHaveBeenCalled();
    await expect.element(page.getByRole('button', { name: 'Send new reset email' })).toBeEnabled();
  });

  it('disables repeat submissions, sends the token and password, then redirects after success', async () => {
    let resolveRequest;
    axios.post.mockReturnValue(new Promise((resolve) => { resolveRequest = resolve; }));
    mount();
    await page.getByRole('textbox', { name: 'Email', exact: true }).fill('other@example.com');
    await passwords(' new private secret ');
    await page.getByRole('button', { name: 'Reset password', exact: true }).click();
    await expect.element(page.getByRole('button', { name: 'Submitting...' })).toBeDisabled();
    expect(axios.post).toHaveBeenCalledWith(expect.stringMatching(/\/users\/submit_reset_password$/), {
      email: 'other@example.com', code: 'reset-code', password: ' new private secret ',
    });
    resolveRequest({ data: {} });
    await expect.element(page.getByText('Password updated! Redirecting to login...')).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Reset password', exact: true })).not.toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('h1')).toHaveTextContent('Login destination'), { timeout: 3500 });
  });

  it.each([
    [{ response: { data: { error: 'Reset token expired' } } }, 'Reset code is missing or invalid', true],
    [{ response: { data: { message: 'Invalid reset link' } } }, 'Reset code is missing or invalid', true],
    [new Error('offline'), 'Something went wrong', false],
  ])('renders actionable request errors and re-enables the form', async (error, message, resendAvailable) => {
    axios.post.mockRejectedValue(error);
    mount();
    await passwords();
    await page.getByRole('button', { name: 'Reset password', exact: true }).click();
    await expect.element(page.getByText(message, { exact: true })).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Reset password', exact: true })).toBeEnabled();
    if (resendAvailable) await expect.element(page.getByRole('button', { name: 'Send new reset email' })).toBeVisible();
    else await expect.element(page.getByRole('button', { name: 'Send new reset email' })).not.toBeInTheDocument();
  });

  it('requires an email to resend a reset link', async () => {
    mount('?lang=en');
    await page.getByRole('button', { name: 'Send new reset email' }).click();
    await expect.element(page.getByText('Email is required', { exact: true })).toBeVisible();
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('shows pending and success states for a replacement email', async () => {
    let finish;
    axios.post.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    mount('?email=jane%40example.com&lang=en');
    await page.getByRole('button', { name: 'Send new reset email' }).click();
    await expect.element(page.getByRole('button', { name: 'Submitting...' })).toBeDisabled();
    expect(axios.post).toHaveBeenCalledWith(expect.stringMatching(/\/users\/forgot_password$/), { email: 'jane@example.com', language: 'en' });
    finish({ data: {} });
    await expect.element(page.getByText('If this email exists, a new reset link has been sent.')).toBeVisible();
    await expect.element(page.getByText('Reset code is missing or invalid', { exact: true })).not.toBeInTheDocument();
  });

  it('keeps the resend action retryable after a network failure', async () => {
    axios.post.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: {} });
    mount('?email=jane%40example.com&lang=en', 'light');
    await page.getByRole('button', { name: 'Send new reset email' }).click();
    await expect.element(page.getByText('Unable to send reset email. Please try again.')).toBeVisible();
    await page.getByRole('button', { name: 'Send new reset email' }).click();
    await expect.element(page.getByText('If this email exists, a new reset link has been sent.')).toBeVisible();
    await expect.element(page.getByText('Unable to send reset email. Please try again.')).not.toBeInTheDocument();
  });

  it('changes language through the real select and persists the preference', async () => {
    mount();
    await page.getByRole('combobox').selectOptions('ja');
    await expect.element(page.getByRole('heading', { name: 'パスワードを再設定' })).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'パスワードを再設定', exact: true })).toBeVisible();
    expect(localStorage.getItem('preferredLanguage')).toBe('ja');
    await page.getByRole('combobox').selectOptions('th');
    await expect.element(page.getByRole('heading', { name: 'รีเซ็ตรหัสผ่านของคุณ' })).toBeVisible();
  });

  it('falls back to English for unsupported reset-link languages', async () => {
    mount('?email=jane%40example.com&code=reset-code&lang=fr');
    await expect.element(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
    expect(localStorage.getItem('preferredLanguage')).toBe('en');
  });

  it('provides accessible names for the reset-password inputs', async () => {
    // The labels must be programmatically associated, including password fields
    // which cannot otherwise be reliably located by assistive technology.
    mount();
    expect(document.querySelector('input[type="email"]').labels.length).toBeGreaterThan(0);
    for (const field of document.querySelectorAll('input[type="password"]')) {
      expect(field.labels.length).toBeGreaterThan(0);
    }
  });
});
