import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Input, InputNumber, Modal, Popconfirm, Segmented, Select, Tooltip } from "antd";
import {
  Check,
  CirclePause,
  CirclePlay,
  FolderOpen,
  ImagePlus,
  Palette,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import {
  applyDreamSkinTheme,
  chooseDreamSkinImage,
  importDreamSkinImage,
  installDreamSkin,
  loadDreamSkinStatus,
  loadDreamSkinThemePreview,
  openDreamSkinFolder,
  reapplyDreamSkin,
  restoreDreamSkin,
  saveDreamSkinTheme,
  setDreamSkinAppearance,
  setDreamSkinPaused,
  verifyDreamSkin,
} from "../api/backend";
import type { Translate } from "../i18n";
import type { DreamSkinAppearance, DreamSkinImportOptions, DreamSkinStatus, DreamSkinThemeSummary } from "../types";

const GOTHIC_PREVIEW = new URL(
  "../../src-tauri/resources/dream-skin/presets/preset-gothic-void-crusade/background.jpg",
  import.meta.url,
).href;
const ROSE_REVERIE_PREVIEW = new URL(
  "../../src-tauri/resources/dream-skin/presets/preset-rose-reverie/background.jpg",
  import.meta.url,
).href;
const FORTUNE_AT_WORK_PREVIEW = new URL(
  "../../src-tauri/resources/dream-skin/presets/preset-fortune-at-work/background.jpg",
  import.meta.url,
).href;
const CORAL_HORIZON_PREVIEW = new URL(
  "../../src-tauri/resources/dream-skin/presets/preset-coral-horizon/background.jpg",
  import.meta.url,
).href;
const SAGE_DAYLIGHT_PREVIEW = new URL(
  "../../src-tauri/resources/dream-skin/presets/preset-sage-daylight/background.jpg",
  import.meta.url,
).href;
const SPARK_STUDIO_PREVIEW = new URL(
  "../../src-tauri/resources/dream-skin/presets/preset-spark-studio/background.jpg",
  import.meta.url,
).href;
const COSMIC_VIOLET_PREVIEW = new URL(
  "../../src-tauri/resources/dream-skin/presets/preset-cosmic-violet/background.jpg",
  import.meta.url,
).href;
const AQUA_RESONANCE_PREVIEW = new URL(
  "../../src-tauri/resources/dream-skin/presets/preset-aqua-resonance/background.jpg",
  import.meta.url,
).href;
const MIDNIGHT_GOLD_PREVIEW = new URL(
  "../../src-tauri/resources/dream-skin/presets/preset-midnight-gold/background.jpg",
  import.meta.url,
).href;

const BUILT_IN_THEMES = [
  {
    id: "preset-gothic-void-crusade",
    nameKey: "dreamSkin.theme.gothic.name" as const,
    descriptionKey: "dreamSkin.theme.gothic.description" as const,
    preview: GOTHIC_PREVIEW,
    tone: "gothic",
  },
  {
    id: "preset-rose-reverie",
    nameKey: "dreamSkin.theme.roseReverie.name" as const,
    descriptionKey: "dreamSkin.theme.roseReverie.description" as const,
    preview: ROSE_REVERIE_PREVIEW,
    tone: "rose-reverie",
  },
  {
    id: "preset-fortune-at-work",
    nameKey: "dreamSkin.theme.fortuneAtWork.name" as const,
    descriptionKey: "dreamSkin.theme.fortuneAtWork.description" as const,
    preview: FORTUNE_AT_WORK_PREVIEW,
    tone: "fortune",
  },
  {
    id: "preset-coral-horizon",
    nameKey: "dreamSkin.theme.coralHorizon.name" as const,
    descriptionKey: "dreamSkin.theme.coralHorizon.description" as const,
    preview: CORAL_HORIZON_PREVIEW,
    tone: "coral",
  },
  {
    id: "preset-sage-daylight",
    nameKey: "dreamSkin.theme.sageDaylight.name" as const,
    descriptionKey: "dreamSkin.theme.sageDaylight.description" as const,
    preview: SAGE_DAYLIGHT_PREVIEW,
    tone: "sage",
  },
  {
    id: "preset-spark-studio",
    nameKey: "dreamSkin.theme.sparkStudio.name" as const,
    descriptionKey: "dreamSkin.theme.sparkStudio.description" as const,
    preview: SPARK_STUDIO_PREVIEW,
    tone: "spark",
  },
  {
    id: "preset-cosmic-violet",
    nameKey: "dreamSkin.theme.cosmicViolet.name" as const,
    descriptionKey: "dreamSkin.theme.cosmicViolet.description" as const,
    preview: COSMIC_VIOLET_PREVIEW,
    tone: "cosmic",
  },
  {
    id: "preset-aqua-resonance",
    nameKey: "dreamSkin.theme.aquaResonance.name" as const,
    descriptionKey: "dreamSkin.theme.aquaResonance.description" as const,
    preview: AQUA_RESONANCE_PREVIEW,
    tone: "aqua",
  },
  {
    id: "preset-midnight-gold",
    nameKey: "dreamSkin.theme.midnightGold.name" as const,
    descriptionKey: "dreamSkin.theme.midnightGold.description" as const,
    preview: MIDNIGHT_GOLD_PREVIEW,
    tone: "midnight",
  },
] as const;

const BUILT_IN_IDS = new Set(BUILT_IN_THEMES.map((theme) => theme.id));
const APPEARANCE_OPTIONS = [
  { value: "auto", labelKey: "dreamSkin.option.auto" },
  { value: "light", labelKey: "dreamSkin.option.light" },
  { value: "dark", labelKey: "dreamSkin.option.dark" },
] as const;
const SAFE_AREA_OPTIONS = [
  { value: "auto", labelKey: "dreamSkin.option.auto" },
  { value: "left", labelKey: "dreamSkin.option.left" },
  { value: "right", labelKey: "dreamSkin.option.right" },
  { value: "center", labelKey: "dreamSkin.option.center" },
  { value: "none", labelKey: "dreamSkin.option.none" },
] as const;
const TASK_MODE_OPTIONS = [
  { value: "auto", labelKey: "dreamSkin.option.auto" },
  { value: "ambient", labelKey: "dreamSkin.option.ambient" },
  { value: "banner", labelKey: "dreamSkin.option.banner" },
  { value: "off", labelKey: "dreamSkin.option.off" },
] as const;

type DreamSkinPageProps = {
  t: Translate;
  notify: (message: string) => void;
};

type ThemeCardProps = {
  active: boolean;
  busy: boolean;
  description: string;
  id: string;
  name: string;
  preview?: string | null;
  tone?: string;
  onApply: () => void;
  t: Translate;
};

function ThemeCard({ active, busy, description, id, name, preview, tone, onApply, t }: ThemeCardProps) {
  return (
    <article className={`dream-theme-card${active ? " is-active" : ""}`}>
      <div
        className={`dream-theme-preview dream-theme-preview-${tone ?? "saved"}`}
        style={preview ? { backgroundImage: `url("${preview}")` } : undefined}
      >
        <div className="dream-theme-preview-shade" />
        <span className="dream-theme-id">{id}</span>
        {active && <span className="dream-theme-current"><Check size={13} />{t("dreamSkin.current")}</span>}
      </div>
      <div className="dream-theme-copy">
        <div><h3>{name}</h3><p>{description}</p></div>
        <Button type={active ? "default" : "primary"} disabled={active || busy}
          loading={busy && !active} icon={active ? <Check size={14} /> : <WandSparkles size={14} />}
          onClick={onApply}>
          {active ? t("dreamSkin.applied") : t("dreamSkin.apply")}
        </Button>
      </div>
    </article>
  );
}

function SavedThemeCard({ theme, status, busy, onApply, t }: {
  theme: DreamSkinThemeSummary;
  status: DreamSkinStatus;
  busy: boolean;
  onApply: () => void;
  t: Translate;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadDreamSkinThemePreview(theme.id)
      .then((value) => { if (!cancelled) setPreview(value); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [theme.id]);

  return <ThemeCard active={status.activeThemeId === theme.id} busy={busy}
    description={t("dreamSkin.saved.description")} id={theme.id} name={theme.name}
    preview={preview} onApply={onApply} t={t} />;
}

const DEFAULT_IMPORT_OPTIONS: DreamSkinImportOptions = {
  name: "My Dream Skin",
  appearance: "auto",
  safeArea: "auto",
  taskMode: "auto",
  focusX: null,
  focusY: null,
};

export function DreamSkinPage({ t, notify }: DreamSkinPageProps) {
  const [status, setStatus] = useState<DreamSkinStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importPath, setImportPath] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importOptions, setImportOptions] = useState<DreamSkinImportOptions>(DEFAULT_IMPORT_OPTIONS);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(await loadDreamSkinStatus());
      setError(null);
    } catch (loadError) {
      setError(String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const runStatusOperation = useCallback(async (
    key: string,
    operation: () => Promise<DreamSkinStatus>,
    successMessage: string,
  ) => {
    setBusy(key);
    setError(null);
    try {
      const next = await operation();
      setStatus(next);
      notify(successMessage);
      return true;
    } catch (operationError) {
      setError(String(operationError));
      return false;
    } finally {
      setBusy(null);
    }
  }, [notify]);

  const confirmChatGptRestart = useCallback((operation: () => Promise<unknown>) => {
    Modal.confirm({
      title: t("dreamSkin.restart.confirmTitle"),
      content: t("dreamSkin.restart.confirmDescription"),
      okText: t("dreamSkin.restart.confirmAction"),
      cancelText: t("table.cancel"),
      onOk: operation,
    });
  }, [t]);

  const applyTheme = useCallback((themeId: string) => {
    confirmChatGptRestart(() => runStatusOperation(
      `apply:${themeId}`,
      () => applyDreamSkinTheme(themeId),
      t("dreamSkin.toast.applied"),
    ));
  }, [confirmChatGptRestart, runStatusOperation, t]);

  const changeAppearance = useCallback((appearance: DreamSkinAppearance) => {
    void runStatusOperation(
      "appearance",
      () => setDreamSkinAppearance(appearance),
      t("dreamSkin.toast.appearanceChanged"),
    );
  }, [runStatusOperation, t]);

  const chooseCustomImage = useCallback(async () => {
    setError(null);
    try {
      const result = await chooseDreamSkinImage();
      if (result.status === "cancelled") return;
      const path = result.status === "selected" ? result.path : "preview-dream-skin.jpg";
      const fileName = path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "")?.trim();
      setImportPath(path);
      setImportOptions({ ...DEFAULT_IMPORT_OPTIONS, name: fileName || t("dreamSkin.import.defaultName") });
      setImportOpen(true);
    } catch (chooseError) {
      setError(String(chooseError));
    }
  }, [t]);

  const submitImport = useCallback(async () => {
    if (!importPath || !importOptions.name.trim()) return;
    confirmChatGptRestart(async () => {
      const ok = await runStatusOperation(
        "import",
        () => importDreamSkinImage(importPath, { ...importOptions, name: importOptions.name.trim() }),
        t("dreamSkin.toast.imported"),
      );
      if (ok) setImportOpen(false);
    });
  }, [confirmChatGptRestart, importOptions, importPath, runStatusOperation, t]);

  const submitSave = useCallback(async () => {
    if (!saveName.trim()) return;
    const ok = await runStatusOperation(
      "save",
      () => saveDreamSkinTheme(saveName.trim()),
      t("dreamSkin.toast.saved"),
    );
    if (ok) {
      setSaveOpen(false);
      setSaveName("");
    }
  }, [runStatusOperation, saveName, t]);

  const savedThemes = useMemo(() => (
    status?.savedThemes.filter((theme) => !BUILT_IN_IDS.has(theme.id as (typeof BUILT_IN_THEMES)[number]["id"])) ?? []
  ), [status?.savedThemes]);

  const sessionLabel = status ? t(`dreamSkin.session.${status.session}`) : t("dreamSkin.session.loading");
  const activeThemeName = status?.activeThemeName || t("dreamSkin.noActiveTheme");
  const isBusy = busy !== null;

  if (loading && !status) {
    return <div className="dream-skin-loading"><Sparkles className="spin" size={24} />{t("dreamSkin.loading")}</div>;
  }

  if (status && !status.supported) {
    return <div className="dream-skin-page"><Alert showIcon type="warning"
      message={t("dreamSkin.unsupported.title")} description={t("dreamSkin.unsupported.description")} /></div>;
  }

  return (
    <div className="dream-skin-page">
      {error && <Alert className="dream-skin-error" type="error" showIcon closable
        message={t("dreamSkin.error")} description={error} onClose={() => setError(null)} />}

      <section className="dream-skin-hero">
        <div className="dream-skin-hero-copy">
          <span className="dream-skin-kicker"><Palette size={15} />CODEX DREAM SKIN</span>
          <h2>{t("dreamSkin.hero.title")}</h2>
          <p>{t("dreamSkin.hero.description")}</p>
          <div className="dream-skin-safety"><ShieldCheck size={16} />{t("dreamSkin.hero.safety")}</div>
        </div>
        <div className="dream-skin-console">
          <div className="dream-skin-status-card">
            <div className="dream-status-item">
              <span>{t("dreamSkin.status")}</span>
              <strong className={`dream-session dream-session-${status?.session ?? "ready"}`}><i />{sessionLabel}</strong>
            </div>
            <div className="dream-status-item dream-active-theme">
              <span>{t("dreamSkin.activeTheme")}</span>
              <b title={activeThemeName}>{activeThemeName}</b>
            </div>
            <div className="dream-appearance-control">
              <span>{t("dreamSkin.import.appearance")}</span>
              <Segmented
                block
                size="small"
                value={status?.activeThemeAppearance ?? "auto"}
                disabled={!status?.installed || !status.activeThemeId || isBusy}
                options={APPEARANCE_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }))}
                onChange={(appearance) => changeAppearance(appearance as DreamSkinAppearance)}
              />
            </div>
          </div>
          <div className="dream-tools-actions">
            <Button type={status?.installed ? "default" : "primary"} icon={<Sparkles size={14} />}
              loading={busy === "install"} disabled={isBusy && busy !== "install"}
              onClick={() => confirmChatGptRestart(() => runStatusOperation(
                "install", installDreamSkin, t("dreamSkin.toast.installed"),
              ))}>
              {status?.installed ? t("dreamSkin.updateRuntime") : t("dreamSkin.install")}
            </Button>
            <Tooltip title={t("dreamSkin.refresh")}><Button aria-label={t("dreamSkin.refresh")}
              icon={<RefreshCw className={loading ? "spin" : ""} size={15} />} disabled={isBusy}
              onClick={() => void refresh()} /></Tooltip>
            <Button icon={status?.session === "paused" ? <CirclePlay size={15} /> : <CirclePause size={15} />}
              disabled={!status?.installed || isBusy} loading={busy === "pause"}
              onClick={() => {
                const operation = () => runStatusOperation("pause", () => setDreamSkinPaused(status?.session !== "paused"),
                  status?.session === "paused" ? t("dreamSkin.toast.resumed") : t("dreamSkin.toast.paused"));
                if (status?.session === "paused") confirmChatGptRestart(operation);
                else void operation();
              }}>
              {status?.session === "paused" ? t("dreamSkin.resume") : t("dreamSkin.pause")}
            </Button>
            <Button icon={<RefreshCw size={15} />} disabled={!status?.installed || isBusy}
              loading={busy === "reapply"} onClick={() => confirmChatGptRestart(() => runStatusOperation(
                "reapply", reapplyDreamSkin, t("dreamSkin.toast.reapplied")))}>{t("dreamSkin.reapply")}</Button>
            <Button icon={<Save size={15} />} disabled={!status?.installed || !status.activeThemeId || isBusy}
              onClick={() => { setSaveName(status?.activeThemeName ?? ""); setSaveOpen(true); }}>
              {t("dreamSkin.saveCurrent")}</Button>
            <Button icon={<ShieldCheck size={15} />} disabled={!status?.installed || isBusy}
              loading={busy === "verify"} onClick={() => {
                setBusy("verify"); setError(null);
                void verifyDreamSkin().then(() => notify(t("dreamSkin.toast.verified")))
                  .catch((verifyError) => setError(String(verifyError))).finally(() => setBusy(null));
              }}>{t("dreamSkin.verify")}</Button>
            <Button icon={<FolderOpen size={15} />} disabled={isBusy}
              onClick={() => void openDreamSkinFolder().catch((folderError) => setError(String(folderError)))}>
              {t("dreamSkin.openFolder")}</Button>
            <Popconfirm title={t("dreamSkin.restore.confirmTitle")}
              description={t("dreamSkin.restore.confirmDescription")} okText={t("dreamSkin.restore")}
              cancelText={t("table.cancel")} okButtonProps={{ danger: true }}
              onConfirm={() => void runStatusOperation("restore", restoreDreamSkin, t("dreamSkin.toast.restored"))}>
              <Button danger icon={<RotateCcw size={15} />} disabled={!status?.runtimeInstalled || isBusy}
                loading={busy === "restore"}>{t("dreamSkin.restore")}</Button>
            </Popconfirm>
          </div>
        </div>
      </section>

      {!status?.installed && <Alert className="dream-skin-prerequisite" type="info" showIcon
        message={t("dreamSkin.installHint.title")} description={t("dreamSkin.installHint.description")} />}

      <section className="dream-skin-section">
        <div className="dream-section-heading"><div><span>{t("dreamSkin.presets.eyebrow")}</span>
          <h2>{t("dreamSkin.presets.title")}</h2></div>
          <p>{t("dreamSkin.presets.description")}</p></div>
        <div className="dream-theme-grid">
          {BUILT_IN_THEMES.map((theme) => <ThemeCard key={theme.id}
            active={status?.activeThemeId === theme.id} busy={busy === `apply:${theme.id}`}
            description={t(theme.descriptionKey)} id={theme.id} name={t(theme.nameKey)}
            preview={theme.preview} tone={theme.tone} onApply={() => applyTheme(theme.id)} t={t} />)}
          <article className="dream-theme-card dream-theme-import-card">
            <button type="button" className="dream-import-trigger" disabled={isBusy} onClick={() => void chooseCustomImage()}>
              <span className="dream-import-icon"><ImagePlus size={28} /></span>
              <span><b>{t("dreamSkin.import.title")}</b><small>{t("dreamSkin.import.description")}</small></span>
              <em><WandSparkles size={15} />{t("dreamSkin.import.action")}</em>
            </button>
          </article>
        </div>
      </section>

      {savedThemes.length > 0 && <section className="dream-skin-section">
        <div className="dream-section-heading"><div><span>{t("dreamSkin.saved.eyebrow")}</span>
          <h2>{t("dreamSkin.saved.title")}</h2></div><p>{t("dreamSkin.saved.subtitle")}</p></div>
        <div className="dream-theme-grid dream-saved-grid">
          {savedThemes.map((theme) => <SavedThemeCard key={theme.id} theme={theme} status={status!}
            busy={busy === `apply:${theme.id}`} onApply={() => applyTheme(theme.id)} t={t} />)}
        </div>
      </section>}

      <Modal title={t("dreamSkin.import.modalTitle")} open={importOpen} confirmLoading={busy === "import"}
        okText={t("dreamSkin.import.apply")} cancelText={t("table.cancel")} onOk={() => void submitImport()}
        okButtonProps={{ disabled: !importOptions.name.trim() }} onCancel={() => !isBusy && setImportOpen(false)}>
        <div className="dream-import-form">
          <p>{t("dreamSkin.import.modalDescription")}</p>
          <label htmlFor="dream-skin-name">{t("dreamSkin.import.name")}</label>
          <Input id="dream-skin-name" maxLength={80} value={importOptions.name}
            onChange={(event) => setImportOptions((current) => ({ ...current, name: event.target.value }))} />
          <div className="dream-import-fields">
            <label><span>{t("dreamSkin.import.appearance")}</span><Select value={importOptions.appearance}
              onChange={(appearance: DreamSkinImportOptions["appearance"]) => setImportOptions((current) => ({ ...current, appearance }))}
              options={APPEARANCE_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }))} /></label>
            <label><span>{t("dreamSkin.import.safeArea")}</span><Select value={importOptions.safeArea}
              onChange={(safeArea: DreamSkinImportOptions["safeArea"]) => setImportOptions((current) => ({ ...current, safeArea }))}
              options={SAFE_AREA_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }))} /></label>
            <label><span>{t("dreamSkin.import.taskMode")}</span><Select value={importOptions.taskMode}
              onChange={(taskMode: DreamSkinImportOptions["taskMode"]) => setImportOptions((current) => ({ ...current, taskMode }))}
              options={TASK_MODE_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }))} /></label>
            <label><span>{t("dreamSkin.import.focusX")}</span><InputNumber min={0} max={1} step={0.01}
              placeholder={t("dreamSkin.option.auto")} value={importOptions.focusX}
              onChange={(focusX) => setImportOptions((current) => ({ ...current, focusX }))} /></label>
            <label><span>{t("dreamSkin.import.focusY")}</span><InputNumber min={0} max={1} step={0.01}
              placeholder={t("dreamSkin.option.auto")} value={importOptions.focusY}
              onChange={(focusY) => setImportOptions((current) => ({ ...current, focusY }))} /></label>
          </div>
          <small>{t("dreamSkin.import.requirements")}</small>
        </div>
      </Modal>

      <Modal title={t("dreamSkin.save.modalTitle")} open={saveOpen} confirmLoading={busy === "save"}
        okText={t("dreamSkin.save.action")} cancelText={t("table.cancel")} onOk={() => void submitSave()}
        okButtonProps={{ disabled: !saveName.trim() }} onCancel={() => !isBusy && setSaveOpen(false)}>
        <div className="dream-save-form"><p>{t("dreamSkin.save.description")}</p>
          <label htmlFor="dream-skin-save-name">{t("dreamSkin.import.name")}</label>
          <Input id="dream-skin-save-name" value={saveName} maxLength={80}
            onChange={(event) => setSaveName(event.target.value)} onPressEnter={() => void submitSave()} /></div>
      </Modal>
    </div>
  );
}
