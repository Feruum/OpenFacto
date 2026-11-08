import{writeFile}from'node:fs/promises';import{randomUUID}from'node:crypto';
import postgres from '../../apps/worker/node_modules/postgres/src/index.js';
import{runScopedAnswer}from'../../apps/worker/dist/answers.js';
import{cases as allCases,evaluate}from'./complex-cases.mjs';
const selected=process.env.BENCH_FILTER?allCases.filter(c=>new RegExp(process.env.BENCH_FILTER,'iu').test(c.q)):allCases;
const cases=selected.flatMap(c=>Array.from({length:Number(process.env.BENCH_REPEAT??1)},()=>c));
const phase=process.env.BENCH_PHASE??'baseline';
process.env.AI_COMBINED_PLANNING=phase==='baseline'?'0':'1';
const sql=postgres(process.env.DATABASE_URL,{max:4,onnotice(){}}), results=[];
let cursor=0;
async function work(){while(cursor<cases.length){const index=cursor++,c=cases[index];
 try{const d=await runScopedAnswer(sql,{organizationId:'62d35e37-de62-4a19-8988-7682602a3461',eventId:'4254f5fa-69c1-4127-93e5-b60817954da5',traceId:randomUUID(),mode:'evaluation',activated:true,language:'ru',languageSelection:'auto',faqOnly:false,handoffEnabled:true,question:c.q,conversation:c.conversation??[]});
 const checks=evaluate(c,d);results.push({index,...c,checks,passed:Object.values(checks).every(Boolean),decision:d});
 console.log(JSON.stringify({index,q:c.q,passed:Object.values(checks).every(Boolean),checks,ms:d.durationMs,calls:d.usage.paidOperations,reason:d.reasonCode,answer:d.answer}));
 }catch(e){results.push({index,...c,passed:false,error:e.message});}
 await writeFile(`output/pdf/complex-${phase}.json`,JSON.stringify(results.sort((a,b)=>a.index-b.index),null,2));
}}
try{await Promise.all([work(),work()]);console.log(JSON.stringify({phase,total:results.length,passed:results.filter(r=>r.passed).length}));}finally{await sql.end();}
