import * as SecureStore from 'expo-secure-store';
import type {
  AccountSummary,
  AuthResponse,
  AuthSession,
  RemoteDevice,
  ResetCreditsSummary,
  UsageSummary,
  UsageWindow,
  UserProfile,
} from '../types';

const SESSION_KEY = 'codex-switch.mobile.session.v1';
const GLOBAL_REFRESH_INTERVAL_KEY = 'codex-switch.mobile.global-refresh-minutes.v1';
const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const CODEX_RESET_CREDITS_URL =
  'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits';
const CODEX_RESET_CREDIT_CONSUME_URL =
  'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume';
const CODEX_ORIGINATOR = 'codex_cli_rs';
export const DEFAULT_GLOBAL_REFRESH_MINUTES = 30;
export const DEFAULT_CLOUD_BASE_URL = 'https://codex.onepiper.cloud';

export class ApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'ApiError';
  }
}

export class SessionExpiredError extends ApiError {
  constructor(status = 401) {
    super('登录已过期，请重新登录', status);
    this.name = 'SessionExpiredError';
  }
}

export function isSessionExpiredError(error: unknown): error is SessionExpiredError {
  return error instanceof SessionExpiredError;
}

function normalizeBaseUrl(value: string) {
  const baseUrl = value.trim().replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new ApiError('请输入有效的服务器地址，例如 https://api.example.com');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ApiError('服务器地址必须以 http:// 或 https:// 开头');
  }
  return baseUrl;
}

async function parseError(response: Response) {
  try {
    const payload: unknown = await response.json();
    if (payload && typeof payload === 'object' && 'message' in payload) {
      const message = (payload as { message?: unknown }).message;
      if (Array.isArray(message)) return message.join('，');
      if (typeof message === 'string') return message;
    }
  } catch {
    // Fall through to the generic status message when the body is not JSON.
  }
  return `请求失败（HTTP ${response.status}）`;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function upstreamErrorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : 'Codex 查询失败';
}

async function codexResponseObject(response: Response, context: string) {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError(`${context}：响应不是有效 JSON`);
  }
  const body = objectValue(payload);
  if (!body) throw new ApiError(`${context}：响应格式无效`);
  return body;
}

async function parseCodexError(response: Response) {
  if (response.status === 401 || response.status === 403) {
    return 'Codex 登录凭据已过期，请先在桌面端刷新并同步该账号';
  }
  try {
    const payload: unknown = await response.json();
    const body = objectValue(payload);
    for (const key of ['message', 'detail', 'error'] as const) {
      const value = body?.[key];
      if (typeof value === 'string' && value.trim()) return value;
      const nested = objectValue(value);
      if (typeof nested?.message === 'string' && nested.message.trim()) {
        return nested.message;
      }
    }
  } catch {
    // Fall through to the generic upstream status message.
  }
  return `Codex 请求失败（HTTP ${response.status}）`;
}

