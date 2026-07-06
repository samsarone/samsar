import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { translations } from "../constants/translations.js";
import { SUPPORTED_LANGUAGES } from "../constants/supportedLanguages.js";
import { useUser } from "./UserContext.jsx";

const LocalizationContext = createContext({
  language: "en",
  direction: "ltr",
  t: (key, ...args) => args[1] || key,
  setLanguage: () => {},
});

const normalizeLanguage = (langCode) => {
  if (!langCode) return "en";
  const supported = SUPPORTED_LANGUAGES.find((lang) => lang.code === langCode);
  return supported ? supported.code : "en";
};

const resolveTranslation = (language, key) => {
  const dictionary = translations[language];
  if (!dictionary) return undefined;

  return key.split(".").reduce((acc, part) => {
    if (acc && typeof acc === "object" && part in acc) {
      return acc[part];
    }
    return undefined;
  }, dictionary);
};

const interpolate = (template, params = {}) => {
  if (typeof template !== "string") return template;
  return template.replace(/\{(\w+)\}/g, (match, token) =>
    Object.prototype.hasOwnProperty.call(params, token) ? params[token] : match
  );
};

export const LocalizationProvider = ({ children }) => {
  const { user } = useUser();
  const savedLanguage =
    (typeof window !== "undefined" &&
      localStorage.getItem("preferredLanguage")) ||
    "en";

  const [language, setLanguageState] = useState(
    normalizeLanguage(savedLanguage)
  );

  useEffect(() => {
    if (user?.preferredLanguage) {
      setLanguageState(normalizeLanguage(user.preferredLanguage));
    }
  }, [user?.preferredLanguage]);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = language;
      const dir =
        SUPPORTED_LANGUAGES.find((lang) => lang.code === language)?.dir ||
        "ltr";
      document.documentElement.dir = dir;
    }
    if (typeof window !== "undefined") {
      localStorage.setItem("preferredLanguage", language);
    }
  }, [language]);

  const direction = useMemo(
    () =>
      SUPPORTED_LANGUAGES.find((lang) => lang.code === language)?.dir || "ltr",
    [language]
  );

  const setLanguage = useCallback((langCode) => {
    setLanguageState(normalizeLanguage(langCode));
  }, []);

  const t = useCallback(
    (key, params = {}, fallback) => {
      const translated =
        resolveTranslation(language, key) ??
        resolveTranslation("en", key) ??
        fallback ??
        key;
      return interpolate(translated, params);
    },
    [language]
  );

  const value = useMemo(
    () => ({
      language,
      direction,
      setLanguage,
      t,
    }),
    [direction, language, setLanguage, t]
  );

  return (
    <LocalizationContext.Provider value={value}>
      <div dir={direction}>{children}</div>
    </LocalizationContext.Provider>
  );
};

export const useLocalization = () => useContext(LocalizationContext);
