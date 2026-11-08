import{test}from'node:test';import assert from'node:assert/strict';import{randomUUID}from'node:crypto';
import{createDatabase}from'@openfacto/database';import{runScopedAnswer}from'../dist/answers.js';
test('SQL knowledge snapshot invalidates cached answers on an added source, changed context and revocation',async()=>{
 const db=createDatabase(process.env.DATABASE_URL),sql=db.client,org=randomUUID(),event=randomUUID(),source=randomUUID(),version=randomUUID();
 const settings={AI_COMBINED_PLANNING:'1',AI_RESPONSE_CACHE:'1',AI_CHAT_ENDPOINT:'https://fixture.invalid/cache',AI_CHAT_MODEL:'fixture',AI_PLATFORM_KEY:'synthetic',AI_PLATFORM_DAILY_MICROS:'1000000000',AI_INPUT_MICROS_PER_1K:'1',AI_OUTPUT_MICROS_PER_1K:'1'};
 const saved=new Map(Object.keys(settings).map(k=>[k,process.env[k]])),oldFetch=globalThis.fetch;let calls=0;
 try{
  Object.assign(process.env,settings);
  await sql`INSERT INTO organizations(id,name) VALUES(${org},'Answer cache fixture')`;
  await sql`INSERT INTO events(id,organization_id,name) VALUES(${event},${org},'Answer cache fixture')`;
  await sql`INSERT INTO knowledge_sources(id,organization_id,event_id,kind,title,body,language) VALUES(${source},${org},${event},'document','Апелляции','Апелляция принимается до 17:45.','ru')`;
  await sql`INSERT INTO source_versions(id,organization_id,event_id,source_id,number,title,body,language,aliases,visibility) VALUES(${version},${org},${event},${source},1,'Апелляции','Апелляция принимается до 17:45.','ru','{}','participant')`;
  await sql`UPDATE knowledge_sources SET published_version_id=${version} WHERE id=${source}`;
  globalThis.fetch=async(url,opts)=>{
   assert.equal(String(url),settings.AI_CHAT_ENDPOINT);calls++;
   const body=JSON.parse(opts.body),p=JSON.parse(body.messages[1].content);
   const index=p.candidates?.findIndex(c=>c.text.includes('17:45'));
   const result=p.claims?{supported:true}:index>=0?{kind:'document',responseLanguage:'ru',claims:[{index,quote:p.candidates[index].text,statement:'До 17:45.'}]}:{kind:'insufficient',responseLanguage:'ru'};
   return Response.json({usage:{prompt_tokens:10,completion_tokens:10},choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}]});
  };
  const input={organizationId:org,eventId:event,question:'До какого времени принимается апелляция?',language:'ru',languageSelection:'auto',mode:'published_preview',activated:true,handoffEnabled:true,faqOnly:false};
  const answer=extra=>runScopedAnswer(sql,{...input,traceId:randomUUID(),...extra});
  const first=await answer();assert.equal(first.answer,'До 17:45.');assert.equal(calls,2);
  const warm=await answer();assert.equal(warm.answer,first.answer);assert.equal(warm.steps[0].stage,'answer_cache');assert.equal(calls,2);assert.notEqual(warm.traceId,first.traceId);
  const history=[{question:'Уточните условия',answer:'Речь об апелляции.'}];
  await answer({conversation:history});assert.equal(calls,4);
  const [persisted]=await sql`SELECT ${sql.json(history)}::jsonb AS conversation`;
  const reordered=await answer({conversation:persisted.conversation});
  assert.equal(reordered.usage.paidOperations,0);assert.equal(calls,4,'identical full history after jsonb ordering reuses the verified answer');
  await answer({conversation:[{question:'Уточните условия',answer:'Другое условие.'}]});assert.equal(calls,6,'changed history remains isolated');
  const added=randomUUID(),addedVersion=randomUUID();
  await sql`INSERT INTO knowledge_sources(id,organization_id,event_id,kind,title,body,language) VALUES(${added},${org},${event},'document','Другая публикация','Новый опубликованный источник.','ru')`;
  await sql`INSERT INTO source_versions(id,organization_id,event_id,source_id,number,title,body,language,aliases,visibility) VALUES(${addedVersion},${org},${event},${added},1,'Другая публикация','Новый опубликованный источник.','ru','{}','participant')`;
  await sql`UPDATE knowledge_sources SET published_version_id=${addedVersion} WHERE id=${added}`;
  const concurrent=await Promise.all(Array.from({length:5},()=>answer()));
  assert.equal(calls,8,'new knowledge invalidates the cache, but simultaneous identical requests share one generation');
  assert.equal(new Set(concurrent.map(d=>d.traceId)).size,5);assert.equal(concurrent.filter(d=>d.usage.paidOperations>0).length,1);
  await sql`UPDATE knowledge_sources SET published_version_id=NULL WHERE id=${source}`;
  const revoked=await answer();assert.notEqual(revoked.answer,first.answer);assert.equal(revoked.outcome,'handoff');assert.equal(calls,9);
  const revokedRepeat=await answer({conversation:[{question:input.question,answer:first.answer}]});
  assert.equal(revokedRepeat.outcome,'handoff');assert.notEqual(revokedRepeat.answer,first.answer);assert.equal(calls,10,'revoked sources invalidate context cache entries too');
 }finally{
  globalThis.fetch=oldFetch;for(const[k,v]of saved){if(v===undefined)delete process.env[k];else process.env[k]=v;}
  await sql`DELETE FROM organizations WHERE id=${org}`;await db.close();
 }
});
