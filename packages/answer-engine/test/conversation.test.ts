import { describe, expect, it, vi } from 'vitest';
import { AnswerEngine, ServiceFailure, type AnswerInput, type AnswerPorts, type Evidence } from '../src/index.js';

const faq: Evidence = { organizationId: 'org', eventId: 'event', sourceId: 'registration', versionId: 'v1',
  kind: 'faq', title: 'Где проходит регистрация?', text: 'Регистрация с 09:00 до 10:00 в фойе.',
  language: 'ru', aliases: [], visibility: 'participant', state: 'published' };
const input = (question: string): AnswerInput => ({ organizationId: 'org', eventId: 'event', sources: [faq],
  question, language: 'ru', mode: 'published_preview', traceId: 'test', activated: true,
  handoffEnabled: true, faqOnly: false });

describe('conversational evidence policy', () => {
  it('serves a repeated original FAQ without AI while rechecking publication', async () => {
    const understand = vi.fn(), current = vi.fn(async () => true);
    const result = await AnswerEngine.run({ ...input(faq.title), languageSelection:'auto', language:'kk',
      conversation:[{question:faq.title,answer:faq.text}] }, {understand,current});
    expect(result.answer).toBe(faq.text); expect(result.language).toBe('ru');
    expect(understand).not.toHaveBeenCalled(); expect(current).toHaveBeenCalledOnce();
  });
  it('avoids retrieval and two extra model calls for a self-contained exact FAQ after chat history', async () => {
    const retrieve = vi.fn(async () => []), assess = vi.fn(async () => ({ kind: 'insufficient' as const })), verify = vi.fn();
    const result = await AnswerEngine.run({ ...input('Где проходит регистрация?'), languageSelection: 'auto',
      conversation: [{ question: 'Сколько человек в команде?', answer: '2–5.' }] }, {
      understand: async () => ({ queries: [faq.title], responseLanguage: 'ru', contextIndependent: true }), retrieve, assess, verify,
    });
    expect(result.answer).toBe(faq.text); expect(result.reasonCode).toBe('exact_faq');
    expect(retrieve).not.toHaveBeenCalled(); expect(assess).not.toHaveBeenCalled(); expect(verify).not.toHaveBeenCalled();
  });
  it('retains history-dependent conditions when evaluating an exact FAQ', async () => {
    const assess = vi.fn(async () => ({ kind: 'personal' as const }));
    const result = await AnswerEngine.run({ ...input(faq.title), languageSelection: 'auto',
      conversation: [{ question: 'Можно мне без билета?', answer: 'Уточните вопрос.' }] }, {
      understand: async () => ({ queries: [faq.title], responseLanguage: 'ru', contextIndependent: false }), assess,
    });
    expect(result.reasonCode).toBe('personal_decision'); expect(assess).toHaveBeenCalledOnce();
  });
  it('uses an original exact approved FAQ despite a speculative clarification from understanding', async () => {
    const result = await AnswerEngine.run({ ...input(faq.title), languageSelection: 'auto' }, {
      understand: async () => ({ responseLanguage: 'ru', queries: [], clarification: 'Вы имеете в виду регистрацию на мероприятие или на сайте?' }),
    });
    expect(result.answer).toBe(faq.text); expect(result.reasonCode).toBe('exact_faq');
  });
  it('accepts a PDF quote with equivalent line wrapping and retains the original excerpt', async () => {
    const doc = { ...faq, kind: 'document' as const, page: 3, text: 'Капитан может подать письменную апелляцию\nкоординатору до 17:45 22 ноября.' };
    const result = await AnswerEngine.run({ ...input('До какого времени подать апелляцию?'), sources: [doc] }, {
      retrieve: async () => [doc], assess: async () => ({ kind: 'document', claims: [{ index: 0, quote: doc.text.replace('\n', ' '), statement: 'До 17:45 22 ноября.' }] }),
      verify: async (_i, claims) => { expect(claims[0]?.quote).toBe(doc.text); return true; },
    });
    expect(result.outcome).toBe('grounded_answer'); expect(result.sources[0]?.quote).toBe(doc.text);
    const forged = await AnswerEngine.run({ ...input('До какого времени подать апелляцию?'), sources: [doc] }, {
      retrieve: async () => [doc], assess: async () => ({ kind: 'document', claims: [{ index: 0, quote: doc.text.replace('17:45','18:45'), statement: 'До 18:45.' }] }), verify: async () => true,
    });
    expect(forged.reasonCode).toBe('unsupported_claim');
  });
  it.each(['рега кайда болады?', 'tirkelu qaida bolady?', 'рега кайда бол'])('detects the answer language before selecting evidence: %s', async question => {
    const kk = { ...faq, sourceId: 'kk-registration', language: 'kk' as const, text: 'Тіркелу фойеде өтеді.', aliases: [question] };
    const result = await AnswerEngine.run({ ...input(question), languageSelection: 'auto', sources: [faq, kk] }, {
      understand: async () => ({ queries: [faq.title], responseLanguage: 'kk' }),
      assess: async (i, candidates) => { expect(i.language).toBe('kk'); return { kind: 'faq', index: candidates.indexOf(kk) }; },
      verify: async i => i.language === 'kk',
    });
    expect(result.language).toBe('kk'); expect(result.answer).toBe(kk.text);
  });
  it('preserves an explicitly selected Playground language', async () => {
    const result = await AnswerEngine.run(input('рега кайда болады?'), {
      understand: async () => ({ queries: [faq.title], responseLanguage: 'kk' }),
      assess: async i => { expect(i.language).toBe('ru'); return { kind: 'faq', index: 0 }; }, verify: async () => true,
    });
    expect(result.language).toBe('ru'); expect(result.answer).toBe(faq.text);
  });
  it('uses the unique approved original FAQ language without a model when there is no context', async () => {
    const understand = vi.fn(async () => ({ queries: [faq.title], responseLanguage: 'ru' as const }));
    const retrieve = vi.fn(async () => []);
    const result = await AnswerEngine.run({ ...input(faq.title), language: 'kk', languageSelection: 'auto' }, { understand, retrieve });
    expect(result.language).toBe('ru'); expect(result.answer).toBe(faq.text);
    expect(understand).not.toHaveBeenCalled(); expect(retrieve).not.toHaveBeenCalled();
  });
  it('uses the detected language for clarification and missing-evidence responses', async () => {
    const auto = { ...input('тіркелу туралы?'), languageSelection: 'auto' as const };
    const result = await AnswerEngine.run(auto, { understand: async () => ({ queries: [], responseLanguage: 'kk', clarification: 'Қай ақпарат керек?' }) });
    expect(result.language).toBe('kk'); expect(result.answer).toBe('Қай мерзім, бөлім немесе шарт туралы сұрап тұрғаныңызды нақтылаңызшы.');
    const missing = await AnswerEngine.run(auto, { understand: async () => ({ queries: ['тіркелу'], responseLanguage: 'kk' }), assess: async () => ({ kind: 'insufficient' }) });
    expect(missing.answer).toBe('Бұл сұраққа модератордың жауабы қажет.');
  });
  it('uses interpreted queries for retrieval while preserving original slang for verification', async () => {
    const retrieve = vi.fn(async (i: AnswerInput) => { expect(i.question).toBe('чо где проходит рега ?');
      expect(i.searchQueries).toContain('Где проходит регистрация?'); return [faq]; });
    const verify = vi.fn(async (i: AnswerInput) => { expect(i.question).toBe('чо где проходит рега ?'); return true; });
    const ports: AnswerPorts = { understand: async () => ({ queries: ['Где проходит регистрация?'] }), retrieve,
      assess: async (_i, candidates) => ({ kind: 'faq', index: candidates.indexOf(faq) }), verify };
    expect((await AnswerEngine.run(input('чо где проходит рега ?'), ports)).outcome).toBe('approved_faq');
    expect(retrieve).toHaveBeenCalledOnce(); expect(verify).toHaveBeenCalledOnce();
  });
  it('searches other languages and verifies the actual translated answer', async () => {
    const translated = 'Тіркелу сағат 09:00-ден 10:00-ге дейін фойеде өтеді.';
    const verify = vi.fn(async (_i, claims) => { expect(claims[0].statement).toBe(translated);
      expect(claims[0].quote).toBe(faq.text); return true; });
    const result = await AnswerEngine.run({ ...input('рега кайда болады?'), language: 'kk' }, {
      assess: async (_i, candidates) => ({ kind: 'faq', index: candidates.indexOf(faq), answer: translated }), verify,
    });
    expect(result.outcome).toBe('grounded_answer'); expect(result.answer).toBe(translated);
    expect(result.sources[0]?.versionId).toBe('v1'); expect(verify).toHaveBeenCalledOnce();
  });
  it('does not silently return a Russian FAQ as a Kazakh answer', async () => {
    const result = await AnswerEngine.run({ ...input('рега кайда?'), language: 'kk' }, {
      assess: async () => ({ kind: 'faq', index: 0 }), verify: async () => true,
    });
    expect(result.outcome).toBe('handoff');
  });
  it('asks a localized clarification without publishing generated facts from a fragment', async () => {
    const assess = vi.fn();
    const result = await AnswerEngine.run(input('рега?'), {
      understand: async () => ({ queries: [], clarification: 'Вы хотите узнать место или время регистрации?' }), assess,
    });
    expect(result.outcome).toBe('clarify'); expect(result.answer).toBe('Уточните, пожалуйста, какой срок, раздел или условие вас интересует?');
    expect(result.sources).toEqual([]); expect(assess).not.toHaveBeenCalled();
  });
  it('keeps the exact FAQ path free and does not use it with unresolved conversation context', async () => {
    const understand = vi.fn(async () => ({ queries: [], clarification: 'Вы спрашиваете про прежнее условие?' }));
    expect((await AnswerEngine.run(input(faq.title), { understand })).outcome).toBe('approved_faq');
    expect(understand).not.toHaveBeenCalled();
    const result = await AnswerEngine.run({ ...input(faq.title), conversation: [{ question: 'А без билета?', answer: 'Уточните место.' }] }, { understand });
    expect(result.outcome).toBe('clarify');
  });
  it('does not disguise provider failure as a need for a personal moderator decision', async () => {
    const result = await AnswerEngine.run(input('рега кайда'), { understand: async () => { throw new ServiceFailure('provider_unavailable'); } });
    expect(result.reasonCode).toBe('provider_unavailable'); expect(result.answer).toContain('временно');
  });
  it('never treats a rewritten exact match as permission to bypass original-question verification', async () => {
    const result = await AnswerEngine.run(input('мне можно без регистрации?'), {
      understand: async () => ({ queries: [faq.title] }), assess: async () => ({ kind: 'faq', index: 0 }), verify: async () => false,
    });
    expect(result.reasonCode).toBe('unsupported_claim');
  });
});
