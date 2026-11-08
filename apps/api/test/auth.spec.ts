import { createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptBotToken, encryptBotToken } from '@openfacto/database';
import { verifyTelegram } from '../src/product/telegram-auth.js';

const now = 1750000000000,
  token = 'test-manager-token';
function launch(timestamp: number) {
  const q = new URLSearchParams({
    auth_date: String(timestamp),
    query_id: 'one',
    user: JSON.stringify({ id: 123, first_name: 'Али', language_code: 'kk' }),
  });
  const key = createHmac('sha256', 'WebAppData').update(token).digest();
  q.set(
    'hash',
    createHmac('sha256', key)
      .update(
        [...q]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => k + '=' + v)
          .join('\n'),
      )
      .digest('hex'),
  );
  return q;
}
describe('Telegram credentials', () => {
  it('validates signature, bounded age, field uniqueness and replay identity', () => {
    const q = launch(now / 1000);
    const verified = verifyTelegram(q.toString(), token, now);
    expect(verified).toMatchObject({ telegramId: '123', displayName: 'Али', language: 'kk' });
    expect(
      verifyTelegram(
        [...q]
          .reverse()
          .map(([k, v]) => k + '=' + encodeURIComponent(v))
          .join('&'),
        token,
        now,
      ),
    ).toEqual(verified);
    expect(() => verifyTelegram(q.toString(), 'different', now)).toThrow();
    expect(() => verifyTelegram(launch(now / 1000 - 301).toString(), token, now)).toThrow();
    expect(() => verifyTelegram(launch(now / 1000 + 31).toString(), token, now)).toThrow();
    q.append('user', '{}');
    expect(() => verifyTelegram(q.toString(), token, now)).toThrow();
  });
  it('binds encrypted credentials to the bot identity, key, and authenticated ciphertext', () => {
    const key = randomBytes(32).toString('base64'),
      encrypted = encryptBotToken('credential', key, 'bot-1');
    expect(encrypted).not.toContain('credential');
    expect(decryptBotToken(encrypted, key, 'bot-1')).toBe('credential');
    expect(() => decryptBotToken(encrypted, key, 'bot-2')).toThrow();
    expect(() => decryptBotToken(encrypted, randomBytes(32).toString('base64'), 'bot-1')).toThrow();
  });
});
