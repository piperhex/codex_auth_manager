import { useMemo, type ReactNode } from "react";
import { Avatar, Button, Dropdown, Layout, Menu, Segmented, Space, Tooltip, Typography } from "antd";
import type { MenuProps } from "antd";
import {
  FileClock,
  GitPullRequest,
  KeyRound,
  Languages,
  LogOut,
  MailPlus,
  Moon,
  Sun,
  UserRound,
  Users,
} from "lucide-react";
import { LANGUAGE_OPTIONS, type Language, type TranslationKey } from "../../i18n";
import { useI18n } from "../../i18n-context";
import type { MenuKey, Profile } from "../../types";

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
  users: "nav.users",
  audit: "nav.audit",
  invitations: "nav.invitations",
  approvals: "nav.approvals",
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
  const menuItems = useMemo<MenuProps["items"]>(() => [
    { key: "users", icon: <Users size={17} />, label: t("nav.users") },
    { key: "audit", icon: <FileClock size={17} />, label: t("nav.audit") },
    { key: "invitations", icon: <MailPlus size={17} />, label: t("nav.invitations") },
    { key: "approvals", icon: <GitPullRequest size={17} />, label: t("nav.approvals") },
  ], [t]);

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
