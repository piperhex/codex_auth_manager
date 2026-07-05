import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { translate, type Language, type Translate, type TranslationKey, type TranslationValues } from "./i18n";

interface I18nContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: Translate;
}

const I18nContext = createContext<I18nContextValue | null>(null);

interface I18nProviderProps {
  children: ReactNode;
  language: Language;
  onLanguageChange: (language: Language) => void;
}

export function I18nProvider({ children, language, onLanguageChange }: I18nProviderProps) {
  const t = useCallback((key: TranslationKey, values?: TranslationValues) => (
    translate(language, key, values)
  ), [language]);

  const value = useMemo(() => ({
    language,
    setLanguage: onLanguageChange,
    t,
  }), [language, onLanguageChange, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used within I18nProvider");
  return value;
}
