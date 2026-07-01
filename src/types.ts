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

export interface ResetCredit {
  issuedAt?: string | null;
  expiresAt?: string | null;
}

export interface ResetCreditsSummary {
  credits: ResetCredit[];
}

export interface AppInfo {
  codexHome: string;
  authPath: string;
  accountStore: string;
  version: string;
}

export interface LoginStart {
  url: string;
  embedded: boolean;
}
