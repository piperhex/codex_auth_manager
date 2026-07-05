import { useEffect, useState } from "react";
import { DEFAULT_LANGUAGE, LANGUAGE_STORAGE_KEY, isLanguage, type Language } from "../i18n";

function preferredLanguage(): Language {
  const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (isLanguage(stored)) return stored;
  return window.navigator.language.toLowerCase().startsWith("en") ? "en" : DEFAULT_LANGUAGE;
}

export function useLanguage() {
  const [language, setLanguage] = useState<Language>(preferredLanguage);

  useEffect(() => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  }, [language]);

  return [language, setLanguage] as const;
}
