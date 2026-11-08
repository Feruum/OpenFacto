import { expect, it } from 'vitest';
import type { AnswerInput, Evidence } from '@openfacto/answer-engine';
import { verificationPayload } from '../src/verification-payload.js';

const input = { question: 'Можно войти?', language: 'kk', conversation: [{ question: 'Без регистрации?', answer: 'Уточните.' }] } as AnswerInput;
const source: Evidence = { organizationId: 'org', eventId: 'event', sourceId: 'rules', versionId: 'v1',
  kind: 'document', title: 'Вход', text: 'Вход разрешён только по приглашению. После 12:00 вход закрыт.',
  aliases: [], language: 'ru', visibility: 'participant', state: 'published', page: 1 };

it('includes an edge-cleaned wording hint while retaining the raw question and its conditions',()=>{
 const raw='blya tirkelusiz kiruge bolady ma suka';
 const payload=verificationPayload({...input,question:raw},[],[]);
 expect(payload.question).toBe(raw);
 expect(payload.questionWording).toBe('tirkelusiz kiruge bolady ma');
 expect(payload.conversation).toEqual(input.conversation);
});

it('sends selected evidence once while retaining its full condition and contradictory sources', () => {
  const conflict = { ...source, sourceId: 'other', text: 'Вход закрыт с 11:00.' };
  const nextPage = { ...source, page: 2, text: 'Исключения согласует организатор.' };
  const claims = [{ statement: 'Вход по приглашению.', quote: 'Вход разрешён', evidence: source }];
  const payload = verificationPayload(input, claims, [source, conflict, nextPage]);
  expect(payload.claims[0]).toMatchObject({ context: source.text, quote: 'Вход разрешён' });
  expect(payload.otherEvidence.map(s => s.text)).toEqual([conflict.text, nextPage.text]);
  expect(JSON.stringify(payload).split(source.text).length - 1).toBe(1);
  expect(payload.conversation).toEqual(input.conversation);
});
it('preserves the approved FAQ and translated statement independently', () => {
  const faq = { ...source, kind: 'faq' as const };
  const payload = verificationPayload(input, [{ statement: 'Шақырумен кіруге болады.', quote: faq.text, evidence: faq }], [faq]);
  expect(payload.claims[0]).toMatchObject({ approvedQuestion: faq.title, approvedAnswer: faq.text,
    sourceLanguage: 'ru', statement: 'Шақырумен кіруге болады.' });
  expect(payload.otherEvidence).toEqual([]);
});
