import { expect, it } from 'vitest';
import { conversationFrom, appendConversation } from '../src/conversation.js';

it('keeps bounded chronological turns and accepts legacy clarification text', () => {
  expect(conversationFrom('рега?')).toEqual([{ question: 'рега?', answer: '' }]);
  expect(conversationFrom('[регистрация] где?')).toEqual([{ question: '[регистрация] где?', answer: '' }]);
  let turns = conversationFrom(undefined);
  for (let i = 0; i < 5; i++) turns = appendConversation(turns, String(i), 'answer');
  expect(turns.map(t => t.question)).toEqual(['2','3','4']);
  expect(conversationFrom(JSON.stringify(turns))).toEqual(turns);
});
it('rejects oversized or malformed client context', () => {
  for (const context of [[{question: 'x', answer: 2}], [{question: 'x'.repeat(2001),answer:''}], Array(4).fill({question:'x',answer:''}), {}])
    expect(() => conversationFrom(context)).toThrow();
});
