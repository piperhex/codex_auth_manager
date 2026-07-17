import { useMemo, type ReactNode } from "react";
import { Avatar, Button, Dropdown, Layout, Menu, Segmented, Space, Tooltip, Typography } from "antd";
import type { MenuProps } from "antd";
import {
  Activity,
  FileClock,
  BadgeCheck,
  BellRing,
  GitPullRequest,
  KeyRound,
  Languages,
  LogOut,
  MailPlus,
  MessageSquareText,
  Moon,
  Rows3,
  Sun,
  UserRound,
  Users,
} from "lucide-react";
import { LANGUAGE_OPTIONS, type Language, type TranslationKey } from "../../i18n";
import { useI18n } from "../../i18n-context";
import type { MenuKey, Permission, Profile } from "../../types";

interface AdminShellProps {
  activeKey: MenuKey;
  dark: boolean;
  profile: Profile | null;
  children: ReactNode;
  onMenuChange: (key: MenuKey) => void;
  onThemeChange: (value: boolean) => void;
  onOpenProfile: () => void;
  onOpenPassword: () => void;
  onSignOut: () => Promise<void>;
}

const menuLabelKeys: Record<MenuKey, TranslationKey> = {
  myAccounts: "nav.myAccounts",
  users: "nav.users",
  officialAccounts: "nav.officialAccounts",
  announcement: "nav.announcement",
  feedback: "nav.feedback",
  telemetry: "nav.telemetry",
  audit: "nav.audit",
  invitations: "nav.invitations",
  approvals: "nav.approvals",
};

const menuPermissions: Record<MenuKey, Permission> = {
  myAccounts: "self.accounts.read",
  users: "admin.users.read",
  officialAccounts: "admin.official-accounts.read",
  announcement: "admin.announcements.read",
  feedback: "admin.feedback.read",
  telemetry: "admin.telemetry.read",
  audit: "admin.audit-logs.read",
  invitations: "admin.invitations.read",
  approvals: "admin.approvals.read",
};

export function AdminShell({
  activeKey,
  children,
  dark,
  profile,
  onMenuChange,
  onOpenPassword,
  onOpenProfile,
  onSignOut,
  onThemeChange,
}: AdminShellProps) {
  const { language, setLanguage, t } = useI18n();
  const menuItems = useMemo<MenuProps["items"]>(() => {
    const permissions = new Set(profile?.permissions ?? []);
    const items = [
      { key: "myAccounts" as const, icon: <Rows3 size={17} />, label: t("nav.myAccounts") },
      { key: "users" as const, icon: <Users size={17} />, label: t("nav.users") },
      { key: "officialAccounts" as const, icon: <BadgeCheck size={17} />, label: t("nav.officialAccounts") },
      { key: "announcement" as const, icon: <BellRing size={17} />, label: t("nav.announcement") },
      { key: "feedback" as const, icon: <MessageSquareText size={17} />, label: t("nav.feedback") },
      { key: "telemetry" as const, icon: <Activity size={17} />, label: t("nav.telemetry") },
      { key: "audit" as const, icon: <FileClock size={17} />, label: t("nav.audit") },
      { key: "invitations" as const, icon: <MailPlus size={17} />, label: t("nav.invitations") },
      { key: "approvals" as const, icon: <GitPullRequest size={17} />, label: t("nav.approvals") },
    ];
    return items.filter((item) => permissions.has(menuPermissions[item.key]));
  }, [profile?.permissions, t]);

  const avatarMenu = useMemo<MenuProps["items"]>(() => [
    { key: "profile", icon: <UserRound size={15} />, label: t("header.profile") },
    { key: "password", icon: <KeyRound size={15} />, label: t("header.password") },
    { type: "divider" },
    { key: "logout", icon: <LogOut size={15} />, label: t("header.logout") },
  ], [t]);

  return (
    <Layout className="admin-shell">
      <Layout.Sider breakpoint="lg" collapsedWidth={0} width={232}>
        <div className="brand-block" style={{ height: 58, padding: "0 18px" }}>
          <div className="brand-mark">C</div>
          <div className="brand-copy">
            <strong>Codex Switch</strong>
            <span>{t("app.subtitle")}</span>
          </div>
        </div>
        <Menu
          theme="dark"
          selectedKeys={[activeKey]}
          items={menuItems}
          onClick={(event) => onMenuChange(event.key as MenuKey)}
          mode="inline"
        />
      </Layout.Sider>
      <Layout>
        <header className="app-header">
          <div className="brand-copy">
            <strong>{t(menuLabelKeys[activeKey])}</strong>
            <span>{profile?.email}</span>
          </div>
          <div className="header-actions">
            <div className="language-control" aria-label={t("language.label")}>
              <Languages size={15} />
              <Segmented
                size="small"
                value={language}
                options={[...LANGUAGE_OPTIONS]}
                onChange={(value) => setLanguage(value as Language)}
              />
            </div>
            <Tooltip title={dark ? t("header.lightTheme") : t("header.darkTheme")}>
              <Button
                className="icon-button"
                icon={dark ? <Sun size={16} /> : <Moon size={16} />}
                onClick={() => onThemeChange(!dark)}
              />
            </Tooltip>
            <Dropdown
              menu={{
                items: avatarMenu,
                onClick: async ({ key }) => {
                  if (key === "profile") onOpenProfile();
                  if (key === "password") onOpenPassword();
                  if (key === "logout") await onSignOut();
                },
              }}
              trigger={["click"]}
            >
              <Button type="text">
                <Space>
                  <Avatar size={30}>{profile?.email.slice(0, 1).toUpperCase()}</Avatar>
                  <Typography.Text>{profile?.email}</Typography.Text>
                </Space>
              </Button>
            </Dropdown>
          </div>
        </header>
        <main className="content-wrap">{children}</main>
      </Layout>
    </Layout>
  );
}
