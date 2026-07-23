import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountSummary, AuthSession } from '../types';

vi.mock('expo-secure-store', () => ({
  deleteItemAsync: vi.fn(),
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
}));

import {
  consumeResetCredit,
  fetchAccountSummary,
  fetchAccountUsage,
  fetchResetCredits,
} from './client';

const session: AuthSession = {
  baseUrl: 'https://switch.example.com',
  accessToken: 'switch-access',
  refreshToken: 'switch-refresh',
  email: 'owner@example.com',
};

function account(overrides: Partial<AccountSummary> = {}): AccountSummary {
  return {
    id: 'account-1',
    email: 'account@example.com',
    note: '',
    expiresAt: '',
    plan: 'plus',
    accountId: 'workspace-1',
    codexAccessToken: 'codex-access',
    active: true,
    usage: {},
    ...overrides,
  };
}

describe('mobile Codex API client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('replaces the backend usage snapshot with a live Codex response', async () => {
    const apiFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        accounts: [account({
          usage: {
            primary: { usedPercent: 99, remainingPercent: 1 },
            fetchedAt: '2026-01-01T00:00:00.000Z',
          },
        })],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        rate_limit: {
          primary_window: {
            used_percent: 25,
            limit_window_seconds: 18_000,
            reset_at: 1_800_000_000,
          },
          secondary_window: {
            used_percent: 40,
            limit_window_seconds: 604_800,
            reset_at: 1_800_100_000,
          },
        },
      }), { status: 200 }));
    vi.stubGlobal('fetch', apiFetch);

    const result = await fetchAccountSummary(session);

    expect(result[0]?.usage).toEqual(expect.objectContaining({
      primary: {
        usedPercent: 25,
        remainingPercent: 75,
        resetsAt: 1_800_000_000,
        windowMinutes: 300,
      },
      secondary: {
        usedPercent: 40,
        remainingPercent: 60,
        resetsAt: 1_800_100_000,
        windowMinutes: 10_080,
      },
      error: null,
    }));
    expect(apiFetch.mock.calls[1]?.[0]).toBe('https://chatgpt.com/backend-api/wham/usage');
    const headers = new Headers((apiFetch.mock.calls[1]?.[1] as RequestInit).headers);
    expect(headers.get('Authorization')).toBe('Bearer codex-access');
    expect(headers.get('ChatGPT-Account-Id')).toBe('workspace-1');
    expect(headers.get('originator')).toBe('codex_cli_rs');
  });

  it('does not fall back to stale backend usage when no Codex token is available', async () => {
    const apiFetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      accounts: [account({
        codexAccessToken: undefined,
        usage: {
          primary: { usedPercent: 10, remainingPercent: 90 },
          fetchedAt: '2026-01-01T00:00:00.000Z',
        },
      })],
    }), { status: 200 }));
    vi.stubGlobal('fetch', apiFetch);

    const result = await fetchAccountSummary(session);

    expect(result[0]?.usage.primary).toBeNull();
    expect(result[0]?.usage.error).toContain('没有可用于手机直连的 Codex Token');
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it('refreshes one account usage without requesting the account list', async () => {
    const apiFetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      rate_limit: {
        primary_window: {
          used_percent: 35,
          limit_window_seconds: 18_000,
          reset_at: 1_800_000_000,
        },
      },
    }), { status: 200 }));
    vi.stubGlobal('fetch', apiFetch);

    await expect(fetchAccountUsage(account())).resolves.toEqual(expect.objectContaining({
      primary: {
        usedPercent: 35,
        remainingPercent: 65,
        resetsAt: 1_800_000_000,
        windowMinutes: 300,
      },
      error: null,
    }));
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch.mock.calls[0]?.[0]).toBe('https://chatgpt.com/backend-api/wham/usage');
  });

  it('reads and normalizes reset credits directly from Codex', async () => {
    const apiFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      credits: [{
        granted_at: 1_753_056_000,
        expires_at: '2026-08-20T10:30:00.000Z',
      }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', apiFetch);

    await expect(fetchResetCredits(account())).resolves.toEqual({
      credits: [{
        issuedAt: '2025-07-21T00:00:00.000Z',
        expiresAt: '2026-08-20T10:30:00.000Z',
      }],
    });
    expect(apiFetch.mock.calls[0]?.[0])
      .toBe('https://chatgpt.com/backend-api/wham/rate-limit-reset-credits');
  });

  it('checks current credits and consumes one directly through Codex', async () => {
    const apiFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        credits: [{ granted_at: 1_753_056_000, expires_at: 1_756_000_000 }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'reset' }), { status: 200 }));
    vi.stubGlobal('fetch', apiFetch);

    await expect(consumeResetCredit(account())).resolves.toBeUndefined();

    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(apiFetch.mock.calls[1]?.[0])
      .toBe('https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume');
    const request = apiFetch.mock.calls[1]?.[1] as RequestInit;
    expect(request.method).toBe('POST');
    expect(JSON.parse(request.body as string)).toEqual({
      redeem_request_id: expect.stringMatching(/^codex-switch-mobile-/),
    });
  });
});
