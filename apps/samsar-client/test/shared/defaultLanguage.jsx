import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LanguageSelect from '../../src/components/common/LanguageSelect.jsx';
import { LocalizationProvider } from '../../src/contexts/LocalizationContext.jsx';
import { getInitialUiLanguage, getUiLanguage, setUiLanguage, translateText } from '../../src/utils/localization.js';

const profile = vi.hoisted(() => ({ user: null }));
vi.mock('../../src/contexts/UserContext.jsx', () => ({ useUser: () => ({ user: profile.user }) }));

function browserLocales(languages, language = languages[0]) {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(languages);
  vi.spyOn(navigator, 'language', 'get').mockReturnValue(language);
}

export function defaultLanguageTests() {
  beforeEach(() => {
    profile.user = null;
    localStorage.removeItem('preferredLanguage');
  });
  afterEach(() => { act(() => setUiLanguage('en')); });

  describe('locale-based default UI language', () => {
    it.each([
      ['th-TH', 'th'], ['th_TH', 'th'], ['ja-JP', 'ja'], ['ja', 'ja'],
      ['en-GB', 'en'], ['fr-FR', 'en'], ['zh-CN', 'en'], ['de-DE', 'en'],
    ])('starts in %s as %s when there is no saved preference', (locale, expected) => {
      browserLocales([locale]);
      expect(getInitialUiLanguage()).toBe(expected);
    });

    it.each([
      [['fr-FR', 'th-TH', 'ja-JP'], 'th'],
      [['zh-CN', 'ja-JP', 'en-US'], 'ja'],
      [['en-GB', 'th-TH'], 'en'],
      [['ja-JP', 'th-TH'], 'ja'],
      [['fr-FR', 'de-DE'], 'en'],
    ])('respects the browser preference order %j', (locales, expected) => {
      browserLocales(locales);
      expect(getInitialUiLanguage()).toBe(expected);
    });

    it('uses the preferred-language list before the single-language fallback', () => {
      browserLocales(['th-TH', 'en-US'], 'en-US');
      expect(getInitialUiLanguage()).toBe('th');
    });

    it.each([[[]], [undefined]])('uses the primary locale when the language list is %j', (locales) => {
      browserLocales(locales, 'ja-JP');
      expect(getInitialUiLanguage()).toBe('ja');
    });

    it('defaults to English when browser locales are unavailable', () => {
      browserLocales([], undefined);
      expect(getInitialUiLanguage()).toBe('en');
    });

    it.each([['en', 'en'], ['ja-JP', 'ja'], ['fr', 'en']])('honors saved %s over the browser locale', (saved, expected) => {
      browserLocales(['th-TH']);
      localStorage.setItem('preferredLanguage', saved);
      expect(getInitialUiLanguage()).toBe(expected);
    });

    it('detects the locale when browser storage is disabled', () => {
      browserLocales(['fr-FR', 'ja-JP']);
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw Error('disabled'); });
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('disabled'); });
      expect(getInitialUiLanguage()).toBe('ja');
      expect(() => setUiLanguage(getInitialUiLanguage())).not.toThrow();
      expect(getUiLanguage()).toBe('ja');
    });

    it('shows the detected language and preserves an explicit switch to English on the next visit', () => {
      browserLocales(['fr-FR', 'th-TH']);
      setUiLanguage(getInitialUiLanguage());
      render(<LocalizationProvider><LanguageSelect /></LocalizationProvider>);
      expect(screen.getByRole('combobox', { name: translateText('Language') })).toHaveValue('th');
      expect(document.documentElement.lang).toBe('th');
      fireEvent.change(screen.getByRole('combobox', { name: translateText('Language') }), { target: { value: 'en' } });
      expect(getInitialUiLanguage()).toBe('en');
      expect(document.documentElement.lang).toBe('en');
    });

    it('honors a saved account preference after detecting the browser locale', () => {
      browserLocales(['th-TH']);
      setUiLanguage(getInitialUiLanguage());
      profile.user = { preferredLanguage: 'ja' };
      render(<LocalizationProvider><LanguageSelect /></LocalizationProvider>);
      expect(screen.getByRole('combobox', { name: translateText('Language') })).toHaveValue('ja');
      expect(getInitialUiLanguage()).toBe('ja');
    });
  });
}
