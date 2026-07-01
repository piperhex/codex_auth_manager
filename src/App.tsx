import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { Button, ConfigProvider, InputNumber, Popconfirm, Progress, Space, Switch, Table, Tag, Tooltip, theme as antdTheme } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  ArrowRight,
  CalendarClock,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  ExternalLink,
  FileInput,
  FolderKey,
  KeyRound,
  LayoutGrid,
  LogIn,
  MoreHorizontal,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings,
  ShieldCheck,
  Trash2,
  UserRound,
  X,
  Zap,
} from "lucide-react";
import { DEMO_ACCOUNTS, DEMO_INFO } from "./demo";
import type { Account, AppInfo, LoginStart, ResetCreditsSummary, UsageWindow } from "./types";

const isTauri = "__TAURI_INTERNALS__" in window;
const AUTO_REFRESH_KEY = "codex-auth-manager:auto-refresh-seconds";
const AUTO_REFRESH_ENABLED_KEY = "codex-auth-manager:auto-refresh-enabled";
const LAST_AUTO_REFRESH_KEY = "codex-auth-manager:last-auto-refresh-at";
const DEFAULT_AUTO_REFRESH_SECONDS = 5;
const MIN_AUTO_REFRESH_SECONDS = 1;
const MAX_AUTO_REFRESH_SECONDS = 3600;

function clampAutoRefreshSeconds(value: unknown) {
  if (value == null) return DEFAULT_AUTO_REFRESH_SECONDS;
  if (typeof value === "string" && value.trim() === "") return DEFAULT_AUTO_REFRESH_SECONDS;
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return DEFAULT_AUTO_REFRESH_SECONDS;
  return Math.min(MAX_AUTO_REFRESH_SECONDS, Math.max(MIN_AUTO_REFRESH_SECONDS, Math.round(seconds)));
}

function initialAutoRefreshSeconds() {
  return clampAutoRefreshSeconds(window.localStorage.getItem(AUTO_REFRESH_KEY));
}

function initialAutoRefreshEnabled() {
  return window.localStorage.getItem(AUTO_REFRESH_ENABLED_KEY) === "true";
}

function initialLastAutoRefreshAt() {
  const value = window.localStorage.getItem(LAST_AUTO_REFRESH_KEY);
  return value && !Number.isNaN(new Date(value).getTime()) ? value : null;
}

function remainingTone(value: number) {
  if (value <= 15) return "danger";
  if (value <= 35) return "warning";
  return "good";
}

function resetLabel(timestamp?: number | null) {
  if (!timestamp) return "重置时间未知";
  const distance = Math.max(0, timestamp * 1000 - Date.now());
  const minutes = Math.ceil(distance / 60_000);
  if (minutes < 60) return `${minutes} 分钟后重置`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return `${hours} 小时${rest ? ` ${rest} 分` : ""}后重置`;
  return `${Math.floor(hours / 24)} 天 ${hours % 24} 小时后重置`;
}

function initials(email: string) {
  return email.split("@")[0].slice(0, 2).toUpperCase();
}

function UsageRing({ label, window }: { label: string; window?: UsageWindow | null }) {
  const remaining = Math.round(window?.remainingPercent ?? 0);
  const tone = remainingTone(remaining);
  return (
    <div className="usage-unit">
      <div className={`usage-ring ${tone}`} style={{ "--progress": `${remaining * 3.6}deg` } as React.CSSProperties}>
        <div className="usage-ring-inner">
          <strong>{window ? `${remaining}%` : "--"}</strong>
          <span>剩余</span>
        </div>
      </div>
      <div className="usage-copy">
        <b>{label}</b>
        <span>{window ? resetLabel(window.resetsAt) : "等待刷新"}</span>
      </div>
    </div>
  );
}

