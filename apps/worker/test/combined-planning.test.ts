import{describe,it,expect}from'vitest';
import{planningMetadata}from'../src/combined-planning.js';
describe('combined planning schema boundary',()=>{
 it('preserves validated multilingual hints without treating them as evidence',()=>{
  expect(planningMetadata({responseLanguage:'kk',searchQueries:['апелляция','апелляция']},true)).toEqual({responseLanguage:'kk',searchQueries:['апелляция']});
 });
 it('rejects missing/invalid automatic language and unbounded query expansion',()=>{
  for(const value of [{},{responseLanguage:'fr'},{responseLanguage:'kk',searchQueries:[42]},{responseLanguage:'ru',searchQueries:['x'.repeat(601)]},{responseLanguage:'ru',searchQueries:['a','b','c','d']}])expect(()=>planningMetadata(value,true)).toThrow();
 });
 it('allows legacy explicit-language results without planning metadata',()=>{expect(planningMetadata({kind:'faq',index:0})).toEqual({});});
});
