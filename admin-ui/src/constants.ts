import type { MenuKey } from "./types";

export const TOKEN_KEY = "codex-switch-admin-auth";
export const THEME_KEY = "codex-switch-admin-theme";

export const actionLabels: Record<string, string> = {
  "user.create": "创建用户",
  "user.update": "更新用户",
  "user.delete": "删除用户",
  "profile.password.change": "修改密码",
  "sync-account.update": "更新同步账号",
  "sync-account.delete": "删除同步账号",
  "invitation.create": "创建邀请",
  "invitation.revoke": "撤销邀请",
  "invitation.accept": "接受邀请",
  "approval.request": "提交审批",
  "approval.approved": "审批通过",
  "approval.rejected": "审批拒绝",
};

export const menuLabels: Record<MenuKey, string> = {
  users: "用户管理",
  audit: "审计日志",
  invitations: "邀请注册",
  approvals: "管理员审批",
};
