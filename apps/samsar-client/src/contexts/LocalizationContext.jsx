import { useUiLanguage } from '../hooks/useUiLanguage.js';
import { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import { useUser } from './UserContext.jsx';
import {
  persistUiLanguage, setUiLanguage,
  translateKey, translateText,
} from '../utils/localization.js';

const LocalizationContext = createContext({
  language: 'en', direction: 'ltr', t: translateKey, tx: translateText, setLanguage: setUiLanguage,
});

// Also used by components whose static option catalogs or pure display helpers
// resolve copy at render time. This updates text without remounting editors/forms.
export { useUiLanguage } from '../hooks/useUiLanguage.js';

export const LocalizationProvider = ({ children }) => {
  const { user } = useUser();
  const language = useUiLanguage();
  useEffect(() => {
    if (user?.preferredLanguage) setUiLanguage(user.preferredLanguage);
  }, [user?.preferredLanguage]);
  useEffect(() => { persistUiLanguage(language); }, [language]);
  const t = useCallback((key, params, fallback) => translateKey(key, params, fallback, language), [language]);
  const tx = useCallback((source, params) => translateText(source, params, language), [language]);
  const value = useMemo(() => ({ language, direction: 'ltr', t, tx, setLanguage: setUiLanguage }), [language, t, tx]);
  return <LocalizationContext.Provider value={value}><div dir="ltr">{children}</div></LocalizationContext.Provider>;
};

export const useLocalization = () => useContext(LocalizationContext);
