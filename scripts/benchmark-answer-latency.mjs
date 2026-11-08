import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir,rename} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {cases,evaluate} from './answer-latency-cases.mjs';
import {variants,schedule,summarize,operationCost,sanitizeUsage,verifiedUsageDelta} from './lib/latency-report.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const argv=process.argv.slice(2);
const option=(name,fallback)=>{const i=argv.indexOf('--'+name);return i<0?fallback:argv[i+1];};
const has=name=>argv.includes('--'+name);
const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const json=async file=>JSON.parse(await readFile(file,'utf8'));
const save=async(file,data)=>{
 const temporary=file+'.tmp';
 await writeFile(temporary,JSON.stringify(data,null,2)+'\n');
 await rename(temporary,file);
};
const model='gpt-6-luna';
const seed=Number(option('seed','20261108'));
assert(Number.isSafeInteger(seed)&&seed>=0&&seed<=0xffffffff,'seed must be a uint32');
const plan=schedule(cases,seed);
const out=path.resolve(option('out',path.join(root,'output/latency')));

// Dry run intentionally precedes DB / worker imports and all environment requirements.
if(has('dry-run')) {
 await mkdir(out,{recursive:true});
 await save(path.join(out,'plan.json'),{model,seed,variants,requests:plan.length,schedule:plan,cases});
 await writeFile(path.join(out,'authority-template.json'),JSON.stringify({reviewed:false,reviewer:'',reviewedAt:'',
  note:'Review source authority and every expected fact independently of model verification.',
  cases:Object.fromEntries(cases.map(c=>[c.id,{rationale:c.sourceHint,requiredPatterns:[],references:[]}]))},null,2)+'\n',{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});
 console.log(`Dry run: ${cases.length} cases × 4 variants × 3 repeats = ${plan.length} requests. No network calls.`);
} else if(has('child')) {
 const input=await json(option('child'));
 assert.equal(process.env.AI_CHAT_MODEL,model,'Live model must be gpt-6-luna');
 const {default:postgres}=await import('../apps/worker/node_modules/postgres/src/index.js');
 const {runScopedAnswer}=await import('../apps/worker/dist/answers.js');
 const sql=postgres(process.env.DATABASE_URL,{max:2,onnotice(){}});
 let result;
 try {result={decision:await runScopedAnswer(sql,input)};}
 catch(error){result={error:{name:error.name,message:String(error.message).replace(/(?:sk-\S+|Bearer\s+\S+)/gi,'[redacted]')}};}
 finally {await sql.end({timeout:5});}
 await save(option('result'),result);
} else {
 const organizationId=option('org',process.env.BENCH_ORGANIZATION_ID);
 const eventId=option('event',process.env.BENCH_EVENT_ID);
 assert(organizationId&&eventId,'Explicit --org/--event or BENCH_ORGANIZATION_ID/BENCH_EVENT_ID required');
 assert(process.env.DATABASE_URL,'DATABASE_URL required');
 assert(!process.env.AI_CHAT_MODEL||process.env.AI_CHAT_MODEL===model,'Only gpt-6-luna is allowed; fix AI_CHAT_MODEL first');
 const authorityFile=option('authority');
 assert(authorityFile,'--authority reviewed JSON is required');
 const authority=await json(authorityFile);
 assert(authority.reviewed===true&&authority.reviewer&&authority.reviewedAt,'Explicit independent source authority review required');
 const {default:postgres}=await import('../apps/worker/node_modules/postgres/src/index.js');
 const sql=postgres(process.env.DATABASE_URL,{max:2,onnotice(){}});
 const snapshotFile=path.resolve(option('snapshot',path.join(out,'snapshot.json')));
 async function snapshot(){
  const data=await sql.begin('isolation level repeatable read read only',async tx=>({
   sources:await tx`SELECT * FROM knowledge_sources WHERE organization_id=${organizationId} AND event_id=${eventId} ORDER BY id`,
   versions:await tx`SELECT * FROM source_versions WHERE organization_id=${organizationId} AND event_id=${eventId} ORDER BY id`,
   chunks:await tx`SELECT * FROM source_chunks WHERE organization_id=${organizationId} AND event_id=${eventId} ORDER BY id`,
   budget:await tx`SELECT funding,daily_limit_micros FROM event_ai_settings WHERE organization_id=${organizationId} AND event_id=${eventId}`,
  }));
  assert(data.sources.length,'Empty source corpus');
  const builds=[];
  for(const directory of ['apps/worker/dist','packages/answer-engine/dist','packages/database/dist']){
   const files=(await readdir(path.join(root,directory),{recursive:true})).filter(f=>f.endsWith('.js')).sort();
   for(const file of files)builds.push([directory+'/'+file,hash(await readFile(path.join(root,directory,file),'utf8'))]);
  }
  const config=Object.fromEntries(['AI_CHAT_ENDPOINT','AI_PLATFORM_DAILY_MICROS','EMBEDDING_URL','EMBEDDING_MODEL','EMBEDDING_REVISION','RERANK_URL','RERANK_MODEL','RERANK_REVISION'].map(k=>[k,process.env[k]??null]));
  return {organizationId,eventId,model,cases,authority,config,builds,...data};
 }
 function checkAuthority(data){
  for(const c of cases){
   const entry=authority.cases?.[c.id];
   assert(entry?.rationale?.trim(),`Missing rationale: ${c.id}`);
   assert(Array.isArray(entry.references)&&Array.isArray(entry.requiredPatterns),`Invalid authority: ${c.id}`);
   if(['answer','pdf'].includes(c.kind))assert(entry.references.length&&entry.requiredPatterns.length,`Expected source + independent fullness patterns required: ${c.id}`);
   for(const pattern of entry.requiredPatterns){assert(pattern.length>1,`Empty assertion: ${c.id}`);new RegExp(pattern,'iu');}
   for(const ref of entry.references){
    const source=data.sources.find(s=>s.id===ref.sourceId&&s.published_version_id===ref.versionId);
    const version=data.versions.find(v=>v.id===ref.versionId&&v.source_id===ref.sourceId);
    assert(source&&version?.visibility==='participant',`Unpublished/wrong source: ${c.id}`);
    assert(source.kind!=='document'||version.ingestion_status==='ready',`Document not ready: ${c.id}`);
    const text=ref.page?data.chunks.filter(ch=>ch.version_id===ref.versionId&&ch.page===ref.page).map(ch=>ch.body).join('\n'):version.body;
    assert(ref.quote?.length>=8&&text.includes(ref.quote),`Exact independently reviewed quote missing: ${c.id}`);
   }
  }
 }
 try {
  await mkdir(out,{recursive:true});
  const frozen=await snapshot();checkAuthority(frozen);
  if(has('freeze')) {
   await writeFile(snapshotFile,JSON.stringify({sha256:hash(frozen),data:frozen},null,2)+'\n',{flag:'wx'});
   console.log('Frozen corpus, document versions, histories, authority review, budget settings and compiled code. No model calls.');
  } else {
   assert(has('run'),'Use --dry-run, --freeze or --run');
   const saved=await json(snapshotFile);
   assert.equal(hash(saved.data),saved.sha256,'Snapshot file changed');
   assert.equal(hash(frozen),saved.sha256,'Corpus/history/config/build differs from frozen snapshot');
   assert(option('tariff'),'--tariff preverified JSON required');
   const tariff=await json(option('tariff'));
   assert.equal(tariff.model,model);
   assert(tariff.verified===true&&tariff.verifiedAt&&tariff.source&&tariff.currency==='USD','Tariff must be preverified with date, source and USD currency');
   assert(!/key|secret|token|password/i.test(Object.keys(tariff).join(' ')),'Tariff cannot contain credentials');
   for(const key of ['inputMicrosPer1K','outputMicrosPer1K'])assert(Number.isSafeInteger(tariff[key])&&tariff[key]>=0,`Invalid tariff ${key}`);
   assert(typeof tariff.cachedInputMicrosPer1K==='number'&&Number.isFinite(tariff.cachedInputMicrosPer1K)&&tariff.cachedInputMicrosPer1K>=0,'Invalid cached input tariff');
   assert(tariff.inputMicrosPer1K>0&&tariff.outputMicrosPer1K>0,'Provider requires positive reservation rates');
   const endpoint=new URL(process.env.AI_CHAT_ENDPOINT);
   assert.equal(tariff.endpoint,endpoint.href,'Tariff must cover the configured endpoint');
   const verifyUsage=has('verify-usage');
   if(verifyUsage){
    assert.equal(frozen.budget[0]?.funding??'platform','platform','--verify-usage requires platform funding');
    assert(process.env.AI_PLATFORM_KEY,'Platform key required for --verify-usage');
    assert(endpoint.protocol==='https:'&&!endpoint.username&&!endpoint.password&&!endpoint.search&&!endpoint.hash,'Invalid provider endpoint');
   }
   async function readUsage(){
    if(!verifyUsage)return {data:null,error:'verification_disabled'};
    try {
     const response=await fetch(new URL('/v1/usage',endpoint.origin),{headers:{Authorization:'Bearer '+process.env.AI_PLATFORM_KEY},redirect:'error',signal:AbortSignal.timeout(10000)});
     if(!response.ok)return {data:null,error:'usage_http_'+response.status};
     const data=sanitizeUsage(await response.json());
     return {data,error:data?null:'invalid_usage_counters'};
    }catch{return {data:null,error:'usage_request_failed'};}
   }
   const timeoutMs=Number(option('timeout-ms','240000'));
   assert(Number.isSafeInteger(timeoutMs)&&timeoutMs>=1000,'Invalid timeout');
   const runId=randomUUID(),runDir=path.join(out,runId);await mkdir(runDir);
   const rows=[];
   const metadata={runId,model,seed,variants,verifyUsage,snapshotSha256:saved.sha256,tariff,startedAt:new Date().toISOString(),schedule:plan};
   await save(path.join(runDir,'metadata.json'),metadata);
   const report=async()=>save(path.join(runDir,'report.json'),{...metadata,...summarize(rows,plan.length),rows});
   await report();
   for(const trial of plan){
    assert.equal(hash(await snapshot()),saved.sha256,'Snapshot changed before trial; stop experiment');
    const c=cases.find(c=>c.id===trial.caseId),variant=variants.find(v=>v.id===trial.variant),traceId=randomUUID();
    const input={organizationId,eventId,traceId,mode:'evaluation',activated:true,language:'ru',languageSelection:'auto',faqOnly:false,handoffEnabled:true,question:c.q,conversation:c.conversation??[]};
    const inputFile=path.join(runDir,traceId+'-input.json'),resultFile=path.join(runDir,traceId+'-result.json');
    await save(inputFile,input);
    const env={...process.env,AI_CHAT_MODEL:model,AI_COMPACT_OUTPUT:variant.compact,AI_COMBINED_PLANNING:'1',AI_RESPONSE_CACHE:'0',
     AI_INPUT_MICROS_PER_1K:String(tariff.inputMicrosPer1K),AI_OUTPUT_MICROS_PER_1K:String(tariff.outputMicrosPer1K)};
    delete env.AI_REASONING_EFFORT;if(variant.effort)env.AI_REASONING_EFFORT=variant.effort;
    const usageBefore=await readUsage();
    const started=performance.now();
    const status=await new Promise(resolve=>{
     const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--child',inputFile,'--result',resultFile],{cwd:root,env,stdio:'ignore',windowsHide:true});
     let timedOut=false;
     const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},timeoutMs);
     child.once('error',error=>{clearTimeout(timer);resolve({error:{name:error.name,message:error.message}});});
     child.once('close',(exitCode,signal)=>{clearTimeout(timer);resolve({exitCode,signal,timedOut});});
    });
    const elapsedMs=Math.round(performance.now()-started);
    const usageAfter=await readUsage();
    let result={};try{result=await json(resultFile);}catch{result={error:{name:status.timedOut?'Timeout':'ChildFailure',message:'Child returned no result; consult operation diagnostics'}};}
    const row={...trial,traceId,lang:c.lang,answerExpected:['answer','pdf'].includes(c.kind),...status,...result,elapsedMs,operations:[],costMicros:null,actualCostMicros:null,passed:false};
    if(verifyUsage)row.usageVerification={...verifiedUsageDelta(usageBefore.data,usageAfter.data,null),beforeError:usageBefore.error,afterError:usageAfter.error};
    // Provider keys operations by trace + stage; collect every possible paid stage.
    try {
     const ids=['understand','select','select-expanded','verify'].map(stage=>hash([organizationId,eventId,traceId,stage]));
     row.operations=await sql`SELECT id,status,cost_micros,reserved_micros,result->'diagnostics' AS diagnostics,result->>'failure' AS failure FROM ai_operations WHERE organization_id=${organizationId} AND event_id=${eventId} AND id IN ${sql(ids)} ORDER BY id`;
     if(verifyUsage){
      row.usageVerification={...verifiedUsageDelta(usageBefore.data,usageAfter.data,row.operations.length),beforeError:usageBefore.error,afterError:usageAfter.error};
      row.actualCostMicros=row.usageVerification.actualCostMicros;
     }
     const complete=row.decision&&row.operations.length===row.decision.usage.paidOperations;
     row.costMicros=operationCost(row.operations,tariff,Boolean(complete));
     row.ledgerCostMicros=complete&&row.operations.every(o=>o.status==='settled')?row.operations.reduce((n,o)=>n+Number(o.cost_micros),0):null;
     row.effortRejection=row.operations.some(o=>/^http_4\d\d$/.test(o.failure??''))?{requested:variant.effort,httpFailures:row.operations.map(o=>o.failure).filter(Boolean),interpretation:'HTTP rejection recorded; no fallback. Confirm unsupported effort from provider response/logs.'}:null;
     if(row.decision){row.checks=evaluate(c,row.decision,authority.cases[c.id]);row.passed=Object.values(row.checks).every(Boolean);}
    } catch(error){row.error={name:error.name,message:error.message};}
    let changed=false;
    try {changed=hash(await snapshot())!==saved.sha256;}catch(error){changed=true;row.snapshotError=error.message;}
    if(changed){row.snapshotChanged=true;row.passed=false;}
    rows.push(row);await report();
    console.log(JSON.stringify({recorded:rows.length,planned:plan.length,...trial,passed:row.passed,reason:row.decision?.reasonCode,timedOut:row.timedOut}));
    if(changed)throw new Error('Snapshot changed during trial; recorded and stopped');
    if(row.decision?.reasonCode==='budget_exhausted')break;
   }
   console.log(`Report: ${path.join(runDir,'report.json')}`);
  }
 } finally {await sql.end({timeout:5});}
}
