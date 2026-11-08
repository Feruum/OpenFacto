import{test}from'node:test';import assert from'node:assert/strict';import{randomUUID}from'node:crypto';
import{createDatabase}from'@openfacto/database';import{providerPorts}from'../dist/provider.js';
test('expanded and repaired selections have separate durable reservations and replay without extra charges',async()=>{
 const db=createDatabase(process.env.DATABASE_URL),sql=db.client,org=randomUUID(),event=randomUUID();
 const settings={AI_COMBINED_PLANNING:'1',AI_THINKING_MODE:'disabled',AI_VERIFY_MODEL:'fixture-verifier',AI_CHAT_ENDPOINT:'https://fixture.invalid/combined',AI_CHAT_MODEL:'fixture',AI_PLATFORM_KEY:'synthetic',AI_PLATFORM_DAILY_MICROS:'1000000000',AI_INPUT_MICROS_PER_1K:'1',AI_OUTPUT_MICROS_PER_1K:'1'};
 const saved=new Map(Object.keys(settings).map(k=>[k,process.env[k]])),oldFetch=globalThis.fetch;let calls=0;
 try{
  Object.assign(process.env,settings);
  await sql`INSERT INTO organizations(id,name) VALUES(${org},'Combined planning fixture')`;
  await sql`INSERT INTO events(id,organization_id,name) VALUES(${event},${org},'Combined planning fixture')`;
  const input={organizationId:org,eventId:event,traceId:randomUUID(),question:'апелляция кашан?',language:'ru',languageSelection:'auto',mode:'evaluation',activated:true,handoffEnabled:true,faqOnly:false,sources:[]};
  globalThis.fetch=async(_url,request)=>{const body=JSON.parse(request.body);assert.deepEqual(body.thinking,{type:'disabled'});const checking=body.messages[0].content.startsWith('Act as an independent evidence checker.');assert.equal(body.model,checking?'fixture-verifier':'fixture');calls++;return Response.json({usage:{prompt_tokens:10,completion_tokens:10},choices:[{finish_reason:'stop',message:{content:JSON.stringify(checking?{supported:true}:{kind:'insufficient',responseLanguage:'kk',searchQueries:['апелляция']})}}]});};
  const ports=providerPorts(sql,input);
  assert.equal(ports.resolveLanguageInAssessment,true);
  await ports.assess(input,[],0);
  const expanded={...input,language:'kk',searchQueries:['апелляция']};
  await ports.assess(expanded,[],1);
  await ports.assess(expanded,[],2);
  await providerPorts(sql,input).assess(input,[],0);
  await providerPorts(sql,input).assess(expanded,[],1);
  await providerPorts(sql,input).assess(expanded,[],2);
  assert.equal(calls,3);
  assert.equal((await sql`SELECT id FROM ai_operations WHERE event_id=${event}`).length,3);
  assert.equal(await ports.verify(input,[]),true);
  assert.equal(await providerPorts(sql,input).verify(input,[]),true);
  assert.equal(calls,4);
  process.env.AI_THINKING_MODE='enabled';
  await assert.rejects(providerPorts(sql,input).assess(input,[],0),/operation_uncertain/);
  process.env.AI_THINKING_MODE='disabled';
  await assert.rejects(providerPorts(sql,input).assess({...expanded,question:'different'},[],1),/operation_uncertain/);
 }finally{
  globalThis.fetch=oldFetch;for(const[k,v]of saved){if(v===undefined)delete process.env[k];else process.env[k]=v;}
  await sql`DELETE FROM organizations WHERE id=${org}`;await db.close();
 }
});
