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
  autoSwitchEnabled: boolean;
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
  configPath: string;
  accountStore: string;
  providerStore: string;
  version: string;
}

export type ProviderApiFormat = "openaiResponses" | "openaiChat";

export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  models: string[];
  modelSelectionControlledByCodex: boolean;
  apiFormat: ProviderApiFormat;
  active: boolean;
  hasApiKey: boolean;
  supportsDirectSwitch: boolean;
}

export interface ProviderInput {
  id?: string;
  name: string;
  baseUrl: string;
  model: string;
  models: string[];
  modelSelectionControlledByCodex: boolean;
  apiKey?: string;
  apiFormat: ProviderApiFormat;
}

export interface LocalProxyStatus {
  running: boolean;
  address: string;
  port: number;
  baseUrl: string;
  autoSwitchOnQuotaExhaustion: boolean;
  autoDisableUnreachableAccounts: boolean;
}

export interface DirectConversationSyncResult {
  conversationsUpdated: number;
  rolloutFilesUpdated: number;
}

export interface TokenUsageEntry {
  id: string;
  ts: number;
  provider: string;
  accountId?: string | null;
  accountEmail?: string | null;
  model: string;
  durationMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  reasoningTokens?: number | null;
  cachedTokens?: number | null;
  totalTokens?: number | null;
}

export interface DailyTokenUsage {
  date: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
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
  privacyMode: boolean;
  bubbleResetDisplay: BubbleResetDisplay;
  themeColor?: string | null;
  bubbleX?: number | null;
  bubbleY?: number | null;
  cloudBaseUrl?: string | null;
  tokenUsageWeeks?: number;
  tokenUsageRefreshSeconds?: number;
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

export interface CloudAnnouncement {
  /** Legacy Chinese content returned for compatibility with older clients. */
  content: string;
  contentZh: string;
  contentEn: string;
  link: string;
  enabled: boolean;
  textColor: string;
  backgroundColor: string;
  scrollDurationSeconds: number;
  updatedAt?: string | null;
}

export interface FeedbackImageInput {
  fileName: string;
  mimeType: string;
  dataBase64: string;
}

export interface AccountArchiveImportResult {
  imported: number;
  accountIds: string[];
  activeAccountId?: string | null;
  providersImported: number;
  providerIds: string[];
  activeProviderId?: string | null;
}

export type BubbleResetDisplay = "countdown" | "resetAt";

export interface DreamSkinThemeSummary {
  id: string;
  name: string;
}

export type DreamSkinSession = "unsupported" | "notInstalled" | "ready" | "active" | "paused";
export type DreamSkinAppearance = "auto" | "light" | "dark";

export interface DreamSkinStatus {
  supported: boolean;
  platform: string;
  installed: boolean;
  runtimeInstalled: boolean;
  session: DreamSkinSession;
  activeThemeId?: string | null;
  activeThemeName?: string | null;
  activeThemeAppearance?: DreamSkinAppearance | null;
  enginePath?: string | null;
  savedThemes: DreamSkinThemeSummary[];
}

export interface DreamSkinImportOptions {
  name: string;
  appearance: DreamSkinAppearance;
  safeArea: "auto" | "left" | "right" | "center" | "none";
  taskMode: "auto" | "ambient" | "banner" | "off";
  focusX?: number | null;
  focusY?: number | null;
}
