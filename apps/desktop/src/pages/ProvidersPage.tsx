import { useEffect, useMemo, useState } from "react";
import { Button, Input, Popconfirm, Segmented, Select, Space, Switch, Table, Tag, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Check, KeyRound, Pencil, Plus, RefreshCw, RotateCcw, Save, Server, ShieldCheck, Trash2, X } from "lucide-react";
import { LocalProxyCard } from "../components/LocalProxyCard";
import type { Translate } from "../i18n";
import type { AppInfo, LocalProxyStatus, Provider, ProviderApiFormat, ProviderInput } from "../types";

interface ProvidersPageProps {
  providers: Provider[];
  loading: boolean;
  busyProviderId: string | null;
  saving: boolean;
  localProxy: LocalProxyStatus | null;
  proxyBusy: boolean;
  info: AppInfo | null;
  onSave: (provider: ProviderInput) => Promise<Provider | null>;
  onSwitch: (id: string) => void;
  onSwitchModel: (id: string, model: string) => void;
  onModelControlChange: (id: string, controlledByCodex: boolean) => void;
  onDisable: () => void;
  onDelete: (id: string) => void;
  onStartProxy: () => void;
  onStopProxy: () => void;
  t: Translate;
}

function normalizeModels(activeModel: string, values: string[]) {
  const models: string[] = [];
  const push = (value: string) => {
    const trimmed = value.trim();
    if (trimmed && !models.includes(trimmed)) models.push(trimmed);
  };
  push(activeModel);
  values.forEach(push);
  return models;
}

function modelOptions(models: string[]) {
  return models.map((model) => ({ label: model, value: model }));
}

interface ProviderModalProps {
  provider: Provider | null;
  saving: boolean;
  onClose: () => void;
  onSave: (provider: ProviderInput) => Promise<Provider | null>;
  t: Translate;
}

function ProviderModal({ provider, saving, onClose, onSave, t }: ProviderModalProps) {
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [apiKey, setApiKey] = useState("");
  const [apiFormat, setApiFormat] = useState<ProviderApiFormat>("openaiResponses");
  const apiFormatOptions: { label: string; value: ProviderApiFormat }[] = [
    { label: t("providers.api.responses"), value: "openaiResponses" },
    { label: t("providers.api.chatCompletions"), value: "openaiChat" },
  ];

  useEffect(() => {
    setName(provider?.name ?? "");
    setBaseUrl(provider?.baseUrl ?? "");
    const nextModels = normalizeModels(provider?.model ?? "", provider?.models ?? []);
    setModels(nextModels);
    setModel(provider?.model ?? nextModels[0] ?? "");
    setApiKey("");
    setApiFormat(provider?.apiFormat ?? "openaiResponses");
  }, [provider]);

  const normalizedModels = normalizeModels(model, models);
  const activeModel = model.trim() || (normalizedModels[0] ?? "");
  const canSave = Boolean(name.trim() && baseUrl.trim() && activeModel && (provider?.hasApiKey || apiKey.trim()));
  const updateModels = (values: string[]) => {
    const nextModels = normalizeModels("", values);
    setModels(nextModels);
    if (!nextModels.includes(model.trim())) setModel(nextModels[0] ?? "");
  };
  const submit = async () => {
    if (!canSave) return;
    const saved = await onSave({
      id: provider?.id,
      name,
      baseUrl,
      model: activeModel,
      models: normalizedModels,
      modelSelectionControlledByCodex: provider?.modelSelectionControlledByCodex ?? false,
      apiKey: apiKey.trim() || undefined,
      apiFormat,
    });
    if (saved) onClose();
  };

  return (
    <div className="modal-backdrop">
      <div className="modal provider-modal">
        <button className="modal-close" disabled={saving} onClick={onClose} aria-label={t("providers.modal.close")}>
          <X size={17} />
        </button>
        <div className="modal-icon"><Server size={22} /></div>
        <h2>{provider ? t("providers.modal.editTitle") : t("providers.modal.addTitle")}</h2>
        <p>{t("providers.modal.description")}</p>
        <div className="provider-form">
          <label htmlFor="provider-name">{t("providers.form.name")}</label>
          <Input id="provider-name" value={name} disabled={saving} placeholder="OpenRouter"
            onChange={(event) => setName(event.target.value)} />
          <label htmlFor="provider-base-url">{t("providers.form.baseUrl")}</label>
          <Input id="provider-base-url" value={baseUrl} disabled={saving} placeholder="https://openrouter.ai/api/v1"
            onChange={(event) => setBaseUrl(event.target.value)} />
          <label htmlFor="provider-model">{t("providers.form.model")}</label>
          <Select id="provider-model" mode="tags" value={models} disabled={saving}
            placeholder={t("providers.form.modelsPlaceholder")} tokenSeparators={[","]}
            options={modelOptions(models)} onChange={updateModels} />
          <label htmlFor="provider-active-model">{t("providers.form.activeModel")}</label>
          <Select id="provider-active-model" value={activeModel || undefined} disabled={saving || !normalizedModels.length}
            placeholder="openai/gpt-4.1" options={modelOptions(normalizedModels)}
            onChange={(value) => setModel(value)} />
          <label htmlFor="provider-api-key">{t("providers.form.apiKey")}</label>
          <Input.Password id="provider-api-key" value={apiKey} disabled={saving}
            placeholder={provider?.hasApiKey ? t("providers.form.keepApiKey") : t("providers.form.newApiKey")}
            onChange={(event) => setApiKey(event.target.value)} />
          <label>{t("providers.form.upstreamApi")}</label>
          <Segmented value={apiFormat} options={apiFormatOptions}
            onChange={(value) => setApiFormat(value as ProviderApiFormat)} />
        </div>
        <div className="provider-modal-footer">
          <Button onClick={onClose} disabled={saving}>{t("providers.form.cancel")}</Button>
          <Button type="primary" icon={<Save size={14} />} loading={saving} disabled={!canSave}
            onClick={() => void submit()}>{t("providers.form.save")}</Button>
        </div>
      </div>
    </div>
  );
}

