import { ServiceFailure, type Evidence } from '@openfacto/answer-engine';

export async function semanticRerank(question: string, candidates: Evidence[]): Promise<Evidence[]> {
  if (!process.env.RERANK_URL || !candidates.length) return candidates;
  try {
    const url = new URL(process.env.RERANK_URL);
    if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.pathname !== '/v1/rerank' || url.username || url.password || url.search || url.hash)
      throw new Error('Invalid reranker URL');
    const response = await fetch(url, {
      method: 'POST', redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(30_000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: question.slice(0, 4000), documents: candidates.map(c => `${c.title}\n${c.text}`.slice(0, 4000)) }),
    });
    if (!response.ok || !response.body) throw new Error('Reranker unavailable');
    const reader = response.body.getReader();
    const bytes: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 32_768) throw new Error('Reranker response limit');
        bytes.push(value);
      }
    } finally { await reader.cancel(); }
    const data = JSON.parse(Buffer.concat(bytes).toString('utf8'));
    const rows = data.results as { index: number; score: number }[];
    if (!Array.isArray(rows) || rows.length !== candidates.length || new Set(rows.map(r => r.index)).size !== candidates.length ||
      rows.some(r => !Number.isInteger(r.index) || r.index < 0 || r.index >= candidates.length || !Number.isFinite(r.score)))
      throw new Error('Invalid reranker response');
    return rows.sort((a, b) => b.score - a.score || a.index - b.index).map(r => candidates[r.index]!);
  } catch { throw new ServiceFailure('provider_unavailable'); }
}
