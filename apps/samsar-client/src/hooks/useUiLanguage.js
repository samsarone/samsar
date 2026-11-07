import { useSyncExternalStore } from 'react';
import { getUiLanguage, subscribeUiLanguage } from '../utils/localization.js';

// Subscribe without remounting pages, editors, or forms when the UI language changes.
export const useUiLanguage = () => useSyncExternalStore(subscribeUiLanguage, getUiLanguage, () => 'en');
