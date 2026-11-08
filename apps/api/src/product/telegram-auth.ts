import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';

export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export function sameDigest(actual: string, expected: string) {
  return /^[a-f0-9]{64}$/.test(expected) && timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}
export function verifyTelegram(initData: unknown, token: string | undefined, now = Date.now()) {
  if (!token) throw new ServiceUnavailableException();
  if (typeof initData !== 'string' || initData.length > 16384) throw new UnauthorizedException();
  const params = new URLSearchParams(initData);
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length) throw new UnauthorizedException();
  const check = keys
    .filter((k) => k !== 'hash')
    .sort()
    .map((k) => k + '=' + params.get(k))
    .join('\n');
  const key = createHmac('sha256', 'WebAppData').update(token).digest();
  const signature = createHmac('sha256', key).update(check).digest('hex');
  const authDate = Number(params.get('auth_date'));
  const age = now / 1000 - authDate;
  if (!sameDigest(signature, params.get('hash') ?? '') || !Number.isSafeInteger(authDate) || age < -30 || age > 300)
    throw new UnauthorizedException();
  try {
    const user = JSON.parse(params.get('user') ?? '');
    if (
      !Number.isSafeInteger(user.id) ||
      user.id < 1 ||
      typeof user.first_name !== 'string' ||
      !user.first_name.trim() ||
      user.first_name.includes('\0') ||
      user.is_bot === true
    )
      throw new Error();
    const language = ['en', 'kk'].includes(user.language_code) ? (user.language_code as 'en' | 'kk') : 'ru';
    return { telegramId: String(user.id), displayName: user.first_name.slice(0, 120), language, initHash: signature };
  } catch {
    throw new UnauthorizedException();
  }
}
