import {describe,it,expect,vi} from 'vitest';
import{AnswerEngine,type AnswerInput,type Evidence}from'../src/index.js';
const doc:Evidence={organizationId:'o',eventId:'e',sourceId:'s',versionId:'v',kind:'document',title:'Регламент',text:'Апелляция принимается до 17:45 22 ноября.',page:4,language:'ru',aliases:[],visibility:'participant',state:'published'};
const input:AnswerInput={organizationId:'o',eventId:'e',traceId:'t',language:'ru',languageSelection:'auto',mode:'live',question:'апелляция кашанга дейин?',activated:true,handoffEnabled:true,faqOnly:false,sources:[]};
describe('combined interpretation and selection',()=>{
 it('preserves the existing exact FAQ shortcut for a confirmed self-contained question after history',async()=>{
  const faq={...doc,kind:'faq' as const,title:'Где проходит регистрация?',text:'В фойе.'};
  const verify=vi.fn(async()=>true);
  const result=await AnswerEngine.run({...input,question:faq.title,sources:[faq],conversation:[{question:'Сколько человек в команде?',answer:'2–5.'}]},{resolveLanguageInAssessment:true,
   assess:async()=>({kind:'faq',index:0,responseLanguage:'ru',contextIndependent:true}),verify});
  expect(result.answer).toBe(faq.text);expect(result.reasonCode).toBe('exact_faq');expect(verify).not.toHaveBeenCalled();
 });
 it('applies inferred Kazakh before independent evidence verification',async()=>{
  const verify=vi.fn(async(i,claims)=>{expect(i.language).toBe('kk');expect(i.question).toBe(input.question);expect(claims[0].quote).toBe(doc.text);return true;});
  const result=await AnswerEngine.run(input,{resolveLanguageInAssessment:true,retrieve:async()=>[doc],
   assess:async()=>({kind:'document',responseLanguage:'kk',claims:[{index:0,quote:doc.text,statement:'22 қараша сағат 17:45-ке дейін.'}]}),verify});
  expect(result.language).toBe('kk');expect(result.outcome).toBe('grounded_answer');expect(verify).toHaveBeenCalledOnce();
 });
 it('expands retrieval once on missing evidence, preserving the original question',async()=>{
  const retrieve=vi.fn(async i=>i.searchQueries?.includes('апелляция')?[doc]:[]);
  const assess=vi.fn(async(_i,c)=>c.length?{kind:'document' as const,responseLanguage:'kk' as const,claims:[{index:0,quote:doc.text,statement:'17:45-ке дейін.'}]}:{kind:'insufficient' as const,responseLanguage:'kk' as const,searchQueries:['апелляция']});
  const result=await AnswerEngine.run(input,{resolveLanguageInAssessment:true,retrieve,assess,verify:async i=>i.question===input.question});
  expect(result.outcome).toBe('grounded_answer');expect(retrieve).toHaveBeenCalledTimes(2);expect(assess).toHaveBeenCalledTimes(2);
 });
 it('never accepts a fabricated citation or bypasses the independent verifier',async()=>{
  const verify=vi.fn(async()=>true);
  const result=await AnswerEngine.run(input,{resolveLanguageInAssessment:true,retrieve:async()=>[doc],assess:async()=>({kind:'document',responseLanguage:'kk',claims:[{index:0,quote:'До 19:00.',statement:'19:00-ге дейін.'}]}),verify});
  expect(result.reasonCode).toBe('unsupported_claim');expect(verify).not.toHaveBeenCalled();
  const rejected=await AnswerEngine.run(input,{resolveLanguageInAssessment:true,retrieve:async()=>[doc],assess:async()=>({kind:'document',responseLanguage:'kk',claims:[{index:0,quote:doc.text,statement:'17:45-ке дейін.'}]}),verify:async()=>false});
  expect(rejected.reasonCode).toBe('unsupported_claim');
 });
 it('keeps the explicitly selected UI language',async()=>{
  const result=await AnswerEngine.run({...input,languageSelection:'explicit'},{resolveLanguageInAssessment:true,retrieve:async()=>[doc],assess:async()=>({kind:'document',responseLanguage:'kk',claims:[{index:0,quote:doc.text,statement:doc.text}]}),verify:async i=>i.language==='ru'});
  expect(result.language).toBe('ru');expect(result.outcome).toBe('grounded_answer');
 });
 it('fails closed on a missing automatic language and on revoked sources',async()=>{
  const result=await AnswerEngine.run(input,{resolveLanguageInAssessment:true,retrieve:async()=>[doc],assess:async()=>({kind:'insufficient'})});
  expect(result.reasonCode).toBe('provider_unavailable');
  const revoked=await AnswerEngine.run(input,{resolveLanguageInAssessment:true,retrieve:async()=>[doc],current:async()=>false,assess:async()=>({kind:'insufficient',responseLanguage:'kk'})});
  expect(revoked.reasonCode).toBe('source_changed');
 });
});
