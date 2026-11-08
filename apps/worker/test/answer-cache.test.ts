import{describe,it,expect,vi}from'vitest';
import{VerifiedAnswerCache,answerCacheKey}from'../src/answer-cache.js';
import type{Decision}from'@openfacto/answer-engine';
const decision=():Decision=>({traceId:'first',durationMs:12000,outcome:'grounded_answer',reasonCode:'document_evidence',language:'ru',answer:'До 17:45.',sources:[{sourceId:'s',versionId:'v',kind:'document',title:'Регламент',page:4,quote:'До 17:45.'}],steps:[],usage:{paidOperations:2,costMicros:50}});
const input={organizationId:'o',eventId:'e',traceId:'1',question:'Когда апелляция?',language:'ru',languageSelection:'auto',mode:'live',activated:true,faqOnly:false,handoffEnabled:true};
describe('verified answer cache',()=>{
 it('uses the same key after SQL jsonb reorders request and nested history properties',()=>{
  const conversation=[{question:'Что с апелляцией?',answer:'До 17:45.'}];
  const original={...input,conversation};
  const reordered=Object.fromEntries(Object.entries({...input,conversation:[{answer:'До 17:45.',question:'Что с апелляцией?'}]}).reverse());
  expect(answerCacheKey(original,'snapshot','policy')).toBe(answerCacheKey(reordered as typeof original,'snapshot','policy'));
 });
 it('reuses only a current verified answer and attributes no paid usage to the second request',async()=>{
  const cache=new VerifiedAnswerCache(),generate=vi.fn(async()=>decision()),validate=vi.fn(async()=>true);
  await cache.run('key','first',generate,validate);
  const hit=await cache.run('key','second',generate,validate);
  expect(generate).toHaveBeenCalledOnce();expect(hit.traceId).toBe('second');expect(hit.usage.paidOperations).toBe(0);expect(hit.steps[0]?.reason).toBe('hit');
  hit.sources[0]!.title='edited';expect((await cache.run('key','third',generate,validate)).sources[0]?.title).toBe('Регламент');
 });
 it('does not reuse revoked or changed knowledge',async()=>{
  const cache=new VerifiedAnswerCache(),generate=vi.fn(async()=>decision());
  await cache.run('key','first',generate,async()=>true);
  await cache.run('key','second',generate,async()=>false);
  expect(generate).toHaveBeenCalledTimes(2);
 });
 it('isolates scope, complete history, language, source snapshot and model policy',()=>{
  const key=answerCacheKey(input,'versions','model');
  expect(answerCacheKey({...input,traceId:'different'},'versions','model')).toBe(key);
  for(const changed of [{...input,eventId:'other'},{...input,organizationId:'other'},{...input,language:'kk'},{...input,question:'Мне можно позже?'},{...input,conversation:[{question:'А без билета?',answer:'Уточните.'}]},{...input,faqOnly:true},{...input,mode:'draft_preview'}])expect(answerCacheKey(changed,'versions','model')).not.toBe(key);
  expect(answerCacheKey(input,'new document added','model')).not.toBe(key);
  expect(answerCacheKey(input,'versions','new model')).not.toBe(key);
 });
 it('coalesces identical in-flight requests and preserves independent trace IDs',async()=>{
  const cache=new VerifiedAnswerCache();let finish!:(d:Decision)=>void;
  const generate=vi.fn(()=>new Promise<Decision>(resolve=>{finish=resolve;}));
  const first=cache.run('key','first',generate,async()=>true),second=cache.run('key','second',generate,async()=>true);
  await Promise.resolve();finish(decision());const [a,b]=await Promise.all([first,second]);
  expect(generate).toHaveBeenCalledOnce();expect(a.traceId).toBe('first');expect(b.traceId).toBe('second');expect(b.steps[0]?.reason).toBe('coalesced');
 });
 it('does not cache refusals, ungrounded answers or generation failures',async()=>{
  for(const outcome of ['handoff','clarify','refuse'] as const){const cache=new VerifiedAnswerCache(),generate=vi.fn(async()=>({...decision(),outcome}));await cache.run('k','a',generate,async()=>true);await cache.run('k','b',generate,async()=>true);expect(generate).toHaveBeenCalledTimes(2);}
  const cache=new VerifiedAnswerCache(),generate=vi.fn(async()=>({...decision(),sources:[]}));await cache.run('k','a',generate,async()=>true);await cache.run('k','b',generate,async()=>true);expect(generate).toHaveBeenCalledTimes(2);
  await expect(cache.run('bad','a',async()=>{throw Error('offline');},async()=>true)).rejects.toThrow('offline');expect((await cache.run('bad','b',async()=>decision(),async()=>true)).answer).toBe('До 17:45.');
 });
 it('expires entries and bounds the number of cached answers',async()=>{
  let now=0;const cache=new VerifiedAnswerCache({ttlMs:100,maxEntries:1,now:()=>now}),generate=vi.fn(async()=>decision());
  await cache.run('a','a',generate,async()=>true);now=101;await cache.run('a','b',generate,async()=>true);
  await cache.run('b','c',generate,async()=>true);await cache.run('a','d',generate,async()=>true);expect(generate).toHaveBeenCalledTimes(4);
 });
});
