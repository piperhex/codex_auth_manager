import { useEffect, useState } from "react";
import { Button, ColorPicker, Input, InputNumber, Segmented, Space, Switch } from "antd";
import { CircleGauge, Cloud, EyeOff, FileDown, FolderKey, FolderOpen, KeyRound, Languages, LayoutGrid, Palette, RefreshCw, Save, ShieldCheck, TableProperties } from "lucide-react";
import { MAX_AUTO_REFRESH_SECONDS, MIN_AUTO_REFRESH_SECONDS } from "../hooks/useAutoRefresh";
import type { AccountDisplayMode } from "../hooks/useAccountDisplayMode";
import { LANGUAGE_OPTIONS, type Language, type Translate } from "../i18n";
import type { AppInfo, BubbleResetDisplay } from "../types";

export function SettingsPage({
  info,
  autoRefreshEnabled,
  autoRefreshSeconds,
  onEnabledChange,
  onSecondsChange,
  currentAccountEmail,
  accountAutoRefreshEnabled,
  accountAutoRefreshSeconds,
  onAccountAutoRefreshEnabledChange,
  onAccountAutoRefreshSecondsChange,
  themeColor,
  themeColorLoading,
  onThemeColorChange,
  cloudBaseUrl,
  cloudBaseUrlLoading,
  cloudAuthenticated,
  onCloudBaseUrlSave,
  floatingBubbleEnabled,
  floatingBubbleLoading,
  onFloatingBubbleChange,
  bubbleResetDisplay,
  bubbleResetDisplayLoading,
  onBubbleResetDisplayChange,
  privacyModeEnabled,
  privacyModeLoading,
  onPrivacyModeChange,
  accountDisplayMode,
  onAccountDisplayModeChange,
  onOpenCodexHome,
  onOpenAccountStore,
  onExportLogs,
  exportingLogs,
  language,
  onLanguageChange,
  t,
}: {
  info: AppInfo | null;
  autoRefreshEnabled: boolean;
  autoRefreshSeconds: number;
  onEnabledChange: (enabled: boolean) => void;
  onSecondsChange: (value: number | string | null) => void;
  currentAccountEmail: string | null;
  accountAutoRefreshEnabled: boolean;
  accountAutoRefreshSeconds: number;
  onAccountAutoRefreshEnabledChange: (enabled: boolean) => void;
  onAccountAutoRefreshSecondsChange: (value: number | string | null) => void;
  themeColor: string;
  themeColorLoading: boolean;
  onThemeColorChange: (color: string) => void;
  cloudBaseUrl: string;
  cloudBaseUrlLoading: boolean;
  cloudAuthenticated: boolean;
  onCloudBaseUrlSave: (baseUrl: string) => Promise<void> | void;
  floatingBubbleEnabled: boolean;
  floatingBubbleLoading: boolean;
  onFloatingBubbleChange: (enabled: boolean) => void;
  bubbleResetDisplay: BubbleResetDisplay;
  bubbleResetDisplayLoading: boolean;
  onBubbleResetDisplayChange: (display: BubbleResetDisplay) => void;
  privacyModeEnabled: boolean;
  privacyModeLoading: boolean;
  onPrivacyModeChange: (enabled: boolean) => void;
  accountDisplayMode: AccountDisplayMode;
  onAccountDisplayModeChange: (mode: AccountDisplayMode) => void;
  onOpenCodexHome: () => void;
  onOpenAccountStore: () => void;
  onExportLogs: () => void;
  exportingLogs: boolean;
  language: Language;
  onLanguageChange: (language: Language) => void;
  t: Translate;
}) {
  const [cloudBaseUrlDraft, setCloudBaseUrlDraft] = useState(cloudBaseUrl);

  useEffect(() => {
    setCloudBaseUrlDraft(cloudBaseUrl);
  }, [cloudBaseUrl]);

  return (
    <div className="settings-page">
      <section className="settings-card">
        <div className="settings-icon"><Languages size={23} /></div>
        <div className="settings-card-content">
          <div className="settings-card-copy"><h3>{t("settings.language.title")}</h3><p>{t("settings.language.description")}</p></div>
          <div className="settings-field">
            <label htmlFor="language-selector">{t("settings.language.label")}</label>
            <Segmented id="language-selector" value={language} options={[...LANGUAGE_OPTIONS]}
              onChange={(value) => onLanguageChange(value as Language)} />
          </div>
        </div>
      </section>
      <section className="settings-card">
        <div className="settings-icon"><Cloud size={23} /></div>
        <div className="settings-card-content">
          <div className="settings-card-copy"><h3>{t("settings.cloud.title")}</h3><p>{t("settings.cloud.description")}</p>
            <p className="cloud-settings-status">
              {cloudBaseUrl
                ? cloudAuthenticated ? t("settings.cloud.signedIn") : t("settings.cloud.enabled")
                : t("settings.cloud.localMode")}
            </p>
          </div>
          <div className="settings-field settings-field-wide">
            <label htmlFor="cloud-base-url">{t("settings.cloud.label")}</label>
            <Input id="cloud-base-url" value={cloudBaseUrlDraft} disabled={cloudBaseUrlLoading}
              allowClear placeholder={t("settings.cloud.placeholder")}
              onChange={(event) => setCloudBaseUrlDraft(event.target.value)} />
            <Button type="primary" size="small" icon={<Save size={14} />} loading={cloudBaseUrlLoading}
              onClick={() => void onCloudBaseUrlSave(cloudBaseUrlDraft)}>{t("settings.cloud.save")}</Button>
          </div>
        </div>
      </section>
      <section className="settings-card">
        <div className="settings-icon"><Palette size={23} /></div>
        <div className="settings-card-content">
          <div className="settings-card-copy"><h3>{t("settings.theme.title")}</h3><p>{t("settings.theme.description")}</p></div>
          <div className="settings-field">
            <label htmlFor="theme-color-picker">{t("settings.theme.label")}</label>
            <span id="theme-color-picker" className="theme-color-picker">
              <ColorPicker value={themeColor} disabled={themeColorLoading}
                showText disabledAlpha format="hex"
                onChangeComplete={(color) => onThemeColorChange(color.toHexString())} />
            </span>
          </div>
        </div>
      </section>
      <section className="settings-card">
        <div className="settings-icon"><CircleGauge size={23} /></div>
        <div className="settings-card-content">
          <div className="settings-card-copy"><h3>{t("settings.floatingBubble.title")}</h3><p>{t("settings.floatingBubble.description")}</p></div>
          <div className="settings-field">
            <label htmlFor="floating-bubble-enabled">{t("settings.floatingBubble.enabled")}</label>
            <Switch id="floating-bubble-enabled" checked={floatingBubbleEnabled} loading={floatingBubbleLoading}
              checkedChildren={t("settings.autoRefresh.on")} unCheckedChildren={t("settings.autoRefresh.off")}
              onChange={onFloatingBubbleChange} />
            <label htmlFor="floating-bubble-reset-display">{t("settings.floatingBubble.resetDisplay")}</label>
            <Segmented id="floating-bubble-reset-display" value={bubbleResetDisplay} disabled={bubbleResetDisplayLoading}
              options={[
                { value: "countdown", label: t("settings.floatingBubble.countdown") },
                { value: "resetAt", label: t("settings.floatingBubble.resetAt") },
              ]}
              onChange={(value) => onBubbleResetDisplayChange(value as BubbleResetDisplay)} />
          </div>
        </div>
      </section>
      <section className="settings-card">
        <div className="settings-icon"><EyeOff size={23} /></div>
        <div className="settings-card-content">
          <div className="settings-card-copy"><h3>{t("settings.privacy.title")}</h3><p>{t("settings.privacy.description")}</p></div>
          <div className="settings-field">
            <label htmlFor="privacy-mode-enabled">{t("settings.privacy.enabled")}</label>
            <Switch id="privacy-mode-enabled" checked={privacyModeEnabled} loading={privacyModeLoading}
              checkedChildren={t("settings.autoRefresh.on")} unCheckedChildren={t("settings.autoRefresh.off")}
              onChange={onPrivacyModeChange} />
          </div>
        </div>
      </section>
      <section className="settings-card">
        <div className="settings-icon"><LayoutGrid size={23} /></div>
        <div className="settings-card-content">
          <div className="settings-card-copy"><h3>{t("settings.accountDisplay.title")}</h3><p>{t("settings.accountDisplay.description")}</p></div>
          <div className="settings-field">
            <label htmlFor="account-display-mode">{t("settings.accountDisplay.label")}</label>
            <Segmented id="account-display-mode" value={accountDisplayMode}
              options={[
                { value: "table", label: <span className="segmented-option-label"><TableProperties size={14} />{t("settings.accountDisplay.table")}</span> },
                { value: "cards", label: <span className="segmented-option-label"><LayoutGrid size={14} />{t("settings.accountDisplay.cards")}</span> },
              ]}
              onChange={(value) => onAccountDisplayModeChange(value as AccountDisplayMode)} />
          </div>
        </div>
      </section>
      <section className="settings-card">
        <div className="settings-icon"><RefreshCw size={23} /></div>
        <div className="settings-card-content">
          <div className="settings-card-copy"><h3>{t("settings.autoRefresh.title")}</h3><p>{t("settings.autoRefresh.description")}</p></div>
          <div className="settings-field">
            <label htmlFor="auto-refresh-enabled">{t("settings.autoRefresh.enabled")}</label>
            <Switch id="auto-refresh-enabled" checked={autoRefreshEnabled} checkedChildren={t("settings.autoRefresh.on")} unCheckedChildren={t("settings.autoRefresh.off")}
              onChange={onEnabledChange} />
            <label htmlFor="auto-refresh-interval">{t("settings.autoRefresh.interval")}</label>
            <Space.Compact>
              <InputNumber id="auto-refresh-interval" min={MIN_AUTO_REFRESH_SECONDS} max={MAX_AUTO_REFRESH_SECONDS}
                step={1} value={autoRefreshSeconds} disabled={!autoRefreshEnabled} onChange={onSecondsChange} />
              <Button disabled>{t("settings.autoRefresh.seconds")}</Button>
            </Space.Compact>
          </div>
        </div>
      </section>
      <section className="settings-card">
        <div className="settings-icon"><RefreshCw size={23} /></div>
        <div className="settings-card-content">
          <div className="settings-card-copy"><h3>{t("settings.accountAutoRefresh.title")}</h3><p>{t("settings.accountAutoRefresh.description")}</p>
            <p className="settings-current-account">
              {currentAccountEmail
                ? t("settings.accountAutoRefresh.current", { email: currentAccountEmail })
                : t("settings.accountAutoRefresh.none")}
            </p>
          </div>
          <div className="settings-field">
            <label htmlFor="account-auto-refresh-enabled">{t("settings.autoRefresh.enabled")}</label>
            <Switch id="account-auto-refresh-enabled" checked={accountAutoRefreshEnabled}
              disabled={!currentAccountEmail} checkedChildren={t("settings.autoRefresh.on")}
              unCheckedChildren={t("settings.autoRefresh.off")} onChange={onAccountAutoRefreshEnabledChange} />
            <label htmlFor="account-auto-refresh-interval">{t("settings.autoRefresh.interval")}</label>
            <Space.Compact>
              <InputNumber id="account-auto-refresh-interval" min={MIN_AUTO_REFRESH_SECONDS}
                max={MAX_AUTO_REFRESH_SECONDS} step={1} value={accountAutoRefreshSeconds}
                disabled={!currentAccountEmail || !accountAutoRefreshEnabled}
                onChange={onAccountAutoRefreshSecondsChange} />
              <Button disabled>{t("settings.autoRefresh.seconds")}</Button>
            </Space.Compact>
          </div>
        </div>
      </section>
      <section className="settings-card"><div className="settings-icon"><FolderKey size={23} /></div>
        <div className="settings-card-content">
          <div className="settings-card-copy">
            <h3>Codex Home</h3><p>{t("settings.codexHome.description")}</p>
            <code>{info?.codexHome ?? t("settings.loading")}</code>
          </div>
          <Button size="small" icon={<FolderOpen size={14} />} disabled={!info?.codexHome}
            onClick={onOpenCodexHome}>{t("settings.openFolder")}</Button>
        </div></section>
      <section className="settings-card"><div className="settings-icon"><KeyRound size={23} /></div>
        <div className="settings-card-content">
          <div className="settings-card-copy">
            <h3>{t("settings.accountStore.title")}</h3><p>{t("settings.accountStore.description")}</p>
            <code>{info?.accountStore ?? t("settings.loading")}</code>
          </div>
          <Button size="small" icon={<FolderOpen size={14} />} disabled={!info?.accountStore}
            onClick={onOpenAccountStore}>{t("settings.openFolder")}</Button>
        </div></section>
      <section className="settings-card note-card"><div className="settings-icon"><ShieldCheck size={23} /></div>
        <div className="settings-card-content"><div className="settings-card-copy"><h3>{t("settings.security.title")}</h3><p>{t("settings.security.description")}</p></div></div></section>
      <section className="settings-card"><div className="settings-icon"><FileDown size={23} /></div>
        <div className="settings-card-content">
          <div className="settings-card-copy"><h3>{t("settings.logs.title")}</h3><p>{t("settings.logs.description")}</p></div>
          <Button size="small" icon={<FileDown size={14} />} loading={exportingLogs}
            onClick={onExportLogs}>{t("settings.logs.export")}</Button>
        </div></section>
    </div>
  );
}