async function codexRequest(
  account: AccountSummary,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const accessToken = account.codexAccessToken?.trim();
  if (!accessToken) {
    throw new ApiError('该账号没有可用于手机直连的 Codex Token，请先在桌面端重新同步');
  }
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${accessToken}`);
  headers.set('originator', CODEX_ORIGINATOR);
  headers.set('User-Agent', 'codex_cli_rs/0.1.0');
  if (account.accountId) headers.set('ChatGPT-Account-Id', account.accountId);

  let response: Response;
  try {
    response = await fetch(url, { ...init, headers });
  } catch {
    throw new ApiError('无法从手机直接连接 Codex，请检查网络或 VPN');
  }
  if (!response.ok) {
    throw new ApiError(await parseCodexError(response), response.status);
  }
  return response;
}

function usageWindow(value: unknown): UsageWindow | null {
  const window = objectValue(value);
  const usedPercent = numberValue(window?.used_percent);
  if (usedPercent === undefined) return null;
  const used = Math.max(0, Math.min(100, usedPercent));
  const resetAt = numberValue(window?.reset_at);
  const windowSeconds = numberValue(window?.limit_window_seconds);
  return {
    usedPercent: used,
    remainingPercent: Math.max(0, Math.min(100, 100 - used)),
    resetsAt: resetAt ?? null,
    windowMinutes: windowSeconds && windowSeconds > 0
      ? Math.floor(windowSeconds / 60)
      : null,
  };
}

export async function fetchAccountUsage(account: AccountSummary): Promise<UsageSummary> {
  const response = await codexRequest(account, CODEX_USAGE_URL);
  const body = await codexResponseObject(response, '解析 Codex 用量失败');
  const rateLimit = objectValue(body.rate_limit);
  return {
    primary: usageWindow(rateLimit?.primary_window),
    secondary: usageWindow(rateLimit?.secondary_window),
    fetchedAt: new Date().toISOString(),
    error: null,
  };
}

function normalizedTimestamp(value: unknown): string | null {
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  const numeric = numberValue(value);
  if (numeric === undefined) return null;
  const milliseconds = Math.abs(numeric) >= 100_000_000_000 ? numeric : numeric * 1000;
  const parsed = new Date(milliseconds);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  limit: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(limit, values.length) },
    async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await mapper(values[index] as T, index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

export async function loadSession(): Promise<AuthSession | null> {
  try {
    const raw = await SecureStore.getItemAsync(SESSION_KEY);
    if (!raw) return null;
    const session: unknown = JSON.parse(raw);
    if (!session || typeof session !== 'object') return null;
    const candidate = session as Partial<AuthSession>;
    if (!candidate.baseUrl || !candidate.accessToken || !candidate.refreshToken || !candidate.email) return null;
    return candidate as AuthSession;
  } catch {
    return null;
  }
}

async function persistSession(session: AuthSession) {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
}

export function clearSession() {
  return SecureStore.deleteItemAsync(SESSION_KEY).catch(() => undefined);
}

export async function login(baseUrlInput: string, email: string, password: string): Promise<AuthSession> {
  const baseUrl = normalizeBaseUrl(baseUrlInput);
  if (!email.trim() || !password) throw new ApiError('请填写邮箱和密码');
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), password }),
    });
  } catch {
    throw new ApiError('无法连接服务器，请检查地址和网络');
  }
  if (!response.ok) throw new ApiError(await parseError(response), response.status);
  const payload = await response.json() as AuthResponse;
  if (!payload.accessToken || !payload.refreshToken) throw new ApiError('服务器返回的登录信息无效');
  const session: AuthSession = {
    baseUrl,
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken,
    email: payload.user?.email ?? email.trim(),
    profile: payload.user,
  };
  await persistSession(session);
  return session;
}

const refreshRequests = new WeakMap<AuthSession, Promise<AuthSession>>();

async function performSessionRefresh(session: AuthSession): Promise<AuthSession> {
  let response: Response;
  try {
    response = await fetch(`${session.baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    });
  } catch {
    throw new ApiError('无法连接服务器，请检查网络');
  }
  if (response.status === 401 || response.status === 403) {
    throw new SessionExpiredError(response.status);
  }
  if (!response.ok) throw new ApiError(await parseError(response), response.status);
  const payload = await response.json() as AuthResponse;
  if (!payload.accessToken || !payload.refreshToken) throw new ApiError('服务器返回的登录信息无效');
  const next = { ...session, accessToken: payload.accessToken, refreshToken: payload.refreshToken };
  await persistSession(next);
  // Refresh tokens are rotated by the backend. Keep the in-memory session in
  // sync as well, otherwise a second refresh would submit the revoked token.
  Object.assign(session, next);
  return session;
}

function refreshSession(session: AuthSession): Promise<AuthSession> {
  const existing = refreshRequests.get(session);
  if (existing) return existing;

  const pending = performSessionRefresh(session).finally(() => {
    refreshRequests.delete(session);
  });
  refreshRequests.set(session, pending);
  return pending;
}

