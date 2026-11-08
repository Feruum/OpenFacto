import { expect, it } from 'vitest';
import { mergeRanks,mergeQueryRanks,interleaveDocumentHits } from '../src/retrieval-ranking.js';

it('retains the best corrected-query result instead of losing it to generic consensus',()=>{
 const common=Array.from({length:6},(_,i)=>({sourceId:'s',versionId:'v',chunkId:'c'+i}));
 const appeal={sourceId:'s',versionId:'v',chunkId:'appeal'};
 expect(mergeQueryRanks([common,[common[0]!,appeal,...common.slice(1)]]).slice(0,6).some(x=>x.chunkId==='appeal')).toBe(true);
});
it('reserves room for an exact lexical document match alongside dense candidates',()=>{
 const dense=[{id:'a'},{id:'b'},{id:'c'}],lexical=[{id:'rare'}];
 expect(interleaveDocumentHits(dense,lexical,3).map(x=>x.id)).toEqual(['a','rare','b']);
});

it('retains separate chunks on the same PDF page and deduplicates repeated chunks', () => {
  const a = { sourceId:'s',versionId:'v',page:1,chunkId:'a',text:'Registration hall',score:0.9 };
  const b = { ...a,chunkId:'b',text:'Unrelated closing remarks',score:0.1 };
  expect(mergeRanks([[a,b],[a]]).map(x=>x.chunkId)).toEqual(['a','b']);
});
it('preserves multilingual consensus score rather than the last query-specific score', () => {
  const a = {sourceId:'s',versionId:'v',chunkId:'a',score:0.01};
  const b = {...a,sourceId:'other',chunkId:'b',score:0.99};
  const hits = mergeRanks([[b,a],[a]]);
  expect(hits[0]?.chunkId).toBe('a');
  expect([...hits].sort((x,y)=>y.score-x.score)[0]?.chunkId).toBe('a');
});