function AccountCard({
  account,
  busy,
  onSwitch,
  onRefresh,
  onDelete,
}: {
  account: Account;
  busy: string | null;
  onSwitch: (id: string) => void;
  onRefresh: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [menu, setMenu] = useState(false);
  const waiting = busy === account.id;
  const updated = account.usage.fetchedAt
    ? new Date(account.usage.fetchedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    : "尚未刷新";

  return (
    <article className={`account-card ${account.active ? "active" : ""}`}>
      <div className="card-topline" />
      <div className="account-head">
        <div className="avatar">{initials(account.email)}</div>
        <div className="identity">
          <div className="identity-line">
            <h3>{account.email}</h3>
            {account.active && <span className="active-pill"><span />当前使用</span>}
          </div>
          <div className="plan-line">
            <span className="plan-badge">{account.plan || "ChatGPT"}</span>
            <span>{account.accountId ? `工作区 · ${account.accountId.slice(0, 8)}…` : "个人账户"}</span>
          </div>
        </div>
        <div className="menu-wrap">
          <button className="icon-button" aria-label="更多操作" onClick={() => setMenu(!menu)}><MoreHorizontal size={19} /></button>
          {menu && (
            <div className="context-menu">
              <button onClick={() => { setMenu(false); onRefresh(account.id); }}><RefreshCw size={15} />刷新用量</button>
              <button className="destructive" disabled={account.active} onClick={() => { setMenu(false); onDelete(account.id); }}><Trash2 size={15} />删除账户</button>
            </div>
          )}
        </div>
      </div>

      <div className="usage-grid">
        <UsageRing label="5 小时用量" window={account.usage.primary} />
        <UsageRing label="1 周用量" window={account.usage.secondary} />
      </div>

      {account.usage.error && <div className="usage-error">{account.usage.error}</div>}

      <div className="card-footer">
        <span><Clock3 size={14} />用量更新于 {updated}</span>
        {account.active ? (
          <button className="active-button" disabled><Check size={16} />正在使用</button>
        ) : (
          <button className="switch-button" disabled={waiting} onClick={() => onSwitch(account.id)}>
            {waiting ? <RefreshCw className="spin" size={16} /> : <RotateCcw size={16} />}
            切换到此账户
          </button>
        )}
      </div>
    </article>
  );
}

function formatUpdated(timestamp?: string | null) {
  if (!timestamp) return "尚未刷新";
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) return "时间未知";
  return value.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatAutoRefreshTime(timestamp?: string | null) {
  if (!timestamp) return "暂无";
  return new Date(timestamp).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function usageStroke(value: number) {
  const tone = remainingTone(value);
  if (tone === "danger") return "#d2685b";
  if (tone === "warning") return "#d0a340";
  return "#1f7a51";
}

function UsageMeter({ window }: { window?: UsageWindow | null }) {
  if (!window) return <span className="usage-missing">--</span>;
  const remaining = Math.round(window.remainingPercent);
  const tone = remainingTone(remaining);

  return (
    <div className="table-usage">
      <div className="table-usage-head">
        <strong className={tone}>{remaining}%</strong>
        <span>剩余</span>
      </div>
      <Progress percent={remaining} showInfo={false} size="small" strokeColor={usageStroke(remaining)} />
      <span className="usage-reset">{resetLabel(window.resetsAt)}</span>
    </div>
  );
}

type ResetCreditsLoadState =
  | { status: "loading" }
  | { status: "loaded"; data: ResetCreditsSummary }
  | { status: "error"; error: string };

function formatBeijingTime(timestamp?: string | null) {
  if (!timestamp) return "时间未知";
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(value);
}

function ResetCreditsPanel({
  state,
  onRetry,
}: {
  state?: ResetCreditsLoadState;
  onRetry: () => void;
}) {
  if (!state || state.status === "loading") {
    return <div className="reset-credits-status"><RefreshCw className="spin" size={16} />正在读取重置卡…</div>;
  }
  if (state.status === "error") {
    return (
      <div className="reset-credits-status reset-credits-error">
        <span>{state.error}</span>
        <Button size="small" icon={<RefreshCw size={13} />} onClick={onRetry}>重试</Button>
      </div>
    );
  }
  if (!state.data.credits.length) {
    return <div className="reset-credits-status">当前账号没有重置卡</div>;
  }

  return (
    <div className="reset-credits-panel">
      {state.data.credits.map((credit, index) => (
        <div className="reset-credit" key={`${credit.issuedAt ?? "unknown"}-${credit.expiresAt ?? "unknown"}-${index}`}>
          <div className="reset-credit-index"><CalendarClock size={16} />重置卡 {index + 1}</div>
          <dl>
            <div><dt>发放时间</dt><dd>{formatBeijingTime(credit.issuedAt)} <span>北京时间</span></dd></div>
            <div><dt>过期时间</dt><dd>{formatBeijingTime(credit.expiresAt)} <span>北京时间</span></dd></div>
          </dl>
        </div>
      ))}
    </div>
  );
}

function AccountTable({
  accounts,
  busy,
  onSwitch,
  onRefresh,
  onDelete,
}: {
  accounts: Account[];
  busy: string | null;
  onSwitch: (id: string) => void;
  onRefresh: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [resetCredits, setResetCredits] = useState<Record<string, ResetCreditsLoadState>>({});
  const resetCreditRequests = useRef(new Set<string>());

  const loadResetCredits = useCallback(async (account: Account, force = false) => {
    if (resetCreditRequests.current.has(account.id)) return;
    if (!force && resetCredits[account.id]) return;
    resetCreditRequests.current.add(account.id);
    setResetCredits((current) => ({ ...current, [account.id]: { status: "loading" } }));
    try {
      const data = isTauri
        ? await invoke<ResetCreditsSummary>("fetch_reset_credits", { id: account.id })
        : {
            credits: [
              {
                issuedAt: new Date(Date.now() - 3 * 24 * 60 * 60_000).toISOString(),
                expiresAt: new Date(Date.now() + 27 * 24 * 60 * 60_000).toISOString(),
              },
            ],
          };
      setResetCredits((current) => ({ ...current, [account.id]: { status: "loaded", data } }));
    } catch (error) {
      setResetCredits((current) => ({
        ...current,
        [account.id]: { status: "error", error: String(error) },
      }));
    } finally {
      resetCreditRequests.current.delete(account.id);
    }
  }, [resetCredits]);

  const columns: ColumnsType<Account> = [
    {
      title: "账号",
      dataIndex: "email",
      width: 300,
      fixed: "left",
      sorter: (left, right) => left.email.localeCompare(right.email),
      render: (_, account) => (
        <div className="account-cell">
          <div className="table-avatar">{initials(account.email)}</div>
          <div className="account-primary">
            <div className="account-email" title={account.email}>{account.email}</div>
            <div className="account-meta">
              {account.active ? <Tag color="success">当前</Tag> : <Tag>备用</Tag>}
            </div>
          </div>
        </div>
      ),
    },
    {
      title: "套餐 / ID",
      width: 190,
      render: (_, account) => (
        <div className="plan-stack">
          <Tag className="plan-tag">{account.plan || "ChatGPT"}</Tag>
          <span className="account-id" title={account.accountId ?? ""}>
            {account.accountId ? `工作区 · ${account.accountId.slice(0, 12)}` : "个人账户"}
          </span>
        </div>
      ),
    },
    {
      title: "5 小时",
      width: 150,
      render: (_, account) => <UsageMeter window={account.usage.primary} />,
    },
    {
      title: "1 周",
      width: 150,
      render: (_, account) => <UsageMeter window={account.usage.secondary} />,
    },
    {
      title: "更新",
      width: 126,
      render: (_, account) => (
        <div className="updated-cell">
          <Clock3 size={13} />
          <span>{formatUpdated(account.usage.fetchedAt)}</span>
          {account.usage.error && <Tooltip title={account.usage.error}><Tag color="error">错误</Tag></Tooltip>}
        </div>
      ),
    },
    {
      title: "操作",
      width: 176,
      align: "right",
      fixed: "right",
      render: (_, account) => {
        const waiting = busy === account.id;
        return (
          <Space size={4} className="table-actions">
            <Button
              size="small"
              type={account.active ? "default" : "primary"}
              disabled={account.active}
              loading={waiting}
              icon={account.active ? <Check size={14} /> : <RotateCcw size={14} />}
              onClick={() => onSwitch(account.id)}
            >
              {account.active ? "使用中" : "切换"}
            </Button>
            <Tooltip title="刷新用量">
              <Button
                size="small"
                className="table-icon-button"
                loading={waiting}
                icon={<RefreshCw size={14} />}
                onClick={() => onRefresh(account.id)}
              />
            </Tooltip>
            <Popconfirm
              title="确认删除此账户？"
              description="只会删除本地保存的账户，不会注销 ChatGPT。"
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              disabled={account.active}
              onConfirm={() => onDelete(account.id)}
            >
              <Tooltip title={account.active ? "正在使用的账户无法删除" : "删除账户"}>
                <Button
                  danger
                  size="small"
                  className="table-icon-button"
                  aria-label="删除账户"
                  disabled={account.active}
                  icon={<Trash2 size={14} />}
                />
              </Tooltip>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  return (
    <div className="account-table-wrap">
      <Table
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={accounts}
        pagination={false}
        rowClassName={(account) => (account.active ? "active-row" : "")}
        expandable={{
          columnWidth: 42,
          expandedRowRender: (account) => (
            <ResetCreditsPanel
              state={resetCredits[account.id]}
              onRetry={() => void loadResetCredits(account, true)}
            />
          ),
          onExpand: (expanded, account) => {
            if (expanded) void loadResetCredits(account);
          },
        }}
        scroll={{ x: 1134 }}
      />
    </div>
  );
}

function LoginModal({ onClose, onStart, onImport }: { onClose: () => void; onStart: (embedded: boolean) => void; onImport: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="modal-close" aria-label="关闭添加账户窗口" onClick={onClose}><X size={19} /></button>
        <div className="modal-icon"><KeyRound size={25} /></div>
        <h2>添加 Codex 账户</h2>
        <p>使用 ChatGPT 完成授权，凭据会直接保存在本机，不经过前端页面。</p>

        <button type="button" className="login-choice featured" onClick={() => onStart(true)}>
          <span className="choice-icon"><LayoutGrid size={20} /></span>
          <span><b>在应用内登录</b><small>打开独立安全窗口完成 ChatGPT 授权</small></span>
          <ChevronRight size={19} />
        </button>
        <button type="button" className="login-choice" onClick={() => onStart(false)}>
          <span className="choice-icon"><ExternalLink size={20} /></span>
          <span><b>使用默认浏览器</b><small>遇到企业 SSO 或内嵌限制时推荐</small></span>
          <ChevronRight size={19} />
        </button>
        <div className="modal-divider"><span>或者</span></div>
        <button type="button" className="import-choice" onClick={onImport}><FileInput size={17} />导入已有 auth.json</button>
        <div className="safety-note"><ShieldCheck size={16} />Token 不会显示在界面或写入日志</div>
      </section>
    </div>
  );
}

function HelpModal({ onClose, version }: { onClose: () => void; version: string }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="modal help-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className="modal-close" aria-label="关闭使用帮助" onClick={onClose}><X size={19} /></button>
        <div className="modal-icon"><CircleHelp size={25} /></div>
        <h2 id="help-modal-title">使用帮助</h2>
        <p>Codex Auth Manager 用于在本机安全地管理多个 Codex 账户。</p>

        <div className="help-features">
          <div><UserRound size={18} /><span><b>多账户管理</b><small>登录 ChatGPT 或导入已有 auth.json，集中保存多个账户。</small></span></div>
          <div><RotateCcw size={18} /><span><b>快速切换</b><small>切换账户时自动同步当前 Codex 使用的 auth.json。</small></span></div>
          <div><RefreshCw size={18} /><span><b>用量查看</b><small>查看 5 小时与 1 周配额，支持单个或全部账户刷新。</small></span></div>
          <div><Clock3 size={18} /><span><b>自动刷新</b><small>可在设置中开启、关闭并调整全局用量刷新间隔。</small></span></div>
          <div><CalendarClock size={18} /><span><b>重置卡信息</b><small>展开账户行即可查看重置卡的发放和过期时间。</small></span></div>
          <div><ShieldCheck size={18} /><span><b>本地安全存储</b><small>令牌保留在 Rust 后端，不会显示在界面或写入日志。</small></span></div>
        </div>

        <div className="help-version"><span>Codex Auth Manager</span><b>v{version}</b></div>
      </section>
    </div>
  );
}

export default function App() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [showLogin, setShowLogin] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [autoRefreshSeconds, setAutoRefreshSeconds] = useState(initialAutoRefreshSeconds);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(initialAutoRefreshEnabled);
  const [lastAutoRefreshAt, setLastAutoRefreshAt] = useState(initialLastAutoRefreshAt);
  const [toast, setToast] = useState<string | null>(null);
  const refreshingAllRef = useRef(false);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3400);
  }, []);

  const load = useCallback(async () => {
    if (!isTauri) {
      setAccounts(DEMO_ACCOUNTS);
      setInfo(DEMO_INFO);
      setLoading(false);
      return;
    }
    try {
      const [nextAccounts, nextInfo] = await Promise.all([
        invoke<Account[]>("list_accounts"),
        invoke<AppInfo>("get_app_info"),
      ]);
      setAccounts(nextAccounts);
      setInfo(nextInfo);
    } catch (error) {
      notify(String(error));
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    window.localStorage.setItem(AUTO_REFRESH_KEY, String(autoRefreshSeconds));
  }, [autoRefreshSeconds]);

  useEffect(() => {
    window.localStorage.setItem(AUTO_REFRESH_ENABLED_KEY, String(autoRefreshEnabled));
  }, [autoRefreshEnabled]);

  useEffect(() => {
    if (lastAutoRefreshAt) window.localStorage.setItem(LAST_AUTO_REFRESH_KEY, lastAutoRefreshAt);
    else window.localStorage.removeItem(LAST_AUTO_REFRESH_KEY);
  }, [lastAutoRefreshAt]);

  useEffect(() => {
    if (!isTauri) return;
    const unlistenAccounts = listen("accounts-changed", () => void load());
    const unlistenLogin = listen<{ ok: boolean; message: string }>("login-status", ({ payload }) => {
      notify(payload.message);
      if (payload.ok) setShowLogin(false);
      void load();
    });
    return () => { void unlistenAccounts.then((fn) => fn()); void unlistenLogin.then((fn) => fn()); };
  }, [load, notify]);

  const updateAutoRefreshSeconds = useCallback((value: number | string | null) => {
    setAutoRefreshSeconds(clampAutoRefreshSeconds(value));
  }, []);

  const refreshAllUsage = useCallback(async (
    {
      quiet = false,
      showSpinner = true,
      automatic = false,
    }: { quiet?: boolean; showSpinner?: boolean; automatic?: boolean } = {},
  ) => {
    if (!accounts.length || refreshingAllRef.current) return;
    refreshingAllRef.current = true;
    if (showSpinner) setRefreshingAll(true);
    try {
      if (isTauri) {
        await Promise.allSettled(accounts.map((account) => invoke("refresh_usage", { id: account.id })));
        await load();
      } else {
        const fetchedAt = new Date().toISOString();
        setAccounts((items) => items.map((item) => ({ ...item, usage: { ...item.usage, fetchedAt } })));
      }
      if (automatic) setLastAutoRefreshAt(new Date().toISOString());
      if (!quiet) notify("所有账户用量已刷新");
    } finally {
      if (showSpinner) setRefreshingAll(false);
      refreshingAllRef.current = false;
    }
  }, [accounts, load, notify]);

  useEffect(() => {
    if (!autoRefreshEnabled || !accounts.length) return;
    const timer = window.setInterval(() => {
      void refreshAllUsage({ quiet: true, showSpinner: false, automatic: true });
    }, autoRefreshSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [accounts.length, autoRefreshEnabled, autoRefreshSeconds, refreshAllUsage]);

  async function startLogin(embedded: boolean) {
    if (!isTauri) { setShowLogin(false); notify("浏览器预览模式不会发起真实登录"); return; }
    setShowLogin(false);
    notify(embedded ? "正在打开应用内登录窗口..." : "正在打开默认浏览器...");
    try {
      await invoke<LoginStart>("start_login", { embedded });
      notify(embedded ? "登录窗口已打开" : "已在默认浏览器中打开登录页面");
    } catch (error) { notify(String(error)); }
  }

  async function importAuth() {
    if (!isTauri) { setShowLogin(false); notify("浏览器预览模式不会读取本地文件"); return; }
    setShowLogin(false);
    notify("请选择要导入的 auth.json");
    const selected = await open({ multiple: false, filters: [{ name: "Codex auth.json", extensions: ["json"] }] });
    if (!selected) return;
    try {
      await invoke("import_auth_file", { path: selected });
      setShowLogin(false);
      notify("账户已导入");
      await load();
    } catch (error) { notify(String(error)); }
  }

  async function switchAccount(id: string) {
    setBusy(id);
    try {
      if (isTauri) await invoke("switch_account", { id });
      else setAccounts((items) => items.map((item) => ({ ...item, active: item.id === id })));
      notify("已覆盖 ~/.codex/auth.json；运行中的 Codex 可能需要重新启动");
      await load();
    } catch (error) { notify(String(error)); } finally { setBusy(null); }
  }

  async function refreshUsage(id: string, quiet = false) {
    setBusy(id);
    try {
      if (isTauri) await invoke("refresh_usage", { id });
      if (!quiet) notify("用量已刷新");
      await load();
    } catch (error) { if (!quiet) notify(String(error)); } finally { setBusy(null); }
  }

  async function refreshAll() {
    await refreshAllUsage();
  }

  async function deleteAccount(id: string) {
    try {
      if (isTauri) await invoke("delete_account", { id });
      else setAccounts((items) => items.filter((item) => item.id !== id));
      notify("账户已删除");
      await load();
    } catch (error) { notify(String(error)); }
  }

  return (
    <ConfigProvider
      theme={{
        algorithm: antdTheme.compactAlgorithm,
        token: {
          colorPrimary: "#1f7a51",
          borderRadius: 6,
          fontFamily: "\"DM Sans\", \"Microsoft YaHei UI\", sans-serif",
        },
      }}
    >
    <div className="app-shell">
      <header className="app-menu">
        <div className="brand"><div className="brand-mark"><Zap size={19} fill="currentColor" /></div><span>Codex<br /><b>Auth Manager</b></span></div>
        <nav className="top-tabs" aria-label="主导航">
          <button className={!showSettings ? "selected" : ""} onClick={() => setShowSettings(false)}><UserRound size={19} />账户管理</button>
          <button className={showSettings ? "selected" : ""} onClick={() => setShowSettings(true)}><Settings size={19} />设置</button>
        </nav>
        <div className="menu-tools">
          <div className="security-chip"><ShieldCheck size={16} /><span><b>本地安全存储</b><small>凭据仅保存在此设备</small></span></div>
          <button className="help-button" onClick={() => setShowHelp(true)}><CircleHelp size={17} />使用帮助</button>
        </div>
      </header>

      <main>
        <header className="topbar">
          <div><span className="eyebrow">CODEX / AUTHENTICATION</span><h1>{showSettings ? "设置" : `账户管理（${accounts.length}）`}</h1></div>
          {!showSettings && (
            <div className="topbar-actions">
              <button className="primary-button" onClick={() => setShowLogin(true)}><Plus size={18} />添加账户</button>
              <div className="refresh-all-wrap">
                <button className="refresh-all" onClick={refreshAll} disabled={refreshingAll || !accounts.length}>
                  <RefreshCw className={refreshingAll ? "spin" : ""} size={17} />刷新全部用量
                </button>
                <small className="last-auto-refresh">
                  最后更新：{formatAutoRefreshTime(lastAutoRefreshAt)}
                </small>
              </div>
            </div>
          )}
        </header>

        {showSettings ? (
          <div className="settings-page">
            <section className="settings-card">
              <div className="settings-icon"><RefreshCw size={23} /></div>
              <div>
                <h3>用量自动刷新</h3>
                <p>关闭后不会再定时请求用量，手动刷新仍可正常使用。</p>
                <div className="settings-field">
                  <label htmlFor="auto-refresh-enabled">自动刷新</label>
                  <Switch
                    id="auto-refresh-enabled"
                    checked={autoRefreshEnabled}
                    checkedChildren="开"
                    unCheckedChildren="关"
                    onChange={setAutoRefreshEnabled}
                  />
                  <label htmlFor="auto-refresh-interval">刷新间隔</label>
                  <InputNumber
                    id="auto-refresh-interval"
                    min={MIN_AUTO_REFRESH_SECONDS}
                    max={MAX_AUTO_REFRESH_SECONDS}
                    step={1}
                    addonAfter="秒"
                    value={autoRefreshSeconds}
                    disabled={!autoRefreshEnabled}
                    onChange={updateAutoRefreshSeconds}
                  />
                </div>
              </div>
            </section>
            <section className="settings-card">
              <div className="settings-icon"><FolderKey size={23} /></div>
              <div><h3>Codex Home</h3><p>切换账户时，管理器会原子覆盖此目录中的 auth.json。</p><code>{info?.codexHome ?? "读取中…"}</code></div>
            </section>
            <section className="settings-card">
              <div className="settings-icon"><KeyRound size={23} /></div>
              <div><h3>账户仓库</h3><p>每个账户的完整 auth.json 独立保存于应用数据目录。</p><code>{info?.accountStore ?? "读取中…"}</code></div>
            </section>
            <section className="settings-card note-card">
              <div className="settings-icon"><ShieldCheck size={23} /></div>
              <div><h3>安全说明</h3><p>前端只接收邮箱、套餐和用量摘要。访问令牌、刷新令牌不会离开 Rust 后端，也不会进入界面日志。</p></div>
            </section>
          </div>
        ) : (
          <>
            {loading ? (
              <div className="loading-state"><RefreshCw className="spin" />正在读取本地账户…</div>
            ) : accounts.length ? (
              <AccountTable accounts={accounts} busy={busy} onSwitch={switchAccount} onRefresh={refreshUsage} onDelete={deleteAccount} />
            ) : (
              <div className="empty-state">
                <div><LogIn size={28} /></div><h2>还没有保存的账户</h2><p>登录 ChatGPT，或导入已有的 auth.json 开始管理。</p>
                <button className="primary-button" onClick={() => setShowLogin(true)}>添加第一个账户<ArrowRight size={17} /></button>
              </div>
            )}
          </>
        )}
      </main>

      {showLogin && <LoginModal onClose={() => setShowLogin(false)} onStart={startLogin} onImport={importAuth} />}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} version={info?.version ?? "0.1.0"} />}
      {toast && <div className="toast"><Check size={17} />{toast}</div>}
    </div>
    </ConfigProvider>
  );
}