async function authorizedRequest(session: AuthSession, path: string, init: RequestInit = {}): Promise<Response> {
  const request = async (accessToken: string) => {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${accessToken}`);
    try {
      return await fetch(`${session.baseUrl}${path}`, { ...init, headers });
    } catch {
      throw new ApiError('无法连接服务器，请检查网络');
    }
  };
  const response = await request(session.accessToken);
  if (response.status !== 401) return response;
  try {
    const refreshed = await refreshSession(session);
    const retry = await request(refreshed.accessToken);
    if (retry.status === 401) {
      await clearSession();
      throw new SessionExpiredError(retry.status);
    }
    return retry;
  } catch (error) {
    if (isSessionExpiredError(error)) await clearSession();
    throw error;
  }
}

export async function loadGlobalRefreshMinutes(): Promise<number> {
  try {
    const raw = await SecureStore.getItemAsync(GLOBAL_REFRESH_INTERVAL_KEY);
    if (!raw) return DEFAULT_GLOBAL_REFRESH_MINUTES;
    const value = Number(raw);
    return Number.isInteger(value) && value >= 1 && value <= 1440
      ? value
      : DEFAULT_GLOBAL_REFRESH_MINUTES;
  } catch {
    return DEFAULT_GLOBAL_REFRESH_MINUTES;
  }
}

export async function saveGlobalRefreshMinutes(value: number): Promise<void> {
  if (!Number.isInteger(value) || value < 1 || value > 1440) {
    throw new ApiError('全局刷新间隔需要设置为 1 到 1440 分钟');
  }
  await SecureStore.setItemAsync(GLOBAL_REFRESH_INTERVAL_KEY, String(value));
}

export async function adminRequest<T>(session: AuthSession, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await authorizedRequest(session, path, { ...init, headers });
  if (!response.ok) throw new ApiError(await parseError(response), response.status);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function fetchAccountSummary(session: AuthSession): Promise<AccountSummary[]> {
  const response = await authorizedRequest(session, '/sync/accounts/summary');
  if (!response.ok) throw new ApiError(await parseError(response), response.status);
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { accounts?: unknown }).accounts)) {
    throw new ApiError('服务器返回的账户数据无效');
  }
  const accounts = (payload as { accounts: AccountSummary[] }).accounts;
  return mapWithConcurrency(accounts, 4, async (account) => {
    try {
      return { ...account, usage: await fetchAccountUsage(account) };
    } catch (error) {
      return {
        ...account,
        usage: {
          primary: null,
          secondary: null,
          fetchedAt: new Date().toISOString(),
          error: upstreamErrorMessage(error),
        },
      };
    }
  });
}

export async function fetchResetCredits(account: AccountSummary): Promise<ResetCreditsSummary> {
  const response = await codexRequest(account, CODEX_RESET_CREDITS_URL);
  const body = await codexResponseObject(response, '解析 Codex 重置卡失败');
  if (!Array.isArray(body?.credits)) {
    throw new ApiError('Codex 返回的重置卡数据无效');
  }
  const credits = body.credits.map((value) => {
    const credit = objectValue(value);
    return {
      issuedAt: normalizedTimestamp(credit?.granted_at ?? credit?.created_at),
      expiresAt: normalizedTimestamp(credit?.expires_at),
    };
  });
  credits.sort((left, right) => (left.expiresAt ?? '').localeCompare(right.expiresAt ?? ''));
  return { credits };
}

export async function consumeResetCredit(account: AccountSummary): Promise<void> {
  const current = await fetchResetCredits(account);
  if (!current.credits.length) throw new ApiError('当前账号没有可用重置卡');

  const response = await codexRequest(account, CODEX_RESET_CREDIT_CONSUME_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      redeem_request_id: `codex-switch-mobile-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    }),
  });
  const code = (await codexResponseObject(response, '解析 Codex 重置卡使用结果失败')).code;
  if (code === 'reset' || code === 'already_redeemed') return;
  if (code === 'no_credit') throw new ApiError('当前账号没有可用重置卡');
  if (code === 'nothing_to_reset') {
    throw new ApiError('当前账号当前没有需要重置的用量窗口');
  }
  if (typeof code === 'string') throw new ApiError(`Codex 重置卡接口返回未知状态：${code}`);
  throw new ApiError('Codex 重置卡接口响应缺少 code');
}

export async function fetchRemoteDevices(session: AuthSession): Promise<RemoteDevice[]> {
  const response = await authorizedRequest(session, '/devices');
  if (!response.ok) throw new ApiError(await parseError(response), response.status);
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { devices?: unknown }).devices)) {
    throw new ApiError('服务器返回的设备数据无效');
  }
  return (payload as { devices: RemoteDevice[] }).devices;
}

export async function switchRemoteDeviceAccount(
  session: AuthSession,
  deviceId: string,
  accountId: string,
): Promise<{ deviceId: string; activeAccountId: string; online: boolean }> {
  const response = await authorizedRequest(session, `/devices/${encodeURIComponent(deviceId)}/account`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId }),
  });
  if (!response.ok) throw new ApiError(await parseError(response), response.status);
  return response.json() as Promise<{ deviceId: string; activeAccountId: string; online: boolean }>;
}

export async function fetchUserProfile(session: AuthSession): Promise<UserProfile> {
  const response = await authorizedRequest(session, '/auth/me');
  if (!response.ok) throw new ApiError(await parseError(response), response.status);
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object') {
    throw new ApiError('服务器返回的用户信息无效');
  }
  const profile = payload as Partial<UserProfile>;
  if (!profile.id || !profile.email || !profile.role) {
    throw new ApiError('服务器返回的用户信息无效');
  }
  const nextProfile = profile as UserProfile;
  session.email = nextProfile.email;
  session.profile = nextProfile;
  await persistSession(session);
  return nextProfile;
}

export async function changePassword(session: AuthSession, currentPassword: string, newPassword: string): Promise<void> {
  const response = await authorizedRequest(session, '/admin/api/profile/password', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  if (!response.ok) throw new ApiError(await parseError(response), response.status);
}
