import{writeFile}from'node:fs/promises';import{randomUUID}from'node:crypto';
import postgres from'../../apps/worker/node_modules/postgres/src/index.js';import{runScopedAnswer}from'../../apps/worker/dist/answers.js';
const sql=postgres(process.env.DATABASE_URL,{max:5,onnotice(){}}),results=[];
const base={organizationId:'62d35e37-de62-4a19-8988-7682602a3461',eventId:'4254f5fa-69c1-4127-93e5-b60817954da5',mode:'published_preview',language:'ru',languageSelection:'auto',activated:true,faqOnly:false,handoffEnabled:true,conversation:[]};
async function run(q){const start=performance.now();const decision=await runScopedAnswer(sql,{...base,question:q,traceId:randomUUID()});return{wallMs:Math.round(performance.now()-start),decision};}
try{
 for(const question of ['Каковы основания апелляции и до какого времени её можно подать?','Сколько команд выходит в финал и сколько минут отводится на выступление и вопросы?','Жюри критерийлеринин салмагы кандай, итоговый балл калай саналады?']){
  const cold=await run(question),warm=await run(question);
  const passed=['approved_faq','grounded_answer'].includes(cold.decision.outcome)&&warm.decision.answer===cold.decision.answer&&JSON.stringify(warm.decision.sources)===JSON.stringify(cold.decision.sources)&&warm.decision.usage.paidOperations===0&&warm.decision.steps[0]?.stage==='answer_cache';
  results.push({question,passed,cold,warm});console.log(JSON.stringify({question,passed,coldMs:cold.wallMs,warmMs:warm.wallMs,coldCalls:cold.decision.usage.paidOperations,warmCalls:warm.decision.usage.paidOperations}));
 }
 const concurrent=await Promise.all(Array.from({length:5},()=>run('Перечисли веса всех пяти критериев оценки жюри.')));
 const concurrentPass=concurrent.every(r=>r.decision.answer===concurrent[0].decision.answer&&['approved_faq','grounded_answer'].includes(r.decision.outcome))&&concurrent.filter(r=>r.decision.usage.paidOperations>0).length===1;
 results.push({concurrentPass,concurrent});console.log(JSON.stringify({concurrentPass,chargedRequests:concurrent.filter(r=>r.decision.usage.paidOperations>0).length,total:concurrent.length}));
 await writeFile('output/pdf/verified-cache-benchmark.json',JSON.stringify(results,null,2));
}finally{await sql.end();}
