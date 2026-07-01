export interface UsageWindow {
  usedPercent: number;
  remainingPercent: number;
  resetsAt?: number | null;
  windowMinutes?: number | null;
}

export interface UsageSummary {
  primary?: UsageWindow | null;
  secondary?: UsageWindow | null;
  fetchedAt?: string | null;
  error?: string | null;
}

export interface Account {
  id: string;
  email: string;
  plan: string;
  accountId?: string | null;
  active: boolean;
  usage: UsageSummary;
}

export interface AppInfo {
  codexHome: string;
  authPath: string;
  accountStore: string;
}

export interface LoginStart {
  url: string;
  embedded: boolean;
}
