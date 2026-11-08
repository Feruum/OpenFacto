import { createHash } from 'node:crypto';

export const CHUNK_REVISION = 'paragraph-sentence-v2';
export interface Page { page: number; text: string }
export interface Chunk extends Page { id: string; ordinal: number }

/** Preserve paragraphs, list/table lines and sentence boundaries before bounded fallback cuts. */
export function chunkPages(versionId: string, pages: Page[]): Chunk[] {
  const chunks: Chunk[] = [];
  for (const page of pages) {
    const text = page.text.replace(/\r\n?/gu, '\n').replace(/[^\S\n]+/gu, ' ').replace(/ *\n */gu, '\n').trim();
    if (!text) continue;
    let buffer = '';
    let heading = '';
    function emit() {
      if (!buffer.trim()) return;
      const body = buffer.trim();
      const ordinal = chunks.length;
      const h = createHash('sha256').update(`${CHUNK_REVISION}:${versionId}:${ordinal}:${body}`).digest('hex');
      chunks.push({ id: `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`, ordinal, page: page.page, text: body });
      buffer = '';
    }
    function append(unit: string, separator: string) {
      const prefix = heading && unit !== heading ? heading + '\n\n' : '';
      if (buffer && buffer.length + separator.length + unit.length > 1000) emit();
      if (!buffer && prefix.length + unit.length <= 1000) buffer = prefix;
      buffer += (buffer && !buffer.endsWith('\n\n') ? separator : '') + unit;
    }
    for (const block of text.split(/\n{2,}/u)) {
      if (/^(?:#{1,6} .+|[^\n.!?]{2,100}:)$/u.test(block)) {
        emit(); heading = block; buffer = heading; continue;
      }
      if (block.length + heading.length + 2 <= 1000) { append(block, '\n\n'); continue; }
      // A line is a natural list/table boundary; prose lines use sentence boundaries.
      for (const line of block.split('\n')) {
        for (const sentence of line.split(/(?<=[.!?。！？])\s+(?=[\p{Lu}\p{N}])/u)) {
          if (sentence.length + heading.length + 2 <= 1000) { append(sentence, '\n'); continue; }
          emit();
          // Pathological long sentences are the only overlapping cuts. No code point is split.
          let rest = sentence;
          while (rest) {
            const capacity = 1000 - (heading ? heading.length + 2 : 0);
            let end = Math.min(capacity, rest.length);
            if (end < rest.length) {
              const word = rest.lastIndexOf(' ', end);
              if (word > capacity * 0.7) end = word;
              if (/^[\uDC00-\uDFFF]$/.test(rest[end] ?? '')) end--;
            }
            append(rest.slice(0, end), '\n'); emit();
            if (end === rest.length) break;
            let next = Math.max(1, end - 120);
            if (/^[\uDC00-\uDFFF]$/.test(rest[next] ?? '')) next++;
            rest = rest.slice(next).trimStart();
          }
        }
      }
    }
    emit();
  }
  return chunks;
}
