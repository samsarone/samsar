# UI design tokens & typography

All tokens live in `src/index.css` (`@theme` block plus the `:root.dark, .theme-dark` overrides).
Each colour token has one light and one dark value, so a single class follows the active theme —
no `colorMode === 'dark' ? … : …` needed.

## Typefaces

| Role | Family | Files |
| --- | --- | --- |
| UI (`font-sans`, default) | Inter Variable (opsz + wght) | `src/fonts/inter-*.woff2` |
| Code / numbers (`font-mono`, `code`, `kbd`, `pre`) | JetBrains Mono Variable | `src/fonts/jetbrains-mono-*.woff2` |

Self-hosted (no CDN), SIL OFL — licences are next to the files. Non-Latin scripts (ja, zh, th, hi, bn…)
fall back to platform fonts exactly as before. Fonts are in `src/fonts/` because `.gitignore` ignores `assets/`.

## Type scale

Tailwind defaults stay (`text-xs` 12 · `text-sm` 14 · `text-base` 16 · `text-lg` 18 · `text-xl` 20 …). Added steps for dense UI
(font-size only; line-height inherits, matching the `text-[Npx]` values they replaced):

| Class | Size | Use |
| --- | --- | --- |
| `text-micro` | 10px | uppercase micro labels, badges (floor for text) |
| `text-caption` | 11px | helper text, meta, dense chrome |
| `text-label` | 13px | compact control labels |
| `text-lead` | 15px | emphasised body in dense panels |

To raise the readability floor app-wide later, change `--text-micro` / `--text-caption` in one place.

## Colour tokens

| Token | Dark | Light | Typical use |
| --- | --- | --- | --- |
| `canvas` | #0c0d12 | #d9e2f0 | page background, focus-ring offset |
| `surface` | #181b24 | #f3f6fb | panels |
| `surface-raised` | #20232e | #f3f6fb | cards inside panels |
| `surface-sunken` | #151720 | #f3f6fb | fields, wells |
| `surface-muted` | #20232e | #e6ebf5 | subdued blocks |
| `surface-hover` | #292d3a | slate-100 | hover fill |
| `line` / `line-strong` / `line-control` | #3a4050 / #4a5265 / #667188 | #cbd6e6 | borders |
| `fg` | #f4f6fb | slate-900 | primary text |
| `fg-body` | #f4f6fb | #3a4050 | body text |
| `fg-secondary` | #b6bfd0 | #3a4050 | secondary text |
| `fg-tertiary` | #a8b2c5 | slate-600 | tertiary text |
| `fg-muted` | #8b96aa | slate-500 | meta / helper text |
| `accent`, `accent-from/-to`, `accent-hover-from/-to` | scarlet #ff4655 → #ff6b4a | blue-500 → blue-600 | primary actions |
| `on-accent` | #080a10 | white | text on accent |
| `control-border`, `control-fg`, `control-fg-hover` | #667188, #b6bfd0, #f4f6fb | #cbd6e6, #3a4050, slate-900 | secondary buttons |
| `focus` | #ffe0a3 | #0369a1 | focus rings |
| `danger*`, `success`, `warning`, `highlight*` | — | — | status & emphasis |

Usage: `bg-surface border border-line text-fg`, `hover:bg-surface-hover`, `ring-focus/80 ring-offset-canvas`.
The `dark:` variant works with both `html.dark` and `body.theme-dark`.

The accent is still scarlet in dark mode and blue in light mode (unchanged). To unify the brand, change the
light `--color-accent*` values only.

## Buttons

`CommonButton` accepts optional `variant` (`primary` default · `secondary` · `ghost` · `danger`) and `size`
(`md` default · `sm` · `lg`). Existing call sites render as before. `SecondaryButton` now looks secondary in light mode
(it used to be the same blue as the primary button). `PrimaryPublicButton` tones `neutral`/`mint` render as outlined
secondary buttons in light mode.

## Migration notes

* A codemod collapsed 337 `colorMode` class ternaries (131 fully, 206 partially) into tokens, but only where the
  dark/light pair matched a token exactly. A computed-style comparison of 12 routes in both themes showed 0 differences.
* The legacy `!important` recolouring rules for `bg-slate-*`, `text-slate-*`, `bg-white`… in `index.css` are still in place.
  So are a few token rules that mirror them (marked "Token parity"). Retire both together once the remaining ternaries are migrated.
* `tailwind.config.js` is not loaded by Tailwind v4 (no `@config`) and its colours are unused. It can be deleted.

## Follow-ups

* Migrate the remaining ~480 `colorMode` ternaries (mostly bespoke hex values) file by file.
* Remove the global `.App { text-align: center }` (`src/App.css`) after adding explicit `text-center` where centring is intended.
* Raise the type floor (`--text-micro` → 11px, `--text-caption` → 12px) once the dense toolbars have been checked at the larger size.
