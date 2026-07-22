import { Buffer } from 'buffer';
import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { MODULE_OPTIONS_TOKEN } from '@/config/configurable';
import type { ConfigModuleOptions } from '@/config/config.types';
import type { AuthUser } from '@/common/decorators/user.decorator';
import type { ImportSystemAccountsDto } from './dto/admin-management.dto';
import { AdminService } from './admin.service';

const DEFAULT_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const DEFAULT_ISSUER = 'https://auth.openai.com';
const ORIGINATOR = 'codex_cli_rs';
const MAX_IMPORT_ACCOUNTS = 1000;
const NESTED_AUTH_KEYS = [
  'auth',
  'auth_json',
  'authJson',
  'session',
  'session_json',
  'sessionJson',
] as const;

interface CompatibleTokens {
  idToken?: string;
  accessToken?: string;
  refreshToken?: string;
}

type JsonObject = Record<string, unknown>;

export function parseCompatibleJsonAccounts(content: string): unknown[] {
  const normalized = content.replace(/^\uFEFF/, '').trim();
  if (!normalized) throw new BadRequestException('Import file is empty');

  try {
    return unpackTopLevel(JSON.parse(normalized) as unknown);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return parseLineDelimitedAccounts(normalized, error);
  }
}

export function normalizeCompatibleAuth(value: unknown): JsonObject {
  const tokens = extractCompatibleTokens(value, 0);
  if (!tokens) {
    throw new BadRequestException(
      'No Codex token found; supported fields include access_token/accessToken, tokens, credentials, session/session_json, and refresh_token',
    );
  }

  const normalizedTokens: JsonObject = {};
  if (tokens.accessToken) normalizedTokens.access_token = tokens.accessToken;
  if (tokens.idToken && isDecodableJwt(tokens.idToken)) normalizedTokens.id_token = tokens.idToken;
  if (tokens.refreshToken) normalizedTokens.refresh_token = tokens.refreshToken;
  return { tokens: normalizedTokens };
}

export function parseSub2apiJsonAccounts(content: string): unknown[] {
  const normalized = content.replace(/^\uFEFF/, '').trim();
  if (!normalized) throw new BadRequestException('Import file is empty');
  let value: unknown;
  try {
    value = JSON.parse(normalized) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'invalid JSON';
    throw new BadRequestException(`Invalid sub2api JSON: ${detail}`);
  }
  if (!isObject(value)) {
    throw new BadRequestException('sub2api export must contain a JSON object at the top level');
  }
  if (value.type !== 'sub2api-data') {
    throw new BadRequestException('The selected file is not a sub2api-data export');
  }
  if (value.version !== 1) {
    throw new BadRequestException('Only version 1 sub2api exports are supported');
  }
  if (!Array.isArray(value.accounts) || !value.accounts.length) {
    throw new BadRequestException('The sub2api export does not contain any accounts');
  }
  if (value.accounts.length > MAX_IMPORT_ACCOUNTS) {
    throw new BadRequestException(`A single import supports at most ${MAX_IMPORT_ACCOUNTS} accounts`);
  }
  return value.accounts;
}

