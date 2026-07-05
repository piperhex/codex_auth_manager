import { DEFAULT_LANGUAGE, type Language } from "../i18n";

export function formatDate(value?: string | null, language: Language = DEFAULT_LANGUAGE) {
  if (!value) return "-";
  return new Date(value).toLocaleString(language === "zh" ? "zh-CN" : "en-US");
}
