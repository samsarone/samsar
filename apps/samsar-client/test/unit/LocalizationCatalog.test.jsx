import { describe, expect, it, vi, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { checkLocalization } from '../../scripts/check-localization.mjs';
import { SUPPORTED_LANGUAGES } from '../../src/constants/supportedLanguages.js';
import { translations } from '../../src/constants/translations.js';
import messages from '../../src/locales/messages.json';
import { formatUiDate, formatUiNumber, formatUiStatus, getInitialUiLanguage, getUiLanguage, normalizeUiLanguage, setUiLanguage, subscribeUiLanguage, translateText, translateKey } from '../../src/utils/localization.js';

afterEach(() => setUiLanguage('en'));

describe('complete UI localization', () => {
  it('requires translations, matching placeholders, and explicit localization of visible source copy', () => {
    expect(checkLocalization()).toEqual([]);
    expect(SUPPORTED_LANGUAGES.map(({ code }) => code)).toEqual(['en', 'th', 'ja']);
  });

  it('resolves every legacy semantic key from the complete catalog', () => {
    function walk(node, prefix = '') {
      for (const [key, value] of Object.entries(node)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'object') walk(value, fullKey);
        else for (const language of ['en', 'th', 'ja']) {
          expect(translateKey(fullKey, {}, undefined, language), `${language}:${fullKey}`).toBe(messages[value][language]);
        }
      }
    }
    walk(translations.en);
  });

  it.each([['en-US', 'en'], ['th_TH', 'th'], ['ja-JP', 'ja'], ['JP', 'ja'], ['ไทย', 'th'], ['French', 'en'], ['zh', 'en'], ['auto', 'en'], [null, 'en']])('normalizes %j to %s', (value, expected) => expect(normalizeUiLanguage(value)).toBe(expected));

  it('loads a saved preference and remains usable when storage is unavailable', () => {
    localStorage.setItem('preferredLanguage', 'ja-JP');
    expect(getInitialUiLanguage()).toBe('ja');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw Error('disabled'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('disabled'); });
    expect(() => getInitialUiLanguage()).not.toThrow();
    setUiLanguage('th');
    expect(getUiLanguage()).toBe('th');
    expect(document.documentElement.lang).toBe('th');
  });

  it('notifies subscribers once per change and cleans up subscriptions', () => {
    setUiLanguage('en');
    const callback = vi.fn();
    const unsubscribe = subscribeUiLanguage(callback);
    setUiLanguage('ja'); setUiLanguage('ja');
    expect(callback).toHaveBeenCalledTimes(1);
    unsubscribe(); setUiLanguage('th');
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('preserves zero, user text, and React icons during interpolation', () => {
    expect(translateText('Images: {value0}', { value0: 0 }, 'ja')).toBe('画像: 0');
    expect(translateText('Session: {value0}', { value0: 'My English project' }, 'th')).toContain('My English project');
    const result = translateText('{value0} Generate', { value0: createElement('span', { 'data-icon': true }, 'icon') }, 'ja');
    expect(renderToStaticMarkup(createElement('button', null, result))).toContain('data-icon="true"');
    expect(renderToStaticMarkup(createElement('button', null, result))).not.toContain('[object Object]');
  });

  it('formats numbers, dates, and status without caching the previous locale', () => {
    for (const language of ['en', 'th', 'ja']) {
      setUiLanguage(language);
      const locale = { en: 'en-US', th: 'th-TH', ja: 'ja-JP' }[language];
      expect(formatUiNumber(1234.5)).toBe(new Intl.NumberFormat(locale).format(1234.5));
      expect(formatUiDate('2026-11-07', { month: 'long' })).toBe(new Intl.DateTimeFormat(locale, { month: 'long' }).format(new Date('2026-11-07')));
      expect(formatUiStatus('COMPLETED')).toBe(messages.Completed[language]);
    }
    expect(formatUiDate('invalid')).toBe('—');
  });
});