export function normalizeSub2apiAuth(value: unknown): JsonObject {
  if (!isObject(value)) throw new BadRequestException('sub2api account must be a JSON object');
  if (value.platform !== 'openai' || value.type !== 'oauth') {
    throw new BadRequestException('Only platform=openai and type=oauth accounts are supported');
  }
  const credentials = isObject(value.credentials) ? value.credentials : undefined;
  if (!credentials) throw new BadRequestException('sub2api account is missing credentials');
  const authMode = firstString(credentials, [['auth_mode']]);
  if (authMode?.toLowerCase() !== 'agentidentity') {
    throw new BadRequestException('Only auth_mode=agentIdentity sub2api accounts are supported');
  }

  const identity: JsonObject = {};
  for (const key of ['agent_runtime_id', 'agent_private_key', 'account_id', 'chatgpt_user_id']) {
    const field = firstString(credentials, [[key]]);
    if (!field) throw new BadRequestException(`sub2api credentials is missing ${key}`);
    identity[key] = field;
  }
  const privateKey = identity.agent_private_key as string;
  const normalizedKey = privateKey.replace(/\s+/g, '').replace(/=+$/, '');
  const decodedKey = Buffer.from(privateKey, 'base64');
  if (decodedKey.length < 32 || decodedKey.toString('base64').replace(/=+$/, '') !== normalizedKey) {
    throw new BadRequestException('sub2api agent_private_key is not valid Base64');
  }
  for (const key of ['task_id', 'email', 'plan_type']) {
    const field = firstString(credentials, [[key]]);
    if (field) identity[key] = field;
  }
  identity.chatgpt_account_is_fedramp = credentials.chatgpt_account_is_fedramp === true;

  return {
    auth_mode: 'agentIdentity',
    agent_identity: identity,
  };
}

function unpackTopLevel(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    if (!value.length) throw new BadRequestException('Import file does not contain any accounts');
    if (value.length > MAX_IMPORT_ACCOUNTS) {
      throw new BadRequestException(`A single import supports at most ${MAX_IMPORT_ACCOUNTS} accounts`);
    }
    return value;
  }
  if (!isObject(value)) {
    throw new BadRequestException('Import file must contain a JSON object or array at the top level');
  }
  if (Array.isArray(value.accounts)) return unpackTopLevel(value.accounts);
  return [value];
}

function parseLineDelimitedAccounts(content: string, parseError: SyntaxError): unknown[] {
  const lines = content
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
    .filter(({ line }) => line.length > 0);
  if (lines.length <= 1) {
    throw new BadRequestException(`Invalid JSON: ${parseError.message}`);
  }
  if (lines.length > MAX_IMPORT_ACCOUNTS) {
    throw new BadRequestException(`A single import supports at most ${MAX_IMPORT_ACCOUNTS} accounts`);
  }
  return lines.map(({ line, lineNumber }) => {
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'invalid JSON';
      throw new BadRequestException(`Line ${lineNumber} is not valid JSON: ${detail}`);
    }
    if (!isObject(value)) {
      throw new BadRequestException(`Line ${lineNumber} must contain a JSON object`);
    }
    return value;
  });
}

function extractCompatibleTokens(value: unknown, depth: number): CompatibleTokens | undefined {
  if (depth > 4 || !isObject(value)) return undefined;
  const tokens = {
    idToken: firstString(value, [
      ['id_token'], ['idToken'], ['tokens', 'id_token'], ['tokens', 'idToken'],
      ['credentials', 'id_token'], ['credentials', 'idToken'],
    ]),
    accessToken: firstString(value, [
      ['access_token'], ['accessToken'], ['tokens', 'access_token'], ['tokens', 'accessToken'],
      ['credentials', 'access_token'], ['credentials', 'accessToken'],
    ]),
    refreshToken: firstString(value, [
      ['refresh_token'], ['refreshToken'], ['tokens', 'refresh_token'], ['tokens', 'refreshToken'],
      ['credentials', 'refresh_token'], ['credentials', 'refreshToken'],
    ]),
  };
  if (tokens.idToken || tokens.accessToken || tokens.refreshToken) return tokens;

  for (const key of NESTED_AUTH_KEYS) {
    const nested = value[key];
    if (isObject(nested)) {
      const result = extractCompatibleTokens(nested, depth + 1);
      if (result) return result;
    } else if (typeof nested === 'string') {
      try {
        const result = extractCompatibleTokens(JSON.parse(nested) as unknown, depth + 1);
        if (result) return result;
      } catch {
        // Another supported wrapper may still contain a usable session.
      }
    }
  }
  return undefined;
}

function firstString(value: JsonObject, paths: string[][]) {
  for (const path of paths) {
    let current: unknown = value;
    for (const key of path) {
      if (!isObject(current)) {
        current = undefined;
        break;
      }
      current = current[key];
    }
    if (typeof current === 'string' && current.trim()) return current.trim();
  }
  return undefined;
}

