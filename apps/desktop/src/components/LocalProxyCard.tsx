import { Button, Popconfirm, Switch, Tag, Tooltip } from "antd";
import { History, Power, PowerOff, RadioTower } from "lucide-react";
import type { Translate } from "../i18n";
import type { LocalProxyStatus } from "../types";

interface LocalProxyCardProps {
  localProxy: LocalProxyStatus | null;
  proxyBusy: boolean;
  conversationRestoreBusy: boolean;
  onStartProxy: () => void;
  onStopProxy: () => void;
  onRestoreConversations: () => void;
  onAutoSwitchChange: (enabled: boolean) => void;
  onAutoDisableUnreachableChange: (enabled: boolean) => void;
  startDisabledReason?: string;
  t: Translate;
}

export function LocalProxyCard({
  localProxy,
  proxyBusy,
  conversationRestoreBusy,
  onStartProxy,
  onStopProxy,
  onRestoreConversations,
  onAutoSwitchChange,
  onAutoDisableUnreachableChange,
  startDisabledReason,
  t,
}: LocalProxyCardProps) {
  const proxyRunning = Boolean(localProxy?.running);
  const proxyBaseUrl = localProxy?.baseUrl ?? "http://127.0.0.1:15722/v1";
  const actionButton = (
    <Button size="small" type={proxyRunning ? "default" : "primary"} loading={proxyBusy}
      disabled={conversationRestoreBusy || (!proxyRunning && Boolean(startDisabledReason))}
      icon={proxyRunning ? <PowerOff size={14} /> : <Power size={14} />}
      onClick={proxyRunning ? onStopProxy : undefined}>
      {proxyRunning ? t("providers.proxy.stop") : t("providers.proxy.start")}
    </Button>
  );

  return (
    <section className={`provider-proxy${proxyRunning ? " active" : ""}`}>
      <div className="provider-official-main">
        <div className="provider-avatar proxy"><RadioTower size={16} /></div>
        <div className="provider-proxy-copy">
          <strong>{t("providers.proxy.title")}</strong>
          <span title={proxyBaseUrl}>{t("providers.proxy.baseUrl", { url: proxyBaseUrl })}</span>
        </div>
      </div>
      <div className="provider-official-actions">
        <Tag className={proxyRunning ? "current-tag" : undefined}>
          {proxyRunning ? t("providers.proxy.running") : t("providers.proxy.stopped")}
        </Tag>
        {!proxyRunning && (
          <Popconfirm title={t("providers.proxy.restoreConversationsConfirmTitle")}
            description={(
              <span className="proxy-start-confirm-description">
                {t("providers.proxy.restoreConversationsConfirmDescription")}
              </span>
            )}
            okText={t("providers.proxy.restoreConversations")} cancelText={t("providers.proxy.cancel")}
            disabled={proxyBusy || conversationRestoreBusy} onConfirm={onRestoreConversations}>
            <Button size="small" icon={<History size={14} />} loading={conversationRestoreBusy}
              disabled={proxyBusy}>{t("providers.proxy.restoreConversations")}</Button>
          </Popconfirm>
        )}
        {proxyRunning ? actionButton : startDisabledReason ? (
          <Tooltip title={startDisabledReason}><span>{actionButton}</span></Tooltip>
        ) : (
          <Popconfirm title={t("providers.proxy.startConfirmTitle")}
            description={(
              <span className="proxy-start-confirm-description">
                {t("providers.proxy.description")}
              </span>
            )}
            okText={t("providers.proxy.start")} cancelText={t("providers.proxy.cancel")}
            disabled={proxyBusy || conversationRestoreBusy} onConfirm={onStartProxy}>
            {actionButton}
          </Popconfirm>
        )}
        {proxyRunning && (
          <>
            {localProxy?.autoSwitchOnQuotaExhaustion && (
              <Tooltip title={t("providers.proxy.autoDisableUnreachableTooltip")}>
                <span className="proxy-auto-switch">
                  <Switch size="small" checked={localProxy.autoDisableUnreachableAccounts}
                    disabled={proxyBusy} onChange={onAutoDisableUnreachableChange} />
                  <span>{t("providers.proxy.autoDisableUnreachable")}</span>
                </span>
              </Tooltip>
            )}
            <Tooltip title={t("providers.proxy.autoSwitchTooltip")}>
              <span className="proxy-auto-switch">
                <Switch size="small" checked={localProxy?.autoSwitchOnQuotaExhaustion ?? false}
                  disabled={proxyBusy} onChange={onAutoSwitchChange} />
                <span>{t("providers.proxy.autoSwitch")}</span>
              </span>
            </Tooltip>
          </>
        )}
      </div>
    </section>
  );
}
