# UI localization

The client supports **English (`en`), Thai (`th`), and Japanese (`ja`)**. The language control appears on authentication forms as well as in the workspace. `JP` and regional Japanese locales normalize to `ja`; unsupported saved preferences normalize to English. Speech and subtitle pickers use the same three supported languages, with automatic speech-language detection where applicable.

`src/locales/messages.json` contains the English source messages and their complete Thai and Japanese translations. `src/constants/translations.js` retains the existing semantic keys and resolves them from that same catalog. Brand names, model identifiers, font names, and file-format names that intentionally stay unchanged are listed in `src/locales/invariants.json`.

Use `useLocalization().tx(source, parameters)` in components or `translateText(source, parameters)` in display helpers. Components using display helpers subscribe with `useUiLanguage()` so changing the language rerenders text without remounting forms or editors. Keep data-fetching callbacks independent of that subscription. Resolve static option labels through getters or inside render, rather than translating once during module initialization.

Translate complete messages with named placeholders. Keep API keys, model values, route names, prompts, generated content, and user-supplied names unchanged. Use `formatUiDate` and `formatUiNumber` for displayed dates and numbers. Authentication errors are stored as source messages and translated when rendered, so changing languages also updates existing validation results.

When adding or changing UI copy:

1. Add the complete English source and both translations to `messages.json`.
2. Preserve every interpolation placeholder in both translations.
3. Localize visible text, accessibility labels, placeholders, tooltips, option labels, validation, and empty/loading states.
4. Run `npm run test:i18n` and the relevant component tests. The catalog guard also runs in the unit suite and rejects missing translations, unexpected English fallbacks, mismatched placeholders, and hardcoded JSX text/labels.
5. Run `npm run test:browser -- test/browser/LocalizationInteractions.test.jsx` for authentication and language-switching checks in headless Chromium. Install the required browser with `npm run test:browser:install` if needed.

The authentication tests verify all three languages, recovery/reset flows, translated validation, persisted preferences, preserved form input, unchanged request identifiers, and no extra requests when changing languages. Custom dropdowns also provide localized screen-reader announcements.