function apiFormatTag(provider: Provider, t: Translate) {
  if (provider.apiFormat === "openaiResponses") return <Tag color="green">{t("providers.tag.responses")}</Tag>;
  return <Tag color="gold">{t("providers.tag.chatBridge")}</Tag>;
}

function ProviderModelCell({
  provider,
  busy,
  onSwitchModel,
  t,
}: {
  provider: Provider;
  busy: boolean;
  onSwitchModel: (id: string, model: string) => void;
  t: Translate;
}) {
  const models = normalizeModels(provider.model, provider.models);
  if (models.length <= 1 || provider.modelSelectionControlledByCodex) {
    return <code className="provider-model-code">{provider.model}</code>;
  }
  return (
    <div className="provider-model-select">
      <Tooltip title={t("providers.tooltip.switchModel")}>
        <Select size="small" value={provider.model} disabled={busy}
          options={modelOptions(models)} popupMatchSelectWidth={false}
          onChange={(value) => onSwitchModel(provider.id, value)} />
      </Tooltip>
      <Tag>{t("providers.model.count", { count: models.length })}</Tag>
    </div>
  );
}

function ProviderModelControlCell({
  provider,
  busy,
  onModelControlChange,
  t,
}: {
  provider: Provider;
  busy: boolean;
  onModelControlChange: (id: string, controlledByCodex: boolean) => void;
  t: Translate;
}) {
  const codexControlled = provider.modelSelectionControlledByCodex;
  return (
    <div className="provider-model-owner">
      <Tooltip title={codexControlled ? t("providers.tooltip.codexModelControl") : t("providers.tooltip.appModelControl")}>
        <Switch size="small" checked={codexControlled} disabled={busy}
          onChange={(checked) => onModelControlChange(provider.id, checked)} />
      </Tooltip>
      <span>{codexControlled ? t("providers.control.codex") : t("providers.control.app")}</span>
    </div>
  );
}

