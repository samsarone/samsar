import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsPanelContent from '../../src/components/account/SettingsPanelContent.jsx';
import LanguageSelect from '../../src/components/common/LanguageSelect.jsx';
import { LocalizationProvider } from '../../src/contexts/LocalizationContext.jsx';
import { getUiLanguage, setUiLanguage, translateText, translateKey } from '../../src/utils/localization.js';

const profile = vi.hoisted(() => ({ user: null, update: vi.fn(), googleSpeakers: [] }));
vi.mock('../../src/contexts/UserContext.jsx', () => ({ useUser: () => ({ user: profile.user }) }));
vi.mock('../../src/contexts/ColorMode.jsx', () => ({ useColorMode: () => ({ colorMode: 'dark' }) }));
vi.mock('../../src/hooks/useGoogleTTSSpeakers.js', () => ({ useGoogleTTSSpeakers: () => ({ googleSpeakers: profile.googleSpeakers }), fetchGoogleTTSPreviewBlobUrl: vi.fn() }));
vi.mock('../../src/hooks/useAudioProviderAvailability.js', () => ({ useAudioProviderAvailability: () => ({ audioAvailability: null }) }));

function Settings({ visible = true }) {
  return <MemoryRouter initialEntries={['/account/settings']}>
    <LocalizationProvider>
      <LanguageSelect />
      {visible && <section data-testid="settings"><SettingsPanelContent updateUserDetails={profile.update} /></section>}
    </LocalizationProvider>
  </MemoryRouter>;
}
const settingsPicker = () => within(screen.getByTestId('settings')).getByRole('combobox', { name: translateKey('account.preferredLanguageLabel') });
const choose = (language) => fireEvent.change(settingsPicker(), { target: { value: language } });
function expectSelection(language) {
  expect(settingsPicker()).toHaveValue(language);
  expect(getUiLanguage()).toBe(language);
  expect(document.documentElement.lang).toBe(language);
  expect(localStorage.getItem('preferredLanguage')).toBe(language);
  expect(screen.getByRole('heading', { name: translateText('Settings'), exact: true })).toBeVisible();
}

export function settingsLanguageTests() {
  beforeEach(() => {
    setUiLanguage('en');
    profile.user = { _id: 'account-1', username: 'person', preferredLanguage: 'en' };
    profile.update.mockReset();
  });
  afterEach(() => { act(() => setUiLanguage('en')); });

  describe('account language picker synchronization', () => {
    it('keeps the live selection after an unrelated profile refresh and switches back to English', () => {
      const view = render(<Settings />);
      choose('th');
      expectSelection('th');
      profile.user = { ...profile.user, generationCredits: 100 };
      view.rerender(<Settings />);
      expectSelection('th');
      choose('en');
      expectSelection('en');
      expect(profile.update).not.toHaveBeenCalled();
    });

    it('shows the current language when settings is reopened and saves that same language', () => {
      const view = render(<Settings />);
      choose('th');
      view.rerender(<Settings visible={false} />);
      view.rerender(<Settings />);
      expectSelection('th');
      choose('en');
      expectSelection('en');
      fireEvent.click(screen.getByRole('button', { name: translateKey('account.updateButton'), exact: true }));
      expect(profile.update).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ preferredLanguage: 'en' }));
    });

    it('stays synchronized with another language picker in both directions', () => {
      render(<Settings />);
      fireEvent.change(screen.getByRole('combobox', { name: translateText('Language') }), { target: { value: 'ja' } });
      expectSelection('ja');
      choose('th');
      expect(screen.getByRole('combobox', { name: translateText('Language') })).toHaveValue('th');
      expectSelection('th');
      choose('en');
      expectSelection('en');
    });

    it('displays a saved preference and keeps a new selection through its save response', () => {
      profile.user.preferredLanguage = 'th';
      const view = render(<Settings />);
      expectSelection('th');
      choose('ja');
      fireEvent.click(screen.getByRole('button', { name: translateKey('account.updateButton'), exact: true }));
      expect(profile.update).toHaveBeenCalledWith(expect.objectContaining({ preferredLanguage: 'ja' }));
      profile.user = { ...profile.user, preferredLanguage: 'ja' };
      view.rerender(<Settings />);
      expectSelection('ja');
      choose('en');
      expectSelection('en');
    });
  });
}
