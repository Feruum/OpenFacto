import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';
import { createDatabase, encryptBotToken } from '@openfacto/database';
import { createRabbitTransport, queueNames, AI_QUESTIONS_QUEUE } from '@openfacto/queue';
import { businessWorkers } from '../dist/business.js';

// The queue package owns the AMQP client dependency; use it only for test cleanup.
const amqp = createRequire(import.meta.resolve('@openfacto/queue'))('amqplib');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  const deadline = Date.now()+15000;
  while(Date.now()<deadline) { const result = await check(); if(result) return result; await delay(50); }
  assert.fail('Shared worker did not complete its durable jobs');
}

test('SQL recovery runs Telegram and Playground on one broker consumer, fences duplicates and expires exhausted jobs', {timeout:30000}, async () => {
  assert.ok(process.env.DATABASE_URL); assert.ok(process.env.RABBITMQ_URL);
  const database = createDatabase(process.env.DATABASE_URL), sql = database.client;
  const org=randomUUID(),event=randomUUID(),actor=randomUUID(),bot=randomUUID(),source=randomUUID(),version=randomUUID();
  const inbox=randomUUID(),playground=randomUUID(),trace=randomUUID(),recovered=randomUUID(),recoveredTrace=randomUUID(),exhausted=randomUUID();
  const prefix='worker-test-'+randomUUID()+'.';
  const oldKey=process.env.BOT_ENCRYPTION_KEY, oldFetch=globalThis.fetch;
  const aiSettings={AI_CHAT_ENDPOINT:'https://fixture.invalid/language',AI_CHAT_MODEL:'fixture',AI_PLATFORM_KEY:'synthetic',AI_PLATFORM_DAILY_MICROS:'1000000000',AI_INPUT_MICROS_PER_1K:'1',AI_OUTPUT_MICROS_PER_1K:'1'};
  const savedAi=new Map(Object.keys(aiSettings).map(k=>[k,process.env[k]]));
  const key=Buffer.alloc(32,9).toString('base64');
  const transport=createRabbitTransport({url:process.env.RABBITMQ_URL,queuePrefix:prefix,shutdownTimeoutMs:1000});
  let failures=0, sends=0;
  const workers=businessWorkers(transport,process.env.DATABASE_URL,2,()=>failures++);
  let cleanupConnection;
  try {
    process.env.BOT_ENCRYPTION_KEY=key;
    Object.assign(process.env,aiSettings);
    globalThis.fetch=async (url,options)=> {
      if(String(url)==='https://fixture.invalid/language') return Response.json({usage:{prompt_tokens:10,completion_tokens:10},choices:[{finish_reason:'stop',message:{content:JSON.stringify({queries:['Where?'],responseLanguage:'en'})}}]});
      if(String(url).startsWith('https://api.telegram.org/')) { sends++; return Response.json({ok:true}); }
      return oldFetch(url,options);
    };
    await sql`INSERT INTO organizations(id,name) VALUES(${org},'Shared queue fixture')`;
    await sql`INSERT INTO users(id,telegram_id,display_name) VALUES(${actor},${String(Date.now())},'Queue actor')`;
    await sql`INSERT INTO memberships(organization_id,user_id,role) VALUES(${org},${actor},'owner')`;
    await sql`INSERT INTO events(id,organization_id,name,status) VALUES(${event},${org},'Queue fixture','active')`;
    await sql`INSERT INTO telegram_bots(id,organization_id,event_id,name,telegram_bot_id,username,token_ciphertext,webhook_secret_hash)
      VALUES(${bot},${org},${event},'queue bot',${bot},'queue_fixture',${encryptBotToken('fixture-token',key,bot)},'fixture')`;
    await sql`INSERT INTO knowledge_sources(id,organization_id,event_id,kind,title,body,language)
      VALUES(${source},${org},${event},'faq','Where?','Main hall','en')`;
    await sql`INSERT INTO source_versions(id,organization_id,event_id,source_id,number,title,body,language,visibility,aliases)
      VALUES(${version},${org},${event},${source},1,'Where?','Main hall','en','participant','{}')`;
    await sql`UPDATE knowledge_sources SET published_version_id=${version} WHERE id=${source}`;
    await sql`INSERT INTO telegram_inbox(id,organization_id,event_id,bot_id,update_id,payload)
      VALUES(${inbox},${org},${event},${bot},'1',${sql.json({message:{chat:{id:123,type:'private'},from:{id:123,language_code:'en'},text:'Where?'}})})`;
    const input={organizationId:org,eventId:event,question:'Where?',language:'en',mode:'published_preview',
      activated:true,handoffEnabled:true,faqOnly:false};
    for (const [id,traceId,status,attempts] of [[playground,trace,'pending',0],[recovered,recoveredTrace,'running',1],[exhausted,randomUUID(),'running',3]]) {
      await sql`INSERT INTO playground_requests(id,organization_id,event_id,actor_id,fingerprint,trace_id,input,status,attempts,available_at)
        VALUES(${id},${org},${event},${actor},'fixture',${traceId},${sql.json(input)},${status},${attempts},now()-interval '1 minute')`;
    }
    await sql`INSERT INTO queue_dispatches(queue,name,job_id,available_at)
      VALUES('ai.questions','playground',${recovered},now()-interval '1 minute')`;
    await transport.start();
    // Duplicate transport deliveries overlap; SQL claims still produce exactly one result.
    await transport.publish(AI_QUESTIONS_QUEUE,{name:'telegram',data:{id:inbox}});
    await transport.publish(AI_QUESTIONS_QUEUE,{name:'telegram',data:{id:inbox}});
    await transport.publish(AI_QUESTIONS_QUEUE,{name:'playground',data:{id:playground}});
    await transport.publish(AI_QUESTIONS_QUEUE,{name:'playground',data:{id:playground}});
    workers.start();
    await until(async ()=> (await sql`SELECT count(*)::integer AS n FROM answer_runs WHERE organization_id=${org}`)[0].n===3);
    await until(async ()=> (await sql`SELECT status FROM playground_requests WHERE id=${exhausted}`)[0].status==='failed');
    await until(()=>sends===1);
    const results=await sql`SELECT decision FROM answer_runs WHERE organization_id=${org}`;
    assert.ok(results.every(row=>row.decision.answer==='Main hall'));
    const jobs=await sql`SELECT id,status,attempts FROM playground_requests WHERE organization_id=${org}`;
    assert.equal(jobs.find(row=>row.id===playground).attempts,1);
    assert.equal(jobs.find(row=>row.id===recovered).attempts,2);
    assert.equal(jobs.find(row=>row.id===recovered).status,'completed');
    assert.equal((await sql`SELECT attempts,status FROM telegram_inbox WHERE id=${inbox}`)[0].attempts,1);
    assert.equal(failures,0);
  } finally {
    workers.stopSweeps(); await transport.close(); await workers.close();
    globalThis.fetch=oldFetch;
    for(const [k,v] of savedAi) {if(v===undefined) delete process.env[k]; else process.env[k]=v;}
    if(oldKey===undefined) delete process.env.BOT_ENCRYPTION_KEY; else process.env.BOT_ENCRYPTION_KEY=oldKey;
    await sql`DELETE FROM queue_dispatches WHERE job_id IN (${inbox},${playground},${recovered},${exhausted},${version})`;
    await sql`DELETE FROM organizations WHERE id=${org}`;
    await sql`DELETE FROM users WHERE id=${actor}`;
    await database.close();
    try {
      cleanupConnection=await amqp.connect(process.env.RABBITMQ_URL);
      const channel=await cleanupConnection.createChannel();
      for(const name of queueNames) for(const suffix of ['', '.dead']) await channel.deleteQueue(prefix+name+suffix);
    } finally { await cleanupConnection?.close(); }
  }
});

