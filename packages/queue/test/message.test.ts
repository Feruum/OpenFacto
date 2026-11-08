import { expect, it } from 'vitest';
import { decodeJob } from '../src/message.js';
const id = '00000000-0000-4000-8000-000000000001';
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));
it('accepts both AI channels on one physical queue', () => {
  for (const name of ['telegram', 'playground']) {
    const job = { name, data: { id } };
    expect(decodeJob('ai.questions', bytes(job))).toEqual(job);
  }
});
it('rejects poison messages and accidental sensitive payloads', () => {
  for (const job of [{name:'other',data:{id}}, {name:'telegram',data:{id,question:'secret'}},
    {name:'telegram',data:{id:'not-a-uuid'}}, {name:'telegram',data:{id},secret:'token'}, null]) {
    expect(() => decodeJob('ai.questions', bytes(job))).toThrow();
  }
  expect(() => decodeJob('ai.questions', Buffer.from('{'))).toThrow();
  expect(() => decodeJob('ai.questions', Buffer.alloc(1025))).toThrow();
});
