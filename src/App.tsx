import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { Button, ConfigProvider, Dropdown, Progress, Space, Table, Tag, Tooltip, theme as antdTheme } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  ArrowRight,
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
import type { Account, AppInfo, LoginStart, UsageWindow } from "./types";

const isTauri = "__TAURI_INTERNALS__" in window;

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
            <Dropdown
              trigger={["click"]}
              menu={{
                items: [
                  {
                    key: "delete",
                    danger: true,
                    disabled: account.active,
                    icon: <Trash2 size={14} />,
                    label: "删除账户",
                  },
                ],
                onClick: ({ key }) => {
                  if (key === "delete") onDelete(account.id);
                },
              }}
            >
              <Button size="small" className="table-icon-button" icon={<MoreHorizontal size={14} />} />
            </Dropdown>
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
        scroll={{ x: 1092 }}
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

export default function App() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [showLogin, setShowLogin] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

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
    if (!isTauri) return;
    const unlistenAccounts = listen("accounts-changed", () => void load());
    const unlistenLogin = listen<{ ok: boolean; message: string }>("login-status", ({ payload }) => {
      notify(payload.message);
      if (payload.ok) setShowLogin(false);
      void load();
    });
    return () => { void unlistenAccounts.then((fn) => fn()); void unlistenLogin.then((fn) => fn()); };
  }, [load, notify]);

  const active = useMemo(() => accounts.find((account) => account.active), [accounts]);

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
    setRefreshingAll(true);
    await Promise.allSettled(accounts.map((account) => refreshUsage(account.id, true)));
    setRefreshingAll(false);
    notify("所有账户用量已刷新");
  }

  async function deleteAccount(id: string) {
    if (!window.confirm("确定删除这个已保存账户吗？此操作不会注销 ChatGPT。")) return;
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
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><Zap size={19} fill="currentColor" /></div><span>Codex<br /><b>Auth Manager</b></span></div>
        <nav>
          <button className={!showSettings ? "selected" : ""} onClick={() => setShowSettings(false)}><UserRound size={19} />账户管理</button>
          <button className={showSettings ? "selected" : ""} onClick={() => setShowSettings(true)}><Settings size={19} />设置</button>
        </nav>
        <div className="sidebar-bottom">
          <div className="security-chip"><ShieldCheck size={16} /><span><b>本地安全存储</b><small>凭据仅保存在此设备</small></span></div>
          <button className="help-button"><CircleHelp size={17} />使用帮助</button>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div><span className="eyebrow">CODEX / AUTHENTICATION</span><h1>{showSettings ? "设置" : "账户管理"}</h1></div>
          {!showSettings && <button className="primary-button" onClick={() => setShowLogin(true)}><Plus size={18} />添加账户</button>}
        </header>

        {showSettings ? (
          <div className="settings-page">
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
            <section className="overview">
              <div>
                <span className="section-label">已连接账户</span>
                <strong>{accounts.length}</strong>
                <small>个 ChatGPT 账户</small>
              </div>
              <div className="overview-divider" />
              <div className="active-overview">
                <span className="section-label">当前 Codex 身份</span>
                <b>{active?.email ?? "未选择账户"}</b>
                <small>{active ? `${active.plan} · auth.json 已同步` : "添加或导入账户后即可切换"}</small>
              </div>
              <button className="refresh-all" onClick={refreshAll} disabled={refreshingAll || !accounts.length}>
                <RefreshCw className={refreshingAll ? "spin" : ""} size={17} />刷新全部用量
              </button>
            </section>

            <div className="content-heading">
              <div><h2>我的账户</h2><p>查看配额，并在不同 Codex 身份之间快速切换。</p></div>
              <span><span className="live-dot" />配额来自 Codex 实时接口</span>
            </div>

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
      {toast && <div className="toast"><Check size={17} />{toast}</div>}
    </div>
    </ConfigProvider>
  );
}
