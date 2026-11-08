import { describe, expect, it } from 'vitest';
import { parseUnderstanding } from '../src/understanding.js';

describe('model understanding boundary', () => {
  it('validates the independence flag used for the FAQ shortcut', () => {
    expect(parseUnderstanding({queries:['где рега'],responseLanguage:'ru',contextIndependent:true}).contextIndependent).toBe(true);
    expect(() => parseUnderstanding({queries:['где рега'],contextIndependent:'true'})).toThrow();
  });
  it('validates the detected response language and requires it in automatic mode', () => {
    expect(parseUnderstanding({ queries: ['тіркелу'], responseLanguage: 'kk' }, true).responseLanguage).toBe('kk');
    expect(() => parseUnderstanding({ queries: ['registration'], responseLanguage: 'unknown' }, true)).toThrow();
    expect(() => parseUnderstanding({ queries: ['registration'] }, true)).toThrow();
  });
  it('accepts bounded multilingual retrieval hints, preserving negation as ordinary text', () => {
    expect(parseUnderstanding({ queries: ['Можно без регистрации?', 'Тіркелусіз кіруге бола ма?'] }))
      .toEqual({ queries: ['Можно без регистрации?', 'Тіркелусіз кіруге бола ма?'] });
  });
  it('rejects malformed or unbounded output instead of silently using a fabricated interpretation', () => {
    for (const value of [{}, { queries: [42] }, { queries: ['x'.repeat(601)] }, { queries: ['a','b','c','d'] }, { queries: [] }])
      expect(() => parseUnderstanding(value)).toThrow();
  });
  it('accepts a clarification with no invented search intent', () => {
    expect(parseUnderstanding({ queries: [], clarification: 'Где или когда проходит регистрация?' }).clarification).toContain('Где или когда');
  });
});
