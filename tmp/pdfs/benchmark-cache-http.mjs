import{randomUUID}from'node:crypto';import{writeFile}from'node:fs/promises';
const base='http://127.0.0.1:53000';
const login=await fetch(base+'/api/v1/auth/local-demo',{method:'POST',headers:{origin:'http://127.0.0.1:55173','content-type':'application/json'},body:'{}'});
if(!login.ok)throw Error('Local login failed: '+login.status);
const session=await login.json(),headers={authorization:'Bearer '+session.token,'content-type':'application/json'};
const org=(await(await fetch(base+'/api/v1/organizations',{headers})).json()).items[0].id;
const event=(await(await fetch(base+`/api/v1/organizations/${org}/events`,{headers})).json()).items[0].id;
const endpoint=base+`/api/v1/organizations/${org}/events/${event}/playground`;
async function request(){
 const start=performance.now();const response=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({requestId:randomUUID(),question:'Подскажи, где регистрироваться участникам и в какие часы работает регистрация?',language:'ru',mode:'published_preview',conversation:[]})});
 if(response.status!==202)throw Error('Enqueue failed: '+response.status);
 let result=await response.json();
 const deadline=Date.now()+120000;
 while(!['completed','failed'].includes(result.status)&&Date.now()<deadline){await new Promise(r=>setTimeout(r,100));const poll=await fetch(endpoint+'/'+result.requestId,{headers});if(!poll.ok)throw Error('Poll failed: '+poll.status);result=await poll.json();}
 if(result.status!=='completed')throw Error('Question failed or timed out');
 return{wallMs:Math.round(performance.now()-start),...result};
}
const cold=await request(),warm=await request();
const passed=['approved_faq','grounded_answer'].includes(cold.decision.outcome)&&cold.decision.answer===warm.decision.answer&&JSON.stringify(cold.decision.sources)===JSON.stringify(warm.decision.sources)&&warm.decision.steps[0]?.stage==='answer_cache'&&warm.decision.usage.paidOperations===0;
await writeFile('output/pdf/verified-cache-http.json',JSON.stringify({passed,cold,warm},null,2));console.log(JSON.stringify({passed,coldMs:cold.wallMs,warmMs:warm.wallMs,cache:warm.decision.steps[0],coldCalls:cold.decision.usage.paidOperations,warmCalls:warm.decision.usage.paidOperations}));
