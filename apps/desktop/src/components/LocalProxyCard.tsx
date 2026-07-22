import { Button, Popconfirm, Popover, Select, Switch, Tag, Tooltip } from "antd";
import { ChevronDown, History, Power, PowerOff, RadioTower, Shuffle } from "lucide-react";
import type { Translate } from "../i18n";
import type { Account, LocalProxyStatus } from "../types";

interface LocalProxyCardProps {
  localProxy: LocalProxyStatus | null;
  accounts: Account[];
  proxyBusy: boolean;
  conversationRestoreBusy: boolean;
  onStartProxy: () => void;
  onStopProxy: () => void;
  onRestoreConversations: () => void;
  onAutoSwitchChange: (enabled: boolean) => void;
  onCustomAutoSwitchPriorityEnabledChange: (enabled: boolean) => void;
  onAutoDisableUnreachableChange: (enabled: boolean) => void;
  onImageAccountChange: (accountId: string | null) => void;
  onListenOnAllInterfacesChange: (enabled: boolean) => void;
  startDisabledReason?: string;
  t: Translate;
}

export function LocalProxyCard({
  localProxy,
  accounts,
  proxyBusy,
  conversationRestoreBusy,
  onStartProxy,
  onStopProxy,
  onRestoreConversations,
  onAutoSwitchChange,
  onCustomAutoSwitchPriorityEnabledChange,
  onAutoDisableUnreachableChange,
  onImageAccountChange,
  onListenOnAllInterfacesChange,
  startDisabledReason,
  t,
}: LocalProxyCardProps) {
  const proxyRunning = Boolean(localProxy?.running);
  const activeAccount = accounts.find((account) => account.active);
  const imageAccounts = accounts.filter((account) => !account.agentIdentity);
  const showImageAccountSelect = proxyRunning && Boolean(activeAccount?.agentIdentity);
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
        {showImageAccountSelect && (
          <Tooltip title={t("providers.proxy.imageAccountTooltip")}>
            <Select
              className="proxy-image-account"
              size="small"
              aria-label={t("providers.proxy.imageAccount")}
              value={localProxy?.imageGenerationAccountId ?? undefined}
              options={imageAccounts.map((account) => ({
                label: account.email,
                value: account.id,
              }))}
              placeholder={t(imageAccounts.length
                ? "providers.proxy.imageAccountPlaceholder"
                : "providers.proxy.imageAccountEmpty")}
              disabled={proxyBusy || imageAccounts.length === 0}
              showSearch
              optionFilterProp="label"
              onChange={(value) => onImageAccountChange(value)}
            />
          </Tooltip>
        )}
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
            <Popover trigger="hover" placement="bottom" mouseEnterDelay={0.08} mouseLeaveDelay={0.12}
              content={(
                <div className="proxy-auto-switch-menu">
                  <div className="proxy-auto-switch-menu-item"
                    title={t("providers.proxy.autoSwitchTooltip")}>
                    <span>{t("providers.proxy.autoSwitch")}</span>
                    <Switch size="small" checked={localProxy?.autoSwitchOnQuotaExhaustion ?? false}
                      disabled={proxyBusy} onChange={onAutoSwitchChange} />
                  </div>
                  <div className="proxy-auto-switch-menu-item"
                    title={t("table.customPriorityTooltip")}>
                    <span>{t("table.customPriorityEnabled")}</span>
                    <Switch size="small" checked={localProxy?.customAutoSwitchPriorityEnabled ?? false}
                      disabled={proxyBusy || !localProxy?.autoSwitchOnQuotaExhaustion}
                      onChange={onCustomAutoSwitchPriorityEnabledChange} />
                  </div>
                </div>
              )}>
              <button type="button"
                className={`proxy-auto-switch-entry${localProxy?.autoSwitchOnQuotaExhaustion ? " active" : ""}`}
                aria-label={t("providers.proxy.autoSwitch")}>
                <Shuffle size={14} />
                <span>{t("providers.proxy.autoSwitch")}</span>
                <ChevronDown size={12} />
              </button>
            </Popover>
            <Tooltip title={t("providers.proxy.listenAllInterfacesTooltip")}>
              <span className="proxy-auto-switch">
                <Switch size="small" checked={localProxy?.listenOnAllInterfaces ?? false}
                  disabled={proxyBusy} onChange={onListenOnAllInterfacesChange} />
                <span>{t("providers.proxy.listenAllInterfaces")}</span>
              </span>
            </Tooltip>
          </>
        )}
      </div>
    </section>
  );
}
