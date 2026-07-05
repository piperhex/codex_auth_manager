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
  note: string;
  expiresAt: string;
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

export type ResetCreditsLoadState =
  | { status: "loading" }
  | { status: "loaded"; data: ResetCreditsSummary; fetchedAt: string }
  | { status: "error"; error: string };

export interface AppInfo {
  codexHome: string;
  authPath: string;
  accountStore: string;
  version: string;
}

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  releaseName: string;
  releaseNotes?: string | null;
  releaseUrl: string;
}

export interface AppSettings {
  floatingBubbleEnabled: boolean;
  themeColor?: string | null;
  bubbleX?: number | null;
  bubbleY?: number | null;
  cloudBaseUrl?: string | null;
}

export interface LoginStart {
  url: string;
  embedded: boolean;
}

export interface LoginStatus {
  ok: boolean;
  message: string;
  accountId?: string | null;
}

export interface CloudAuthState {
  enabled: boolean;
  baseUrl?: string | null;
  authenticated: boolean;
  userEmail?: string | null;
  userId?: string | null;
  lastSyncAt?: string | null;
}

export interface CloudSyncResult {
  uploaded: number;
  downloaded: number;
}

export interface AccountArchiveImportResult {
  imported: number;
  accountIds: string[];
  activeAccountId?: string | null;
}
