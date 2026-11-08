import { expect, it, vi } from 'vitest';
import { AnswerEngine, type AnswerInput, type Evidence } from '../src/index.js';

const document: Evidence = { organizationId:'o',eventId:'e',sourceId:'pdf',versionId:'v',kind:'document',
  title:'Агенда',text:'Регистрация: 09:00–10:00, фойе.',language:'ru',aliases:[],visibility:'participant',state:'published',page:1 };
const faq: Evidence = { ...document,sourceId:'faq',kind:'faq',title:'Где регистрация?',text:'В фойе с 09:00 до 10:00.' };
const input: AnswerInput = { organizationId:'o',eventId:'e',traceId:'t',mode:'evaluation',language:'ru',question:'а во ск бля',
  activated:true,faqOnly:false,handoffEnabled:true,sources:[],conversation:[{question:'где регистрация?',answer:'Регистрация проходит в фойе с 09:00 до 10:00.'}] };

it('repairs a quote copied from history instead of publishing it or immediately handing off',async()=>{
  const assess=vi.fn().mockResolvedValueOnce({kind:'document',claims:[{index:0,quote:input.conversation![0]!.answer,statement:'С 09:00 до 10:00.'}]})
    .mockResolvedValueOnce({kind:'faq',index:1});
  const verify=vi.fn(async(_input:AnswerInput,_claims:{evidence:Evidence}[])=>true);
  const result=await AnswerEngine.run(input,{retrieve:async()=>[document,faq],assess,verify,current:async()=>true});
  expect(result.outcome).toBe('approved_faq');expect(result.answer).toBe(faq.text);
  expect(assess.mock.calls.map(call=>call[2])).toEqual([0,2]);
  expect(verify).toHaveBeenCalledOnce();expect(verify.mock.calls[0]?.[1][0]?.evidence).toBe(faq);
});

it('limits repair to one attempt and never verifies a quote absent from the selected source',async()=>{
  const assess=vi.fn(async()=>({kind:'document' as const,claims:[{index:0,quote:'Выдуманная цитата',statement:'С 08:00.'}]}));
  const verify=vi.fn(async()=>true);
  const result=await AnswerEngine.run(input,{retrieve:async()=>[document],assess,verify});
  expect(result.reasonCode).toBe('unsupported_claim');expect(result.sources).toEqual([]);
  expect(assess).toHaveBeenCalledTimes(2);expect(verify).not.toHaveBeenCalled();
});

it('still rejects an unsupported answer after a structurally successful repair',async()=>{
  const assess=vi.fn().mockResolvedValueOnce({kind:'document',claims:[{index:0,quote:'Несуществующая цитата',statement:'Можно без заявки.'}]})
    .mockResolvedValueOnce({kind:'faq',index:1});
  const result=await AnswerEngine.run(input,{retrieve:async()=>[document,faq],assess,verify:async()=>false});
  expect(result.reasonCode).toBe('unsupported_claim');expect(result.sources).toEqual([]);
});
