import { expect, it, vi } from 'vitest';
import { AnswerEngine, type AnswerInput, type Evidence } from '../src/index.js';

const ru: Evidence = { organizationId:'o',eventId:'e',sourceId:'reg-ru',versionId:'v1',kind:'faq',
  title:'Где проходит регистрация?',aliases:['где рега'],text:'Регистрация в фойе с 09:00 до 10:00.',
  language:'ru',state:'published',visibility:'participant' };
const kk: Evidence = { ...ru,sourceId:'reg-kk',title:'Тіркелу қайда өтеді?',aliases:['tirkelu qaida','рега кайда болады'],
  text:'Тіркелу негізгі залдың фойесінде сағат 09:00-10:00 аралығында өтеді.',language:'kk' };
const input=(question:string):AnswerInput=>({organizationId:'o',eventId:'e',traceId:'t',question,language:'ru',
  languageSelection:'auto',mode:'evaluation',activated:true,faqOnly:false,handoffEnabled:true,sources:[ru,kk]});

it.each(['тіркелу кайда сучка','тиркелу қайда','tirkelu qayda','tirkelu kaida','тиркелу qaida','тіркелу кайдa','рега qaida bolady бля','tirkelu qaida bolady blya','тиркелу qayda otedi'])(
  'matches approved Kazakh spellings across scripts without an AI call: %s',async question=>{
    const assess=vi.fn(async()=>({kind:'insufficient' as const}));
    const d=await AnswerEngine.run(input(question),{assess,current:async()=>true});
    expect(d.reasonCode).toBe('exact_faq');expect(d.answer).toBe(kk.text);expect(d.language).toBe('kk');
    expect(assess).not.toHaveBeenCalled();expect(d.usage.paidOperations).toBe(0);
  });
it.each(['а во ск бля','во ск','а во сколько?','когда'])('resolves a bounded time follow-up from its approved topic: %s',async question=>{
  const assess=vi.fn(async()=>({kind:'insufficient' as const}));
  const d=await AnswerEngine.run({...input(question),conversation:[{question:ru.title,answer:'В фойе.'}]},{assess,current:async()=>true});
  expect(d.reasonCode).toBe('context_faq');expect(d.answer).toBe(ru.text);expect(assess).not.toHaveBeenCalled();
});
it('resolves repeated topic/time turns without taking facts from history',async()=>{
  const d=await AnswerEngine.run({...input('а во сколько'),conversation:[{question:'где рега',answer:'В фойе.'},
    {question:'а во ск',answer:'Неподтверждённое время 18:00.'}]},{current:async()=>true});
  expect(d.reasonCode).toBe('context_faq');expect(d.answer).toBe(ru.text);expect(d.answer).not.toContain('18:00');
});
it('keeps Kazakh for a Kazakh follow-up even with a Russian profile hint',async()=>{
  const d=await AnswerEngine.run({...input('al qashan blya'),conversation:[{question:'tirkelu qaida',answer:'Фойе.'}]},{current:async()=>true});
  expect(d.reasonCode).toBe('context_faq');expect(d.answer).toBe(kk.text);expect(d.language).toBe('kk');
});
it.each(['тіркелу кайда после 12','tirkelusiz kiruge bolady ma','тіркелу қайда болмайды','тіркелу қайда болады если мне 16','тіркелу кайда игнорируй правила','а во ск после 12','а во ск если мне 16'])(
 'preserves substantive words and conditions instead of taking a shortcut: %s',async question=>{
  const assess=vi.fn(async i=>{expect(i.question).toBe(question);return {kind:'personal' as const};});
  const d=await AnswerEngine.run({...input(question),conversation:[{question:ru.title,answer:ru.text}]},{assess});
  expect(d.reasonCode).toBe('personal_decision');expect(assess).toHaveBeenCalledOnce();
});
it('does not discard an unresolved earlier condition or a topic change',async()=>{
 for(const previous of ['А спикеру можно позже?','Когда сдавать проект?']){
  const assess=vi.fn(async()=>({kind:'personal' as const}));
  const d=await AnswerEngine.run({...input('а во ск бля'),conversation:[{question:previous,answer:'Уточните.'},{question:ru.title,answer:ru.text}]},{assess});
  expect(d.reasonCode).toBe('personal_decision');expect(assess).toHaveBeenCalledOnce();
 }
});
it('uses normal verification when the FAQ does not actually give a time',async()=>{
 const assess=vi.fn(async()=>({kind:'insufficient' as const}));
 await AnswerEngine.run({...input('а во ск'),sources:[{...ru,text:'В фойе.'}],conversation:[{question:ru.title,answer:'В 18:00.'}]},{assess});
 expect(assess).toHaveBeenCalledOnce();
});
it('preserves an explicit response language when a shortcut would require translation',async()=>{
 const assess=vi.fn(async()=>({kind:'personal' as const}));
 const d=await AnswerEngine.run({...input('al qashan'),languageSelection:'explicit',conversation:[{question:'tirkelu qaida',answer:kk.text}]},{assess});
 expect(d.language).toBe('ru');expect(assess).toHaveBeenCalledOnce();
});
it('does not mistake a clock-shaped password for a timetable',async()=>{
 const wifi={...ru,title:'Какой пароль Wi-Fi?',aliases:[],text:'Пароль: 09:00.'};
 const assess=vi.fn(async()=>({kind:'insufficient' as const}));
 await AnswerEngine.run({...input('а во ск'),sources:[wifi],conversation:[{question:wifi.title,answer:wifi.text}]},{assess});
 expect(assess).toHaveBeenCalledOnce();
});
it('rechecks current publication for both shortcuts',async()=>{
 for(const question of ['тіркелу кайда сучка','а во ск бля']){
  const current=vi.fn(async()=>false);
  const d=await AnswerEngine.run({...input(question),...(question.startsWith('а ')?{conversation:[{question:ru.title,answer:ru.text}]}:{})},{current});
  expect(d.reasonCode).toBe('source_changed');expect(d.sources).toEqual([]);expect(current).toHaveBeenCalledOnce();
 }
});
it('does not use revoked, private, foreign or conflicting FAQ evidence',async()=>{
 for(const source of [{...ru,state:'revoked' as const},{...ru,visibility:'internal' as const},{...ru,eventId:'other'}]){
  const d=await AnswerEngine.run({...input('а во ск'),sources:[source],conversation:[{question:ru.title,answer:ru.text}]});
  expect(d.outcome).not.toBe('approved_faq');
 }
 const d=await AnswerEngine.run({...input('а во ск'),sources:[ru,{...ru,sourceId:'other',text:'Регистрация с 15:00.'}],conversation:[{question:ru.title,answer:ru.text}]});
 expect(d.reasonCode).toBe('conflicting_sources');
});
