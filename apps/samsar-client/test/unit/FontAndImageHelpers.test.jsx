import { describe, expect, it } from 'vitest';
import { getFontFamilyForLanguage } from '../../src/utils/language.jsx';
import { getFontOptionsForLanguage, mergeFontPreferencesWithDefaults } from '../../src/constants/fontPreferences.js';
import { SUPPORTED_LANGUAGES, resolveLanguageCode } from '../../src/constants/supportedLanguages.js';
import { getRenderableImageUrl } from '../../src/utils/image.jsx';

describe('language resolution and font selection', () => {
  it.each([
    ['eng', 'Times New Roman'], ['spa', 'Arial'], ['fre', 'Arial'], ['deu', 'Arial'],
    ['ita', 'Arial'], ['por', 'Arial'], ['rus', 'Arial'], ['zho', 'SimHei'],
    ['jpn', 'MS Gothic'], ['kor', 'Malgun Gothic'], ['unknown', 'Arial'], [undefined, 'Arial'],
  ])('uses a compatible export font for %s', (language, font) => {
    expect(getFontFamilyForLanguage(language)).toBe(font);
  });

  it.each([
    [' English ', 'en'], ['Español', 'auto'], ['日本語', 'ja'], ['JP', 'ja'],
    ['cn', 'auto'], ['zh_CN', 'auto'], ['en-US', 'en'], ['বাংলা', 'auto'], ['ไทย', 'th'], ['th-TH', 'th'], ['AUTO', 'auto'],
    ['', 'auto'], [null, 'auto'], ['Klingon', 'auto'],
  ])('resolves locale or display name %j into %s', (source, expected) => {
    expect(resolveLanguageCode(source)).toBe(expected);
  });

  it('honors an explicit fallback for an unrecognized language', () => {
    expect(resolveLanguageCode('xx', 'en')).toBe('en');
    expect(resolveLanguageCode(null, 'ja')).toBe('ja');
  });

  it.each([
    ['en-US', 'Poppins'], ['FR', 'Poppins'], ['es', 'Rampart One'], ['de', 'Rampart One'],
    ['pt', 'Rampart One'], ['it', 'Rampart One'], ['nl', 'Rampart One'], ['sv', 'Rampart One'],
    ['ru', 'Arial'], ['jp', 'Noto Sans JP'], ['ja-JP', 'Noto Sans JP'],
    ['ko', 'Noto Sans KR'], ['th', 'Sarabun'], ['ar', 'Noto Sans Arabic'],
    ['hi', 'Noto Sans Devanagari'], ['bn', 'Noto Sans Bengali'], ['sa', 'Noto Sans Devanagari'],
    ['he', 'Noto Sans Hebrew'], ['cn', 'Noto Sans SC'], ['zh-hans', 'Noto Sans SC'],
    ['zh-hant', 'Noto Sans TC'], ['zh-tw', 'Noto Sans TC'], ['zh-cn', 'Noto Sans SC'],
    [undefined, 'Rampart One'], [null, 'Rampart One'], ['', 'Rampart One'], ['xx', 'Rampart One'],
  ])('offers a script-compatible first font for %j', (language, firstFont) => {
    const fonts = getFontOptionsForLanguage(language);
    expect(fonts[0]).toBe(firstFont);
    expect(fonts.at(-1)).toBe('sans-serif');
  });

  it.each([undefined, null, 'invalid', 7])('builds defaults for all supported languages from %j', (input) => {
    const result = mergeFontPreferencesWithDefaults(input);
    for (const language of SUPPORTED_LANGUAGES) {
      expect(result[language.code]).toEqual({
        expressGenerationTextFont: getFontOptionsForLanguage(language.code)[0],
        expressGenerationSpeakerFont: getFontOptionsForLanguage(language.code)[0],
      });
    }
  });

  it('normalizes aliases, trims saved fonts, and does not discard defaults for blank entries', () => {
    const input = {
      ' JP ': { expressGenerationTextFont: ' Yu Gothic ', expressGenerationSpeakerFont: '' },
      en: { expressGenerationTextFont: 4, expressGenerationSpeakerFont: ' Montserrat ' },
      th: null,
      bn: false,
      ' ': { expressGenerationTextFont: 'invalid' },
      xx: { expressGenerationTextFont: 'Custom Font' },
    };
    const copy = structuredClone(input);
    expect(mergeFontPreferencesWithDefaults(input)).toMatchObject({
      ja: { expressGenerationTextFont: 'Yu Gothic', expressGenerationSpeakerFont: 'Noto Sans JP' },
      en: { expressGenerationTextFont: 'Poppins', expressGenerationSpeakerFont: 'Montserrat' },
      th: { expressGenerationTextFont: 'Sarabun' },
      xx: { expressGenerationTextFont: 'Custom Font' },
    });
    expect(input).toEqual(copy);
    expect(mergeFontPreferencesWithDefaults(input)).not.toHaveProperty(' ');
  });

  it('returns fresh preference objects so local changes cannot overwrite future defaults', () => {
    const first = mergeFontPreferencesWithDefaults();
    first.en.expressGenerationTextFont = 'Changed';
    expect(mergeFontPreferencesWithDefaults().en.expressGenerationTextFont).toBe('Poppins');
  });
});

describe('image source fallbacks', () => {
  it.each([null, undefined, {}, { src: false }, ''])('has no image URL for %j', (input) => {
    expect(getRenderableImageUrl(input, '')).toBe('');
  });

  it.each(['preview_url', 'signedUrl', 'signed_url', 'displayUrl', 'display_url', 'url', 'imageUrl', 'image_url', 'src', 'image'])
    ('accepts %s while skipping blank and nonstring preferred fields', (field) => {
      expect(getRenderableImageUrl({ previewUrl: ' ', [field]: ' /assets/image.png ' }, 'https://api.test///'))
        .toBe('https://api.test/assets/image.png');
    });

  it.each([
    ['plain.png', '/plain.png'],
    ['generations/result.png', '/generations/result.png'],
    ['outpaint/result.png', '/generations/outpaint/result.png'],
    ['/assets_v2/result.png', '/assets_v2/result.png'],
    ['/video_sessions/guest_media?id=1', '/video_sessions/guest_media?id=1'],
  ])('normalizes %s without requiring a configured API origin', (input, expected) => {
    expect(getRenderableImageUrl(input, null)).toBe(expected);
  });

  it('does not rewrite non-asset CDN paths or malformed escaped paths', () => {
    for (const url of ['https://static.samsar.one/public/logo.png', 'https://static.samsar.one/assets/%XX.png']) {
      expect(getRenderableImageUrl(url, 'https://api.test')).toBe(url);
    }
  });

  it('preserves policy-signed CDN links and rewrites incomplete signatures through the API', () => {
    const url = 'https://static.samsar.one/assets/a.png?Policy=p&Signature=s&Key-Pair-Id=k';
    expect(getRenderableImageUrl(url, 'https://api.test')).toBe(url);
    expect(getRenderableImageUrl('https://static.samsar.one/assets/a.png?Signature=s', 'https://api.test'))
      .toBe('https://api.test/assets/a.png?Signature=s');
  });
});