function isDecodableJwt(value: string) {
  const payload = value.split('.')[1];
  if (!payload) return false;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown;
    return isObject(decoded);
  } catch {
    return false;
  }
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

@Injectable()
export class OfficialAccountImportService {
  private readonly clientId: string;
  private readonly issuer: string;

  constructor(
    @Inject(MODULE_OPTIONS_TOKEN) config: ConfigModuleOptions,
    private readonly admin: AdminService,
  ) {
    this.clientId = config.CODEX_OAUTH_CLIENT_ID?.trim() || DEFAULT_CLIENT_ID;
    this.issuer = (config.CODEX_OAUTH_ISSUER?.trim() || DEFAULT_ISSUER).replace(/\/+$/, '');
  }

  async import(actor: AuthUser, dto: ImportSystemAccountsDto) {
    const values = parseCompatibleJsonAccounts(dto.content);
    const accounts = [];
    for (const [index, value] of values.entries()) {
      try {
        let auth = normalizeCompatibleAuth(value);
        if (!this.token(auth, 'access_token')) auth = await this.refresh(auth);
        accounts.push(await this.admin.createSystemAccount(actor, {
          auth,
          note: dto.note,
          expiresAt: dto.expiresAt,
        }));
      } catch (error) {
        const detail = error instanceof HttpException ? error.message : 'Unable to import account';
        throw new BadRequestException(`Account ${index + 1} could not be imported: ${detail}`);
      }
    }
    return { accounts, importedCount: accounts.length };
  }

  async importSub2api(actor: AuthUser, dto: ImportSystemAccountsDto) {
    const values = parseSub2apiJsonAccounts(dto.content);
    const accounts = [];
    for (const [index, value] of values.entries()) {
      try {
        const auth = normalizeSub2apiAuth(value);
        accounts.push(await this.admin.createSystemAccount(actor, {
          auth,
          note: dto.note,
          expiresAt: dto.expiresAt,
        }));
      } catch (error) {
        const detail = error instanceof HttpException ? error.message : 'Unable to import account';
        throw new BadRequestException(`Account ${index + 1} could not be imported: ${detail}`);
      }
    }
    return { accounts, importedCount: accounts.length };
  }

  private async refresh(auth: JsonObject) {
    const refreshToken = this.token(auth, 'refresh_token');
    if (!refreshToken) {
      throw new BadRequestException('The imported account does not contain an access token or refresh token');
    }
    let response: Response;
    try {
      response = await fetch(`${this.issuer}/oauth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          originator: ORIGINATOR,
          'User-Agent': 'codex_cli_rs/0.1.0',
        },
        body: JSON.stringify({
          client_id: this.clientId,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new BadGatewayException('Unable to reach the Codex OAuth service to refresh credentials');
    }
    if (!response.ok) {
      throw new BadGatewayException(`Unable to refresh imported credentials (HTTP ${response.status})`);
    }
    let payload: unknown;
    try {
      payload = await response.json() as unknown;
    } catch {
      throw new BadGatewayException('Codex OAuth refresh response is not valid JSON');
    }
    if (!isObject(payload)) {
      throw new BadGatewayException('Codex OAuth refresh response is invalid');
    }
    const tokens = isObject(auth.tokens) ? { ...auth.tokens } : {};
    for (const key of ['id_token', 'access_token', 'refresh_token'] as const) {
      if (typeof payload[key] === 'string' && payload[key].trim()) tokens[key] = payload[key].trim();
    }
    if (typeof tokens.access_token !== 'string' || !tokens.access_token) {
      throw new BadGatewayException('Codex OAuth refresh response is missing access_token');
    }
    return { tokens };
  }

  private token(auth: JsonObject, key: string) {
    if (!isObject(auth.tokens)) return undefined;
    const value = auth.tokens[key];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }
}
