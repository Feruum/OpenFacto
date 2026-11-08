import type{Language}from'./index.js';

/** Only complete social utterances; a greeting followed by an event question stays in RAG. */
export function socialReply(question:string,hint:Language,automatic:boolean):{language:Language;answer:string}|undefined {
 const availability=/^(?:ты )?(?:работаешь|тут|на связи|живой)$/u.test(question);
 if(availability){const language=automatic?'ru':hint;return{language,answer:{ru:'Да, я на связи 🙂 Что подсказать по мероприятию?',kk:'Иә, осындамын 🙂 Іс-шара туралы не білгің келеді?',en:'Yes, I’m here 🙂 What would you like to know about the event?'}[language]};}
 const patterns:[Language,RegExp][]=[
  ['ru',/^(?:(?:привет|здравствуй|здравствуйте|здарова|добрый день|добрый вечер)(?: как (?:дела|жела|ты))?|как (?:дела|жела|делишки|ты))$/u],
  ['kk',/^(?:(?:сәлем|салем|сәлеметсіз бе)(?: (?:қалайсың|калайсын|қалайсыз|калайсыз|қалың қалай|калын калай))?|қалайсың|калайсын|қалың қалай|калын калай)$/u],
  ['en',/^(?:(?:hi|hello|hey)(?: how are you)?|how are you)$/u],
 ];
 const detected=patterns.find(([,pattern])=>pattern.test(question))?.[0];
 if(!detected)return;
 const language=automatic?detected:hint;
 const replies={ru:'Привет! Я на связи 🙂 Что подсказать по мероприятию?',kk:'Сәлем! Осындамын 🙂 Іс-шара туралы не білгің келеді?',en:'Hi! I’m here 🙂 What would you like to know about the event?'};
 return{language,answer:replies[language]};
}
