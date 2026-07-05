import type { Account, AppInfo } from "./types";

export const DEMO_ACCOUNTS: Account[] = [
  {
    id: "demo-1",
    email: "alex.chen@example.com",
    note: "Personal account for experiments and everyday Codex work.",
    expiresAt: "2026-12-31",
    plan: "Plus",
    active: true,
    accountId: "workspace-personal",
    usage: {
      primary: { usedPercent: 28, remainingPercent: 72, resetsAt: Date.now() / 1000 + 8200 },
      secondary: { usedPercent: 43, remainingPercent: 57, resetsAt: Date.now() / 1000 + 238000 },
      fetchedAt: new Date().toISOString(),
    },
  },
  {
    id: "demo-2",
    email: "studio@northwind.dev",
    note: "",
    expiresAt: "",
    plan: "Business",
    active: false,
    accountId: "workspace-studio",
    usage: {
      primary: { usedPercent: 64, remainingPercent: 36, resetsAt: Date.now() / 1000 + 4500 },
      secondary: { usedPercent: 19, remainingPercent: 81, resetsAt: Date.now() / 1000 + 410000 },
      fetchedAt: new Date(Date.now() - 12 * 60_000).toISOString(),
    },
  },
];

export const DEMO_INFO: AppInfo = {
  codexHome: "C:\\Users\\you\\.codex",
  authPath: "C:\\Users\\you\\.codex\\auth.json",
  accountStore: "C:\\Users\\you\\AppData\\Roaming\\codex-switch\\accounts",
  version: "0.1.0",
};
