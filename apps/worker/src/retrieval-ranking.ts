export function mergeRanks<T extends { sourceId: string; versionId: string; chunkId?: string; page?: number; section?: string }>(lists: T[][]): (T & { score: number })[] {
  const hits = new Map<string, { item: T; score: number }>();
  for (const list of lists) {
    const seen = new Set<string>();
    for (const [rank, item] of list.entries()) {
      const key = JSON.stringify([item.sourceId, item.versionId, item.chunkId, item.page, item.section]);
      if (seen.has(key)) continue;
      seen.add(key);
      const previous = hits.get(key);
      hits.set(key, { item: previous?.item ?? item, score: (previous?.score ?? 0) + 1 / (60 + rank + 1) });
    }
  }
  return [...hits.values()].sort((a, b) => b.score - a.score).map(({ item, score }) => ({ ...item, score }));
}

/** Keep each query's strongest results before consensus can crowd out a corrected query. */
export function mergeQueryRanks<T extends { sourceId: string; versionId: string; chunkId?: string; page?: number; section?: string }>(lists: T[][]) {
  const key = (hit: T) => JSON.stringify([hit.sourceId, hit.versionId, hit.chunkId, hit.page, hit.section]);
  const ranked = mergeRanks(lists);
  const priority = new Set(lists.flatMap(list => list.slice(0, 2)).map(key));
  return [
    ...ranked.filter(hit => priority.has(key(hit))),
    ...ranked.filter(hit => !priority.has(key(hit))),
  ];
}

export function interleaveDocumentHits<T extends { id: string }>(dense: T[], lexical: T[], limit: number): T[] {
  const result: T[] = [];
  const seen = new Set<string>();
  for (let i = 0; result.length < limit && (i < dense.length || i < lexical.length); i++) {
    for (const hit of [dense[i], lexical[i]]) {
      if (hit && !seen.has(hit.id) && result.length < limit) {
        seen.add(hit.id);
        result.push(hit);
      }
    }
  }
  return result;
}
