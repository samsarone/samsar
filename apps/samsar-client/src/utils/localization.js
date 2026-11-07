import { translations } from '../constants/translations.js';
import { resolveLanguageCode } from '../constants/supportedLanguages.js';
import messages from '../locales/messages.json' with { type: 'json' };
import { createElement, Fragment, isValidElement } from 'react';

export const normalizeUiLanguage = (value) => {
  const resolved = resolveLanguageCode(value, 'en');
  return resolved === 'auto' ? 'en' : resolved;
};

export const getInitialUiLanguage = () => {
  let saved;
  try { saved = globalThis.localStorage?.getItem('preferredLanguage'); } catch { /* Storage may be disabled. */ }
  if (saved) return normalizeUiLanguage(saved);

  // Match browser preferences in order; only use English as a fallback after
  // checking for supported languages. Explicit saved choices always win.
  const browser = globalThis.navigator;
  const locales = browser?.languages?.length ? browser.languages : [browser?.language];
  for (const locale of locales) {
    const language = resolveLanguageCode(locale, null);
    if (language && language !== 'auto') return language;
  }
  return 'en';
};

let currentLanguage = getInitialUiLanguage();
const listeners = new Set();
const sourceByTranslation = new Map(Object.entries(messages).flatMap(([source, values]) =>
  [values.th, values.ja].filter(Boolean).map((value) => [value, source])));
export const getUiLanguage = () => currentLanguage;
export const subscribeUiLanguage = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function persistUiLanguage(language) {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = language;
    document.documentElement.dir = 'ltr';
  }
  try { globalThis.localStorage?.setItem('preferredLanguage', language); } catch { /* Keep session usable. */ }
}

export function setUiLanguage(value) {
  const next = normalizeUiLanguage(value);
  persistUiLanguage(next);
  if (next === currentLanguage) return;
  currentLanguage = next;
  listeners.forEach((listener) => listener());
}

export function interpolate(template, params = {}) {
  if (typeof template !== 'string') return template;
  if (Object.values(params).some((value) => isValidElement(value) || Array.isArray(value))) {
    return template.split(/(\{\w+\})/g).map((part, index) => {
      const token = part.match(/^\{(\w+)\}$/)?.[1];
      return createElement(Fragment, { key: index }, token && Object.prototype.hasOwnProperty.call(params, token) ? params[token] : part);
    });
  }
  return template.replace(/\{(\w+)\}/g, (match, token) =>
    Object.prototype.hasOwnProperty.call(params, token) ? String(params[token] ?? '') : match);
}

// Source messages are explicit UI copy. Never pass generated content, names, prompts,
// API identifiers, or arbitrary server responses through this lookup.
export function translateText(source, params = {}, language = currentLanguage) {
  return interpolate(messages[source]?.[language] ?? source, params);
}

const resolveKey = (language, key) => key.split('.').reduce((value, part) =>
  value && Object.prototype.hasOwnProperty.call(value, part) ? value[part] : undefined,
translations[language]);

export function translateKey(key, params = {}, fallback, language = currentLanguage) {
  const source = resolveKey('en', key) ?? fallback ?? key;
  const translated = resolveKey(language, key);
  return interpolate(typeof translated === 'string' ? translated : translateText(source, {}, language), params);
}

export const getUiLocale = () => ({ en: 'en-US', th: 'th-TH', ja: 'ja-JP' }[currentLanguage]);

export const formatUiNumber = (value, options) => new Intl.NumberFormat(getUiLocale(), options).format(value);
export const formatUiDate = (value, options) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(getUiLocale(), options).format(date);
};

// API status identifiers stay unchanged; only their presentation is localized.
export function formatUiStatus(value) {
  const source = String(value || '').toLowerCase().replace(/_/g, ' ');
  const labels = { init: translateText('Pending'), ready: translateText('Ready'), draft: translateText('Draft'), saved: translateText('Saved'), done: translateText('Completed'), requested: translateText('Requested'), pending: translateText('Pending'), queued: translateText('Queued'), processing: translateText('Processing'), running: translateText('Running'), completed: translateText('Completed'), complete: translateText('Completed'), success: translateText('Success'), succeeded: translateText('Success'), failed: translateText('Failed'), error: translateText('Error'), cancelled: translateText('Cancelled'), canceled: translateText('Cancelled'), skipped: translateText('Skipped'), active: translateText('Active'), inactive: translateText('Inactive') };
  return labels[source] || translateText('Unknown');
}

// Show known authentication errors in the selected language. Provider diagnostics
// can vary, so unfamiliar failures use the operation's translated recovery message.
export function translateAuthError(message, fallback = 'Something went wrong') {
  if (typeof message === 'string' && messages[message]) return translateText(message);
  if (sourceByTranslation.has(message)) return translateText(sourceByTranslation.get(message));
  const value = String(message || '');
  if (/already.*(exist|register|use)|email.*taken/i.test(value)) return translateText('An account with this email already exists. Please log in.');
  if (/(invalid|incorrect).*(password|credential|email)|user not found/i.test(value)) return translateText('Invalid email or password. Please try again.');
  if (/expired|invalid.*(token|code|link)/i.test(value)) return translateText('Reset code is missing or invalid');
  if (/too many|rate limit/i.test(value)) return translateText('Too many attempts. Please try again later.');
  return currentLanguage === 'en' && value ? value : translateText(fallback);
}