export function ProvidersPage({
  providers,
  loading,
  busyProviderId,
  saving,
  localProxy,
  proxyBusy,
  info,
  onSave,
  onSwitch,
  onSwitchModel,
  onModelControlChange,
  onDisable,
  onDelete,
  onStartProxy,
  onStopProxy,
  t,
}: ProvidersPageProps) {
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [showModal, setShowModal] = useState(false);
  const officialActive = useMemo(() => providers.every((provider) => !provider.active), [providers]);
  const proxyRunning = Boolean(localProxy?.running);

  const openCreate = () => {
    setEditingProvider(null);
    setShowModal(true);
  };
  const openEdit = (provider: Provider) => {
    setEditingProvider(provider);
    setShowModal(true);
  };

  const columns: ColumnsType<Provider> = [
    {
      title: t("providers.table.provider"),
      dataIndex: "name",
      width: 240,
      render: (_, provider) => (
        <div className="provider-cell">
          <div className="provider-avatar"><Server size={15} /></div>
          <div>
            <strong>{provider.name}</strong>
            <span title={provider.baseUrl}>{provider.baseUrl}</span>
          </div>
        </div>
      ),
    },
    {
      title: t("providers.table.model"),
      dataIndex: "model",
      width: 260,
      render: (_, provider) => <ProviderModelCell provider={provider}
        busy={busyProviderId === provider.id} onSwitchModel={onSwitchModel} t={t} />,
    },
    {
      title: t("providers.table.api"),
      width: 120,
      render: (_, provider) => apiFormatTag(provider, t),
    },
    {
      title: t("providers.table.modelControl"),
      width: 130,
      render: (_, provider) => <ProviderModelControlCell provider={provider}
        busy={busyProviderId === provider.id} onModelControlChange={onModelControlChange} t={t} />,
    },
    {
      title: t("providers.table.status"),
      width: 120,
      render: (_, provider) => provider.active
        ? <Tag className="current-tag">{t("providers.status.current")}</Tag>
        : provider.supportsDirectSwitch
          ? <Tag>{t("providers.status.ready")}</Tag>
          : <Tag color="gold">{t("providers.status.bridgeRequired")}</Tag>,
    },
    {
      title: t("providers.table.actions"),
      width: 180,
      align: "right",
      render: (_, provider) => {
        const waiting = busyProviderId === provider.id;
        return (
          <Space size={4} className="table-actions">
            <Tooltip title={provider.supportsDirectSwitch ? t("providers.tooltip.switch") : t("providers.tooltip.requiresBridge")}>
              <Button size="small" type={provider.active ? "default" : "primary"}
                disabled={provider.active || !provider.supportsDirectSwitch}
                loading={waiting} icon={provider.active ? <Check size={14} /> : <RotateCcw size={14} />}
                onClick={() => onSwitch(provider.id)}>
                {provider.active
                  ? t("providers.action.inUse")
                  : proxyRunning
                    ? t("providers.action.hotSwitch")
                    : t("providers.action.switch")}
              </Button>
            </Tooltip>
            <Tooltip title={t("providers.tooltip.edit")}>
              <Button size="small" className="table-icon-button" icon={<Pencil size={14} />}
                onClick={() => openEdit(provider)} />
            </Tooltip>
            <Popconfirm title={t("providers.delete.title")} description={t("providers.delete.description")}
              okText={t("providers.delete.ok")} cancelText={t("providers.delete.cancel")} okButtonProps={{ danger: true }}
              onConfirm={() => onDelete(provider.id)}>
              <Tooltip title={t("providers.tooltip.delete")}>
                <Button danger size="small" className="table-icon-button" loading={waiting}
                  icon={<Trash2 size={14} />} />
              </Tooltip>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  if (loading) return <div className="loading-state"><RefreshCw className="spin" />{t("providers.loading")}</div>;

  return (
    <div className="provider-page">
      <section className={`provider-official${officialActive ? " active" : ""}`}>
        <div className="provider-official-main">
          <div className="provider-avatar official"><ShieldCheck size={16} /></div>
          <div>
            <strong>{t("providers.official.title")}</strong>
            <span>{info?.authPath ?? "~/.codex/auth.json"}</span>
          </div>
        </div>
        <div className="provider-official-actions">
          {officialActive ? <Tag className="current-tag">{t("providers.status.current")}</Tag> : <Tag>{t("providers.status.standby")}</Tag>}
          <Button size="small" type={officialActive ? "default" : "primary"} disabled={officialActive}
            loading={busyProviderId === "official"} icon={<KeyRound size={14} />}
            onClick={onDisable}>{officialActive ? t("providers.action.inUse") : t("providers.action.useOfficial")}</Button>
        </div>
      </section>

      <LocalProxyCard localProxy={localProxy} proxyBusy={proxyBusy}
        onStartProxy={onStartProxy} onStopProxy={onStopProxy} t={t} />

      <div className="provider-toolbar">
        <div>
          <strong>{t("providers.section.title")}</strong>
          <span>{info?.configPath ?? "~/.codex/config.toml"}</span>
        </div>
        <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>{t("providers.action.add")}</Button>
      </div>

      {providers.length ? (
        <div className="provider-table-wrap">
          <Table rowKey="id" size="small" columns={columns} dataSource={providers}
            rowClassName={(provider) => (provider.active ? "active-row" : "")}
            pagination={false} scroll={{ x: 1060 }} />
        </div>
      ) : (
        <div className="provider-empty">
          <Server size={24} />
          <strong>{t("providers.empty.title")}</strong>
          <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>{t("providers.action.add")}</Button>
        </div>
      )}

      {showModal && <ProviderModal provider={editingProvider} saving={saving}
        onClose={() => setShowModal(false)} onSave={onSave} t={t} />}
    </div>
  );
}
