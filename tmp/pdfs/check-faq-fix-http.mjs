import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const base='http://127.0.0.1:53000';
const login=await fetch(base+'/api/v1/auth/local-demo',{method:'POST',headers:{origin:'http://127.0.0.1:55273','content-type':'application/json'},body:'{}'});
if(!login.ok)throw Error('Local authentication failed: '+login.status);
const session=await login.json(),headers={authorization:'Bearer '+session.token,'content-type':'application/json'};
async function api(path,method='GET',body){
 const r=await fetch(base+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})});
 if(!r.ok)throw Error(method+' '+path+': '+r.status);
 return r.status===204?undefined:r.json();
}
const org=(await api('/api/v1/organizations')).items[0].id;
const event=(await api(`/api/v1/organizations/${org}/events`)).items[0].id;
const root=`/api/v1/organizations/${org}/events/${event}`,play=root+'/playground';
let fixture;
try{
 fixture=await api(root+'/sources','POST',{kind:'faq',language:'kk',title:'Тіркелу қайда өтеді?',
  body:'Тіркелу негізгі залдың фойесінде сағат 09:00-10:00 аралығында өтеді.',aliases:['tirkelu qaida'],visibility:'participant'});
 await api(root+'/sources/'+fixture.id+'/publish','POST',{});
 const cases=[
  {question:'тіркелу кайда сучка',language:'kk',reason:'exact_faq',conversation:[]},
  {question:'tirkelu qaida bolady blya',language:'kk',reason:'exact_faq',conversation:[]},
  {question:'а во ск бля',language:'ru',reason:'context_faq',conversation:[{question:'Где проходит регистрация?',answer:'В фойе.'}]},
 ];
 const results=[];
 for(const c of cases){
  const start=performance.now(),requestId=randomUUID();
  const {reason:_expected,...request}=c;
  let result=await api(play,'POST',{requestId,...request,mode:'published_preview'});
  const deadline=Date.now()+60000;
  while(!['completed','failed'].includes(result.status)&&Date.now()<deadline){
   await new Promise(r=>setTimeout(r,75));result=await api(play+'/'+requestId);
  }
  const ms=Math.round(performance.now()-start),d=result.decision;
  const passed=result.status==='completed'&&d?.outcome==='approved_faq'&&d.reasonCode===c.reason
   &&d.language===c.language&&d.answer.includes('09:00')&&d.sources.length>0&&d.usage.paidOperations===0
   &&d.steps[0]?.stage!=='answer_cache';
  results.push({question:c.question,ms,passed,result});
 }
 const passed=results.every(r=>r.passed);
 await writeFile('output/pdf/faq-fix-http.json',JSON.stringify({passed,results},null,2));
 console.log(JSON.stringify({passed,cases:results.map(r=>({q:r.question,ms:r.ms,passed:r.passed,reason:r.result.decision?.reasonCode,calls:r.result.decision?.usage.paidOperations}))}));
 if(!passed)process.exitCode=1;
}finally{
 // This source was created only by this check, in the authenticated demo workspace.
 if(fixture)await api(root+'/sources/'+fixture.id,'DELETE');
}
