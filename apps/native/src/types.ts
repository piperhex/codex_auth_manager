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

export interface AccountSummary {
  id: string;
  email: string;
  note: string;
  expiresAt: string;
  plan: string;
  accountId?: string | null;
  active: boolean;
  usage: UsageSummary;
  lastModifiedAt?: string;
}

export interface AuthSession {
  baseUrl: string;
  accessToken: string;
  refreshToken: string;
  email: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user?: { id: string; email: string };
}
