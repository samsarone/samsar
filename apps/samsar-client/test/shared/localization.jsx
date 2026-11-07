import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalizationProvider } from '../../src/contexts/LocalizationContext.jsx';
import { useUiLanguage } from '../../src/hooks/useUiLanguage.js';
import LanguageSelect from '../../src/components/common/LanguageSelect.jsx';
import SingleSelect from '../../src/components/common/SingleSelect.jsx';
import ModelAdapterSelect from '../../src/components/common/ModelAdapterSelect.jsx';
import LibraryHome from '../../src/components/library/LibraryHome.jsx';
import { ASSISTANT_MODEL_TYPES } from '../../src/constants/Types.ts';
import Login from '../../src/components/auth/Login.tsx';
import Register from '../../src/components/auth/Register.tsx';
import ForgotPassword from '../../src/components/auth/ForgotPassword.jsx';
import ForgotPasswordPage from '../../src/components/auth/pages/ForgotPasswordPage.jsx';
import ResetPasswordPage from '../../src/components/auth/pages/ResetPasswordPage.jsx';
import { getUiLanguage, setUiLanguage, translateText as tx } from '../../src/utils/localization.js';

vi.mock('../../src/components/common/OverflowContainer.tsx', () => ({ default: ({ children }) => <main>{children}</main> }));
vi.mock('../../src/components/library/image/ImageLibraryHome', () => ({ default: () => <div data-testid="image-library" /> }));
vi.mock('../../src/components/library/audio/MusicLibraryHome', () => ({ default: () => <div data-testid="audio-library" /> }));
vi.mock('../../src/components/library/video/VideoLibraryHome', () => ({ default: () => <div data-testid="video-library" /> }));

const boundary = vi.hoisted(() => ({ post: vi.fn(), user: null }));
vi.mock('axios', () => ({ default: { post: boundary.post } }));
vi.mock('../../src/contexts/UserContext.jsx', () => ({ useUser: () => ({ user: boundary.user }) }));
vi.mock('../../src/contexts/ColorMode.jsx', () => ({ useColorMode: () => ({ colorMode: 'dark' }) }));

const providers = (children, route = '/') => <MemoryRouter initialEntries={[route]}><LocalizationProvider>{children}</LocalizationProvider></MemoryRouter>;
const changeLanguage = (language) => fireEvent.change(screen.getByRole('combobox', { name: tx('Language') }), { target: { value: language } });
const expectLanguages = () => expect([...screen.getByRole('combobox', { name: tx('Language') }).options].map((option) => option.value)).toEqual(['en', 'th', 'ja']);

