import { describe, expect, it } from 'vitest';
import { chunkPages } from '../src/document-chunks.js';

describe('structured chunks', () => {
  it('keeps permission and its exception together instead of cutting at a character target', () => {
    const preamble = 'Подробности программы. '.repeat(38);
    const rule = 'Участники могут пройти без регистрации только при наличии письменного приглашения организатора.';
    const chunks = chunkPages('v1', [{ page: 1, text: preamble + '\n\n' + rule }]);
    expect(chunks.some(c => c.text.includes(rule))).toBe(true);
    expect(chunks.every(c => c.text.length <= 1000)).toBe(true);
  });
  it('preserves table rows, paragraphs and section context', () => {
    const chunks = chunkPages('v1', [{ page: 4, text: '# Расписание\n\nВремя | Зал\n10:00 | А\n11:00 | Б\n\n' + 'Следующее предложение. '.repeat(100) }]);
    expect(chunks[0]?.text).toContain('Время | Зал\n10:00 | А\n11:00 | Б');
    expect(chunks.every(c => c.page === 4 && c.text.startsWith('# Расписание'))).toBe(true);
  });
  it('never loses Unicode text on emergency cuts and has content-sensitive IDs', () => {
    const text = 'Әңгіменің жалғасы 😀 '.repeat(150);
    const chunks = chunkPages('v', [{ page: 2, text }]);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.text.isWellFormed()).toBe(true);
    expect(chunkPages('v', [{ page: 2, text: 'first' }])[0]?.id).not.toBe(chunkPages('v', [{ page: 2, text: 'second' }])[0]?.id);
  });
});
