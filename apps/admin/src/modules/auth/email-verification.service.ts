import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import Redis from 'ioredis';
import nodemailer, { type Transporter } from 'nodemailer';
import { MODULE_OPTIONS_TOKEN } from '@/config/configurable';
import type { ConfigModuleOptions } from '@/config/config.types';
import { REDIS_CLIENT } from '@/modules/redis/redis.constants';

export const REGISTRATION_CODE_TTL_SECONDS = 5 * 60;
const REGISTRATION_CODE_RESEND_SECONDS = 60;
const REGISTRATION_CODE_MAX_ATTEMPTS = 5;

type VerificationPurpose = 'registration' | 'password-reset';

interface StoredRegistrationCode {
  salt: string;
  hash: string;
}

interface VerificationEmail {
  subject: string;
  text: string;
  html: string;
}

const VERIFICATION_EMAIL_COPY = {
  registration: {
    subject: '是你的 Codex Switch 注册验证码',
    heading: '注册验证',
    description: '你正在创建新的 Codex Switch 账户。为验证邮箱，请输入下方验证码：',
    purpose: '注册 Codex Switch',
    warning: '若你未尝试注册，可安全忽略此邮件。',
  },
  'password-reset': {
    subject: '是你的 Codex Switch 密码重置验证码',
    heading: '重置密码',
    description: '你刚刚请求重置 Codex Switch 账户密码。为进行安全验证，请输入下方验证码：',
    purpose: '重置账户密码',
    warning: '若你未尝试重置密码，可安全忽略此邮件。',
  },
} as const;