export function localizationInteractionTests() {
  beforeEach(() => { boundary.post.mockReset(); boundary.user = null; setUiLanguage('en'); });
  afterEach(() => { act(() => setUiLanguage('en')); });

  describe('localized authentication and selection', () => {
    it('updates login labels, accessibility, and existing errors without losing input or sending requests', async () => {
      boundary.post.mockRejectedValue({ response: { data: { message: 'Invalid email or password. Please try again.' } } });
      const view = render(providers(<Login setCurrentLoginView={vi.fn()} />));
      const email = screen.getByLabelText('Email', { exact: true });
      const password = screen.getByLabelText('Password', { exact: true });
      fireEvent.change(email, { target: { value: 'person@example.com' } });
      fireEvent.change(password, { target: { value: 'private draft' } });
      for (const language of ['th', 'ja', 'en']) {
        changeLanguage(language);
        expectLanguages();
        expect(document.documentElement.lang).toBe(language);
        expect(localStorage.getItem('preferredLanguage')).toBe(language);
        expect(screen.getByRole('heading', { name: tx('Welcome back') })).toBeVisible();
        expect(screen.getByLabelText(tx('Email'), { exact: true })).toBe(email);
        expect(email.value).toBe('person@example.com');
        expect(password.value).toBe('private draft');
        expect(screen.getByRole('link', { name: tx('Forgot password?') })).toBeVisible();
      }
      expect(boundary.post).not.toHaveBeenCalled();
      fireEvent.submit(view.container.querySelector('form'));
      await screen.findByRole('alert');
      changeLanguage('ja');
      expect(screen.getByRole('alert')).toHaveTextContent(tx('Invalid email or password. Please try again.'));
      expect(boundary.post).toHaveBeenCalledTimes(1);
    });

    it.each(['en', 'th', 'ja'])('registers with the selected %s locale and localized consent and errors', (language) => {
      const register = vi.fn((_payload, onError) => onError('Email already exists'));
      render(providers(<Register registerUserWithEmail={register} />));
      changeLanguage(language);
      expectLanguages();
      expect(screen.getByRole('heading', { name: tx('Create account') })).toBeVisible();
      expect(screen.getByRole('link', { name: tx('privacy policy') })).toBeVisible();
      fireEvent.change(screen.getByLabelText(tx('Email'), { exact: true }), { target: { value: 'Person@Example.com' } });
      fireEvent.change(screen.getByLabelText(tx('Password'), { exact: true }), { target: { value: 'private draft' } });
      fireEvent.submit(document.querySelector('form'));
      expect(register).toHaveBeenCalledWith(expect.objectContaining({ email: 'person@example.com', password: 'private draft', preferredLanguage: language }), expect.any(Function));
      expect(screen.getByRole('alert')).toHaveTextContent(tx('An account with this email already exists. Please log in.'));
    });

    it.each([['page', ForgotPasswordPage], ['dialog', ForgotPassword]])('localizes %s password recovery and keeps the result in sync with language changes', async (_name, Component) => {
      boundary.post.mockResolvedValue({ data: {} });
      render(providers(<Component setCurrentLoginView={vi.fn()} />));
      changeLanguage('th');
      expectLanguages();
      fireEvent.change(screen.getByLabelText(tx('Email'), { exact: true }), { target: { value: 'person@example.com' } });
      fireEvent.submit(document.querySelector('form'));
      await waitFor(() => expect(boundary.post).toHaveBeenCalledWith(expect.stringMatching(/forgot_password$/), { email: 'person@example.com', language: 'th' }));
      await screen.findByText(tx('Check your email for password reset instructions.'));
      changeLanguage('ja');
      expect(screen.getByText(tx('Check your email for password reset instructions.'))).toBeVisible();
      expect(boundary.post).toHaveBeenCalledTimes(1);
    });

    it('honors a Japanese reset-link locale and retranslates validation without discarding passwords', () => {
      render(providers(<ResetPasswordPage />, '/reset_password?email=person@example.com&code=code&lang=ja-JP'));
      expect(getUiLanguage()).toBe('ja');
      expectLanguages();
      const password = screen.getByLabelText(tx('New password'), { exact: true });
      fireEvent.change(password, { target: { value: 'one password' } });
      fireEvent.change(screen.getByLabelText(tx('Confirm new password'), { exact: true }), { target: { value: 'another password' } });
      fireEvent.submit(document.querySelector('form'));
      expect(screen.getByText(tx('Passwords do not match'))).toBeVisible();
      changeLanguage('th');
      expect(password.value).toBe('one password');
      expect(screen.getByText(tx('Passwords do not match'))).toBeVisible();
      expect(boundary.post).not.toHaveBeenCalled();
    });

    it('normalizes a removed account language to English', () => {
      boundary.user = { preferredLanguage: 'fr' };
      setUiLanguage('th');
      render(providers(<LanguageSelect />));
      expect(getUiLanguage()).toBe('en');
      expectLanguages();
    });

    it('refreshes a selected dropdown label while preserving its machine value', () => {
      const options = [{ value: 'all', get label() { return tx('All'); } }, { value: 'pending', get label() { return tx('Pending'); } }];
      function Picker() {
        useUiLanguage();
        const [selected, setSelected] = useState({ value: 'all', label: 'All' });
        return <><LanguageSelect /><SingleSelect aria-label={tx('Status')} options={options} value={selected} onChange={setSelected} /><output>{selected.value}</output></>;
      }
      render(providers(<Picker />));
      changeLanguage('ja');
      expect(screen.getByText(tx('All'), { exact: true })).toBeVisible();
      expect(screen.getByRole('status')).toHaveTextContent('all');
      fireEvent.focus(screen.getByRole('combobox', { name: tx('Status') }));
      expect(document.body.textContent).not.toContain('Use Up and Down');
    });

    it('translates library tabs while preserving navigation across language changes', () => {
      render(providers(<><LanguageSelect /><LibraryHome resetImageLibrary={vi.fn()} /></>));
      changeLanguage('th');
      fireEvent.click(screen.getByRole('tab', { name: tx('Audio'), exact: true }));
      expect(screen.getByTestId('audio-library')).toBeInTheDocument();
      changeLanguage('ja');
      expect(screen.getByRole('tab', { name: tx('Audio'), exact: true })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByText(tx('Audio Library'), { exact: true })).toBeVisible();
      fireEvent.click(screen.getByRole('tab', { name: tx('Video'), exact: true }));
      expect(screen.getByTestId('video-library')).toBeInTheDocument();
    });

    it('translates static model option labels without changing selected model identifiers', () => {
      const onChange = vi.fn();
      function ModelPicker() {
        useUiLanguage();
        return <><LanguageSelect /><ModelAdapterSelect
          aria-label={tx('Assistant model')} hostedControl="native"
          options={ASSISTANT_MODEL_TYPES} value={ASSISTANT_MODEL_TYPES.find((option) => option.value === 'gpt-6-astra')}
          onChange={onChange}
        /></>;
      }
      render(providers(<ModelPicker />));
      for (const language of ['th', 'ja', 'en']) {
        changeLanguage(language);
        const picker = screen.getByRole('combobox', { name: tx('Assistant model') });
        expect(picker.value).toBe('gpt-6-astra');
        expect(picker.selectedOptions[0].textContent).toBe(tx('GPT 6 Astra High'));
      }
      expect(onChange).not.toHaveBeenCalled();
    });
  });
}
