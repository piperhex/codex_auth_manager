import * as SecureStore from 'expo-secure-store';
import type { AccountSummary, AuthResponse, AuthSession, UserProfile } from '../types';

const SESSION_KEY = 'codex-switch.mobile.session.v1';
export const DEFAULT_CLOUD_BASE_URL = 'https://codex.onepiper.cloud';

export class ApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'ApiError';
  }
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

async function refreshSession(session: AuthSession): Promise<AuthSession> {
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
  if (!response.ok) throw new ApiError('登录已过期，请重新登录', response.status);
  const payload = await response.json() as AuthResponse;
  if (!payload.accessToken || !payload.refreshToken) throw new ApiError('登录已过期，请重新登录');
  const next = { ...session, accessToken: payload.accessToken, refreshToken: payload.refreshToken };
  await persistSession(next);
  // Refresh tokens are rotated by the backend. Keep the in-memory session in
  // sync as well, otherwise a second refresh would submit the revoked token.
  Object.assign(session, next);
  return session;
}

async function authorizedRequest(session: AuthSession, path: string, init: RequestInit = {}): Promise<Response> {
  const request = (accessToken: string) => {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${accessToken}`);
    return fetch(`${session.baseUrl}${path}`, { ...init, headers });
  };
  let response: Response;
  try {
    response = await request(session.accessToken);
  } catch {
    throw new ApiError('无法连接服务器，请检查网络');
  }
  if (response.status !== 401) return response;
  try {
    const refreshed = await refreshSession(session);
    const retry = await request(refreshed.accessToken);
    if (retry.status === 401) {
      await clearSession();
      throw new ApiError('登录已过期，请重新登录', retry.status);
    }
    return retry;
  } catch (error) {
    if (error instanceof ApiError && error.message.includes('登录已过期')) await clearSession();
    throw error;
  }
}

export async function fetchAccountSummary(session: AuthSession): Promise<AccountSummary[]> {
  const response = await authorizedRequest(session, '/sync/accounts/summary');
  if (!response.ok) throw new ApiError(await parseError(response), response.status);
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { accounts?: unknown }).accounts)) {
    throw new ApiError('服务器返回的账户数据无效');
  }
  return (payload as { accounts: AccountSummary[] }).accounts;
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