test('notification leases prevent backlog floods, admit later work, and recover failed or expired publications', {timeout:30000}, async () => {
  assert.ok(process.env.DATABASE_URL);
  const database=createDatabase(process.env.DATABASE_URL),sql=database.client;
  const org=randomUUID(),event=randomUUID(),actor=randomUUID();
  const ids=Array.from({length:61},()=>randomUUID());
  const published=[]; let rejectFirst=true,failures=0;
  const transport={consume(){},async publish(queue,job){
    if(queue!==AI_QUESTIONS_QUEUE || !ids.includes(job.data.id)) return;
    if(rejectFirst){rejectFirst=false;throw new Error('broker confirm unavailable');}
    published.push(job.data.id);
  }};
  const workers=businessWorkers(transport,process.env.DATABASE_URL,1,()=>failures++);
  try {
    await sql`INSERT INTO organizations(id,name) VALUES(${org},'Dispatch lease fixture')`;
    await sql`INSERT INTO users(id,telegram_id,display_name) VALUES(${actor},${String(Date.now())},'Dispatch actor')`;
    await sql`INSERT INTO events(id,organization_id,name,status) VALUES(${event},${org},'Dispatch fixture','active')`;
    for(const id of ids) await sql`INSERT INTO playground_requests(id,organization_id,event_id,actor_id,fingerprint,trace_id,input)
      VALUES(${id},${org},${event},${actor},'dispatch',${randomUUID()},'{}'::jsonb)`;
    workers.start();
    await until(()=>failures===1);
    assert.equal((await sql`SELECT job_id FROM queue_dispatches WHERE job_id IN ${sql(ids)}`).length,0,
      'failed publisher confirmation releases the notification lease immediately');
    await until(()=>published.length===61);
    assert.equal(new Set(published).size,61,'queued first batch does not starve newer rows');
    await delay(2200); assert.equal(published.length,61,'repeated sweeps do not duplicate the queued backlog');
    await sql`UPDATE queue_dispatches SET available_at=now()-interval '1 second' WHERE job_id=${ids[0]}`;
    await until(()=>published.length===62);
    assert.equal(published.filter(id=>id===ids[0]).length,2,'lost notification recovers when its lease expires');
  } finally {
    workers.stopSweeps(); await workers.close();
    await sql`DELETE FROM queue_dispatches WHERE job_id IN ${sql(ids)}`;
    await sql`DELETE FROM organizations WHERE id=${org}`;
    await sql`DELETE FROM users WHERE id=${actor}`;
    await database.close();
  }
});
