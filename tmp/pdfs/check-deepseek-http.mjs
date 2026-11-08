import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const base='http://127.0.0.1:53000';
const login=await fetch(base+'/api/v1/auth/local-demo',{method:'POST',headers:{origin:'http://127.0.0.1:55273','content-type':'application/json'},body:'{}'});
if(!login.ok)throw Error('Local login failed: '+login.status);
const session=await login.json(),headers={authorization:'Bearer '+session.token,'content-type':'application/json'};
const org=(await(await fetch(base+'/api/v1/organizations',{headers})).json()).items[0].id;
const event=(await(await fetch(base+`/api/v1/organizations/${org}/events`,{headers})).json()).items[0].id;
const endpoint=base+`/api/v1/organizations/${org}/events/${event}/playground`;
async function request(question,language){
  const start=performance.now();
  const response=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({requestId:randomUUID(),question,language,mode:'published_preview',conversation:[]})});
  if(response.status!==202)throw Error('Enqueue failed: '+response.status);
  let result=await response.json();const deadline=Date.now()+120000;
  while(!['completed','failed'].includes(result.status)&&Date.now()<deadline){
    await new Promise(r=>setTimeout(r,150));
    const poll=await fetch(endpoint+'/'+result.requestId,{headers});
    if(!poll.ok)throw Error('Poll failed: '+poll.status);result=await poll.json();
  }
  if(result.status!=='completed')throw Error('Question failed or timed out');
  return {question,wallMs:Math.round(performance.now()-start),...result};
}
const ru=await request('Где регестрация, бля?','ru');
const kk=await request('tirkelu qaida bolady blya?','kk');
const warm=await request(ru.question,'ru');
const passed=[ru,kk,warm].every(r=>['approved_faq','grounded_answer'].includes(r.decision.outcome)&&r.decision.sources.length&&r.decision.answer.includes('09:00'))
  &&ru.decision.language==='ru'&&kk.decision.language==='kk'
  &&warm.decision.steps[0]?.stage==='answer_cache'&&warm.decision.usage.paidOperations===0;
await writeFile('output/pdf/deepseek-playground-http.json',JSON.stringify({passed,org,event,ru,kk,warm},null,2));
console.log(JSON.stringify({passed,ruMs:ru.wallMs,kkMs:kk.wallMs,warmMs:warm.wallMs,reasons:[ru,kk,warm].map(r=>r.decision.reasonCode)}));
if(!passed)process.exitCode=1;
