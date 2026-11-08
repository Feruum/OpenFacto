import type { ConversationTurn } from './index.js';

/** Parse trusted storage (including legacy clarification strings) or an already decoded API array. */
export function conversationFrom(value: unknown): ConversationTurn[] {
  if (value === undefined || value === null) return [];
  if (typeof value === 'string') {
    if (!value.trim()) return [];
    if (value.startsWith('[')) {
      try { return conversationFrom(JSON.parse(value)); }
      catch { /* Legacy questions may begin with a bracket without being JSON. */ }
    }
    return [{ question: value.slice(-2000), answer: '' }];
  }
  if (!Array.isArray(value) || value.length > 3) throw new Error('Invalid conversation');
  return value.map(turn => {
    if (!turn || typeof turn.question !== 'string' || !turn.question.trim() || turn.question.length > 2000 ||
      typeof turn.answer !== 'string' || turn.answer.length > 4000 || /\0/.test(turn.question + turn.answer))
      throw new Error('Invalid conversation');
    return { question: turn.question, answer: turn.answer };
  });
}

export function appendConversation(turns: ConversationTurn[], question: string, answer: string): ConversationTurn[] {
  return [...turns, { question: question.slice(0, 2000), answer: answer.slice(0, 4000) }].slice(-3);
}