export function buildVerificationEmail(
  code: string,
  purpose: VerificationPurpose,
  requestedAt = new Date(),
): VerificationEmail {
  const copy = VERIFICATION_EMAIL_COPY[purpose];
  const requestedAtText = formatUtcDate(requestedAt);
  const subject = `${code} ${copy.subject}`;
  const text = [
    copy.heading,
    '',
    copy.description,
    '',
    code,
    '',
    `用途：${copy.purpose}`,
    `时间：${requestedAtText}`,
    '有效期：5 分钟',
    '',
    '请勿将验证码提供给他人。',
    copy.warning,
  ].join('\n');

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light only">
  <title>${subject}</title>
  <style>
    @media only screen and (max-width: 620px) {
      .email-shell { width: 100% !important; }
      .email-content { padding-left: 28px !important; padding-right: 28px !important; }
      .code-box { font-size: 38px !important; letter-spacing: 9px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#ffffff;color:#252529;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
    ${copy.heading}，验证码 ${code}，5 分钟内有效。
  </div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#ffffff;border-collapse:collapse;">
    <tr>
      <td align="center" style="padding:0;">
        <table role="presentation" width="620" cellspacing="0" cellpadding="0" border="0" class="email-shell" style="width:620px;max-width:620px;border-collapse:collapse;">
          <tr>
            <td align="center" style="padding:64px 24px 62px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;">
                <tr>
                  <td width="58" height="58" align="center" valign="middle" aria-label="Codex Switch" style="width:58px;height:58px;border:3px solid #252529;border-radius:50%;font-family:Arial,sans-serif;font-size:28px;font-weight:700;line-height:58px;color:#252529;">⇄</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="email-content" style="padding:0 48px 64px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',Arial,sans-serif;">
              <h1 style="margin:0 0 30px;font-size:26px;line-height:1.4;font-weight:700;color:#18181b;">${copy.heading}</h1>
              <p style="margin:0 0 32px;font-size:18px;line-height:1.75;color:#49494f;">${copy.description}</p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:separate;">
                <tr>
                  <td align="center" class="code-box" style="padding:25px 12px;background:#f5f6f7;border-radius:10px;font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace;font-size:42px;font-weight:500;line-height:1.2;letter-spacing:12px;color:#19191d;white-space:nowrap;">${code}</td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin-top:36px;border-collapse:collapse;">
                <tr>
                  <td width="76" valign="top" style="padding:4px 0;font-size:17px;line-height:1.6;color:#55555b;white-space:nowrap;">用途：</td>
                  <td valign="top" style="padding:4px 0;font-size:17px;line-height:1.6;font-weight:600;color:#3f3f45;">${copy.purpose}</td>
                </tr>
                <tr>
                  <td width="76" valign="top" style="padding:4px 0;font-size:17px;line-height:1.6;color:#55555b;white-space:nowrap;">时间：</td>
                  <td valign="top" style="padding:4px 0;font-size:17px;line-height:1.6;font-weight:600;color:#3f3f45;">${requestedAtText}</td>
                </tr>
                <tr>
                  <td width="76" valign="top" style="padding:4px 0;font-size:17px;line-height:1.6;color:#55555b;white-space:nowrap;">有效期：</td>
                  <td valign="top" style="padding:4px 0;font-size:17px;line-height:1.6;font-weight:600;color:#3f3f45;">5 分钟</td>
                </tr>
              </table>
              <p style="margin:34px 0 0;font-size:17px;line-height:1.75;color:#49494f;">请勿将验证码提供给他人。<br>${copy.warning}</p>
            </td>
          </tr>
          <tr>
            <td align="center" style="border-top:1px solid #eeeeef;padding:24px 28px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',Arial,sans-serif;font-size:13px;line-height:1.6;color:#99999f;">
              Codex Switch · 此邮件由系统自动发送，请勿直接回复
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}

function formatUtcDate(date: Date) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = date.getUTCDate().toString().padStart(2, '0');
  const month = months[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  const hours = date.getUTCHours().toString().padStart(2, '0');
  const minutes = date.getUTCMinutes().toString().padStart(2, '0');
  return `${day} ${month} ${year}, ${hours}:${minutes} UTC`;
}

@Injectable()
export class EmailVerificationService {
  private readonly transporter?: Transporter;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(MODULE_OPTIONS_TOKEN) private readonly config: ConfigModuleOptions,
  ) {
    if ((config.mail__transport ?? '').toUpperCase() === 'SMTP') {
      this.transporter = nodemailer.createTransport({
        host: config.mail__options__host,
        port: Number(config.mail__options__port ?? 465),
        secure: this.boolean(config.mail__options__secure, true),
        auth: {
          user: config.mail__options__auth__user,
          pass: config.mail__options__auth__pass,
        },
      });
    }
  }

  async sendRegistrationCode(email: string) {
    return this.sendCode(email, 'registration');
  }

  async sendPasswordResetCode(email: string) {
    return this.sendCode(email, 'password-reset');
  }

  async verifyAndConsume(email: string, code: string) {
    return this.verifyCodeAndConsume(email, code, 'registration');
  }

  async verifyPasswordResetCode(email: string, code: string) {
    return this.verifyCodeAndConsume(email, code, 'password-reset');
  }

  private async sendCode(email: string, purpose: VerificationPurpose) {
    this.ensureConfigured();
    const normalizedEmail = this.normalizeEmail(email);
    const cooldownKey = this.cooldownKey(normalizedEmail, purpose);
    const cooldown = await this.redis.set(
      cooldownKey,
      '1',
      'EX',
      REGISTRATION_CODE_RESEND_SECONDS,
      'NX',
    );
    if (cooldown !== 'OK') {
      throw new HttpException(
        'Please wait before requesting another verification code',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const salt = randomBytes(16).toString('hex');
    const stored: StoredRegistrationCode = { salt, hash: this.hash(normalizedEmail, code, salt) };
    const codeKey = this.codeKey(normalizedEmail, purpose);
    const attemptsKey = this.attemptsKey(normalizedEmail, purpose);
    await this.redis.del(attemptsKey);
    await this.redis.set(codeKey, JSON.stringify(stored), 'EX', REGISTRATION_CODE_TTL_SECONDS);

    try {
      const message = buildVerificationEmail(code, purpose);
      await this.transporter!.sendMail({
        from: this.config.mail__from,
        to: normalizedEmail,
        ...message,
      });
    } catch {
      await this.redis.del(codeKey, cooldownKey, attemptsKey);
      throw new ServiceUnavailableException('Verification email could not be sent');
    }

    return { ok: true, expiresInSeconds: REGISTRATION_CODE_TTL_SECONDS };
  }

  private async verifyCodeAndConsume(email: string, code: string, purpose: VerificationPurpose) {
    const normalizedEmail = this.normalizeEmail(email);
    const key = this.codeKey(normalizedEmail, purpose);
    const serialized = await this.redis.get(key);
    if (!serialized) throw this.invalidCode();

    let stored: StoredRegistrationCode;
    try {
      stored = JSON.parse(serialized) as StoredRegistrationCode;
    } catch {
      await this.redis.del(key);
      throw this.invalidCode();
    }

    const actual = Buffer.from(this.hash(normalizedEmail, code, stored.salt), 'hex');
    const expected = Buffer.from(stored.hash, 'hex');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      await this.redis.eval(
        `local attempts = redis.call('INCR', KEYS[2])
         if attempts == 1 then redis.call('EXPIRE', KEYS[2], ARGV[1]) end
         if attempts >= tonumber(ARGV[2]) then
           redis.call('DEL', KEYS[1], KEYS[2])
         end
         return attempts`,
        2,
        key,
        this.attemptsKey(normalizedEmail, purpose),
        REGISTRATION_CODE_TTL_SECONDS,
        REGISTRATION_CODE_MAX_ATTEMPTS,
      );
      throw this.invalidCode();
    }

    const consumed = await this.redis.eval(
      `if redis.call('GET', KEYS[1]) == ARGV[1] then
         redis.call('DEL', KEYS[1], KEYS[2])
         return 1
       end
       return 0`,
      2,
      key,
      this.attemptsKey(normalizedEmail, purpose),
      serialized,
    );
    if (consumed !== 1) throw this.invalidCode();
  }

  private ensureConfigured() {
    if (
      !this.transporter
      || !this.config.mail__options__host
      || !this.config.mail__options__auth__user
      || !this.config.mail__options__auth__pass
      || !this.config.mail__from
    ) {
      throw new ServiceUnavailableException('Email service is not configured');
    }
  }

  private normalizeEmail(email: string) {
    return email.trim().toLowerCase();
  }

  private codeKey(email: string, purpose: VerificationPurpose) {
    return `auth:${purpose}-code:${createHash('sha256').update(email).digest('hex')}`;
  }

  private cooldownKey(email: string, purpose: VerificationPurpose) {
    return `${this.codeKey(email, purpose)}:cooldown`;
  }

  private attemptsKey(email: string, purpose: VerificationPurpose) {
    return `${this.codeKey(email, purpose)}:attempts`;
  }

  private hash(email: string, code: string, salt: string) {
    return createHash('sha256').update(`${email}:${code}:${salt}`).digest('hex');
  }

  private boolean(value: string | undefined, fallback: boolean) {
    if (value === undefined) return fallback;
    return value.trim().toLowerCase() === 'true';
  }

  private invalidCode() {
    return new BadRequestException('Verification code is invalid or expired');
  }
}
