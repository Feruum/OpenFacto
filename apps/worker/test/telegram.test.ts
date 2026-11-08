import { describe, expect, it } from 'vitest';
import { activation, formatTelegramAnswer, splitTelegramText } from '../src/telegram.js';

const bot = { telegram_bot_id: '55', username: 'city_bot', aliases: ['зима'], allowed_chat_ids: ['-10'] };
const message = (text: string) => ({ text, from: { id: 1 }, chat: { type: 'supergroup', id: -10 } });
describe('Telegram activation and delivery boundaries', () => {
  it.each(['лол, где рега?', 'ЛОЛ! где рега?', 'лол\nгде рега?', 'где рега, лол?', 'лол 🦉 где рега?'])('activates a complete configured name: %s', text => {
    expect(activation(message(text), { ...bot, aliases: ['лол'] })).toBe('где рега');
  });
  it.each(['лол','ЛоЛ!!!'])('activates even when only the name is supplied: %s', text => {
    expect(activation(message(text), { ...bot, aliases: ['лол'] })).toBe('');
  });
  it.each(['лолка где рега?', 'трололол где рега?', 'лол123 где рега?', 'где рега?', 'привет всем'])('ignores unrelated chatter and name substrings: %s', text => {
    expect(activation(message(text), { ...bot, aliases: ['лол'] })).toBeNull();
  });
  it('hides FAQ titles and retains compact document references and answer links', () => {
    const ref = { sourceId: 's', versionId: 'v', kind: 'faq' as const, title: 'Где проходит регистрация?' };
    expect(formatTelegramAnswer({ outcome:'approved_faq',answer: 'В фойе.', language: 'ru', sources: [ref, ref] })).toBe('В фойе.');
    expect(formatTelegramAnswer({ outcome:'grounded_answer',answer: '17:45-ке дейін.', language: 'kk', sources: [{ ...ref, kind:'document',title:'Регламент',page: 4 }] }))
      .toBe('17:45-ке дейін.\n\nДереккөз: Регламент · 4-бет');
    expect(formatTelegramAnswer({ outcome:'grounded_answer',answer: 'Until 17:45.', language: 'en', sources: [{ ...ref,kind:'document',title:'Rules', page: 4 }] })).toContain('Source: Rules · p. 4');
    expect(formatTelegramAnswer({ outcome:'clarify',answer: 'Уточните вопрос.', language: 'ru', sources: [ref] })).toBe('Уточните вопрос.');
    expect(formatTelegramAnswer({ outcome:'approved_faq',answer: 'До 12:00.', language:'ru',sources:[{...ref,title:'Когда сдавать проект?'}]})).toBe('До 12:00.');
    const registration='Подайте заявку: https://businesscup.zimran.io/en/apply';
    expect(formatTelegramAnswer({ outcome:'approved_faq',answer:registration,language:'ru',sources:[{...ref,title:'Как зарегистрировать команду?'}]})).toBe(registration);
  });
  it('matches only a complete alias, the actual bot, an allowed group and the configured mode', () => {
    expect(activation(message('Зима, дедлайн?'), bot)).toBe('дедлайн');
    expect(activation(message('зимами'), bot)).toBeNull();
    expect(activation(message('/ask@other_bot help'), bot)).toBeNull();
    expect(activation(message('/ask@city_bot help'), bot)).toBe('help');
    expect(activation(message('@city_bot help'), { ...bot, allowed_chat_ids: [] })).toBeNull();
    expect(activation(message('зима deadline'), { ...bot, group_mode: 'mention_only' })).toBeNull();
    expect(activation({ ...message('follow up'), reply_to_message: { from: { id: 55 } } }, bot)).toBe('follow up');
  });
  it('sends all approved text without cutting a supplementary Unicode character', () => {
    const body = 'я'.repeat(4095) + '🦉' + 'word '.repeat(1600) + '\nРегламент · 7';
    const parts = splitTelegramText(body);
    expect(parts.join('')).toBe(body);
    expect(parts.every((p) => p.length <= 4096 && p.isWellFormed())).toBe(true);
  });
});
