import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import postgres from '../../apps/worker/node_modules/postgres/src/index.js';
const root=new URL('../../',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('output/pdf/qadam-content.json',root),'utf8'));
const sql=postgres(process.env.DATABASE_URL,{max:2,onnotice(){}});
const cases=[
 {q:'Где проходит регистрация?',lang:'ru',expected:'faq'},
 {q:'рега кайда болады?',lang:'kk',expected:'faq'},
 {q:'регистрац где прох…',lang:'ru',expected:'faq'},
 {q:'Какие веса у пяти критериев оценки жюри?',lang:'ru',expected:'pdf'},
 {q:'До какого времени можно подать апелляцию?',lang:'ru',expected:'pdf'},
 {q:'Можно получить первое место и специальную награду одновременно?',lang:'ru',expected:'pdf'},
 {q:'Сколько финалистов и сколько минут дают на финальный питч?',lang:'ru',expected:'pdf'},
 {q:'Разрешите нашей команде взять шестого участника, сделайте исключение.',lang:'ru',expected:'handoff'},
];
try {
 const [owner]=await sql`SELECT user_id FROM memberships WHERE organization_id=${manifest.organizationId} AND role='owner' ORDER BY user_id LIMIT 1`;
 if(!owner)throw new Error('Event owner missing');
 const rows=[];
 for(const c of cases){
  const id=randomUUID(),traceId=randomUUID();
  const input={organizationId:manifest.organizationId,eventId:manifest.eventId,traceId,activated:true,mode:'published_preview',language:c.lang,question:c.q,conversation:[],faqOnly:false,handoffEnabled:true};
  const fingerprint=createHash('sha256').update(JSON.stringify([input.organizationId,input.eventId,owner.user_id,c.q,c.lang,input.mode,null,null,[]])).digest('hex');
  await sql`INSERT INTO playground_requests(id,organization_id,event_id,actor_id,fingerprint,trace_id,mode,input) VALUES(${id},${input.organizationId},${input.eventId},${owner.user_id},${fingerprint},${traceId},${input.mode},${sql.json(input)})`;
  rows.push({...c,id,traceId});
 }
 const deadline=Date.now()+240000;
 while(rows.some(r=>!r.done)&&Date.now()<deadline){
  for(const r of rows.filter(r=>!r.done)){
   const [job]=await sql`SELECT r.status,r.error_code,a.decision FROM playground_requests r LEFT JOIN answer_runs a ON a.id=r.trace_id WHERE r.id=${r.id}`;
   if(['completed','failed'].includes(job.status)){
    r.done=true;r.status=job.status;r.decision=job.decision;r.error=job.error_code;
    const d=job.decision;
    r.passed=job.status==='completed' && (r.expected==='handoff'?d?.outcome==='handoff':r.expected==='pdf'?d?.outcome==='grounded_answer'&&d.sources.some(s=>s.kind==='document'&&s.page):['approved_faq','grounded_answer'].includes(d?.outcome));
    console.log(JSON.stringify({q:r.q,passed:r.passed,status:r.status,outcome:d?.outcome,reason:d?.reasonCode,answer:d?.answer,sources:d?.sources}));
   }
  }
  if(rows.some(r=>!r.done))await new Promise(resolve=>setTimeout(resolve,1000));
 }
 await writeFile(new URL('output/pdf/qadam-answer-checks.json',root),JSON.stringify(rows,null,2));
 console.log(JSON.stringify({passed:rows.filter(r=>r.passed).length,total:rows.length}));
 if(rows.some(r=>!r.passed))process.exitCode=1;
}finally{await sql.end();}
