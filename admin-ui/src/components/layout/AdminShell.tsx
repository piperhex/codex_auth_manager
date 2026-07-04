import type { ReactNode } from "react";
import { Avatar, Button, Dropdown, Layout, Menu, Space, Tooltip, Typography } from "antd";
import type { MenuProps } from "antd";
import {
  FileClock,
  GitPullRequest,
  KeyRound,
  LogOut,
  MailPlus,
  Moon,
  Sun,
  UserRound,
  Users,
} from "lucide-react";
import { menuLabels } from "../../constants";
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

const menuItems: MenuProps["items"] = [
  { key: "users", icon: <Users size={17} />, label: menuLabels.users },
  { key: "audit", icon: <FileClock size={17} />, label: menuLabels.audit },
  { key: "invitations", icon: <MailPlus size={17} />, label: menuLabels.invitations },
  { key: "approvals", icon: <GitPullRequest size={17} />, label: menuLabels.approvals },
];

const avatarMenu: MenuProps["items"] = [
  { key: "profile", icon: <UserRound size={15} />, label: "用户信息" },
  { key: "password", icon: <KeyRound size={15} />, label: "修改密码" },
  { type: "divider" },
  { key: "logout", icon: <LogOut size={15} />, label: "退出登录" },
];

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
  return (
    <Layout className="admin-shell">
      <Layout.Sider breakpoint="lg" collapsedWidth={0} width={232}>
        <div className="brand-block" style={{ height: 58, padding: "0 18px" }}>
          <div className="brand-mark">C</div>
          <div className="brand-copy">
            <strong>Codex Switch</strong>
            <span>Admin Console</span>
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
            <strong>{menuLabels[activeKey]}</strong>
            <span>{profile?.email}</span>
          </div>
          <div className="header-actions">
            <Tooltip title={dark ? "浅色主题" : "深色主题"}>
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
