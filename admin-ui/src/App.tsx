import { App as AntApp, ConfigProvider, theme } from "antd";
import { AdminConsole } from "./AdminConsole";
import { useThemeMode } from "./hooks/useThemeMode";

export function App() {
  const [dark, setDark] = useThemeMode();

  return (
    <ConfigProvider
      theme={{
        algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: "#1769e0",
          borderRadius: 8,
          fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
        },
      }}
    >
      <AntApp>
        <AdminConsole dark={dark} onThemeChange={setDark} />
      </AntApp>
    </ConfigProvider>
  );
}
