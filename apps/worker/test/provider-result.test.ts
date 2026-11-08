import { describe, expect, it } from 'vitest';
import { parseProviderCompletion } from '../src/provider-result.js';

const completion = (value: unknown, finish: unknown = 'stop', usage: unknown = { prompt_tokens: 10, completion_tokens: 5 }) => ({
  usage, choices: [{ finish_reason: finish, message: { content: JSON.stringify(value) } }],
});

describe('provider completion validation', () => {
  it('accepts a selection without rejected and preserves optional old diagnostics', () => {
    const value = { kind: 'faq', index: 0, responseLanguage: 'ru' };
    expect(parseProviderCompletion(completion(value), 'select', true).value).toEqual(value);
    const rejected = [{ index: 1, reason: 'wrong_topic' }];
    expect(parseProviderCompletion(completion({ ...value, rejected }), 'select', true).value?.rejected).toEqual(rejected);
  });
  it.each(['length', 'content_filter', 'tool_calls', null])('rejects finish reason %s even with valid JSON', finish => {
    const result = parseProviderCompletion(completion({ supported: true }, finish), 'verify', false);
    expect(result.value).toBeNull();
    expect(result.diagnostics.parseStatus).toBe('invalid_finish');
    expect(result.diagnostics.completionTokens).toBe(5);
  });
  it('records malformed JSON without losing known billable tokens', () => {
    const body = completion({}); body.choices[0]!.message.content = '{"supported":';
    const result = parseProviderCompletion(body, 'verify', false);
    expect(result.value).toBeNull();
    expect(result.diagnostics.parseStatus).toBe('invalid_json');
    expect(result.diagnostics.promptTokens).toBe(10);
  });
  it.each([{}, { supported: 'true' }, { supported: 1 }])('requires boolean verification: %j', value => {
    expect(parseProviderCompletion(completion(value), 'verify', false).diagnostics.parseStatus).toBe('invalid_schema');
  });
  it.each([
    { kind: 'made_up', responseLanguage: 'ru' },
    { kind: 'document', responseLanguage: 'ru', claims: [] },
    { kind: 'document', responseLanguage: 'ru', claims: [{ index: -1, quote: 'text', statement: 'text' }] },
    { kind: 'faq', index: 0 },
    { kind: 'faq', index: 0, responseLanguage: 'ru', answer: 123 },
  ])('rejects invalid selection: %j', value => {
    expect(parseProviderCompletion(completion(value), 'select', true).diagnostics.parseStatus).toBe('invalid_schema');
  });
  it('preserves a negative independent verification as valid', () => {
    expect(parseProviderCompletion(completion({ supported: false }), 'verify', false).value).toEqual({ supported: false });
  });
  it('retains zero cached/reasoning tokens and marks unavailable fields unknown', () => {
    const result = parseProviderCompletion(completion({ supported: true }, 'stop', {
      prompt_tokens: 10, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 0 },
      completion_tokens_details: { reasoning_tokens: 2 },
    }), 'verify', false);
    expect(result.diagnostics).toMatchObject({ cachedTokens: 0, reasoningTokens: 2 });
    expect(parseProviderCompletion(completion({ supported: true }), 'verify', false).diagnostics.cachedTokens).toBeNull();
    expect(parseProviderCompletion(completion({ supported: true }, 'stop', {}), 'verify', false).diagnostics.parseStatus).toBe('missing_usage');
  });
});
