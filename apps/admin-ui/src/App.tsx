import { App as AntApp, ConfigProvider, theme } from "antd";
import enUS from "antd/locale/en_US";
import zhCN from "antd/locale/zh_CN";
import { AdminConsole } from "./AdminConsole";
import { I18nProvider } from "./i18n-context";
import { useLanguage } from "./hooks/useLanguage";
import { useThemeMode } from "./hooks/useThemeMode";

export function App() {
  const [dark, setDark] = useThemeMode();
  const [language, setLanguage] = useLanguage();

  return (
    <ConfigProvider
      locale={language === "zh" ? zhCN : enUS}
      theme={{
        algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: "#1769e0",
          borderRadius: 8,
          fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
        },
      }}
    >
      <I18nProvider language={language} onLanguageChange={setLanguage}>
        <AntApp>
          <AdminConsole dark={dark} onThemeChange={setDark} />
        </AntApp>
      </I18nProvider>
    </ConfigProvider>
  );
}
