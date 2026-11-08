export const variants = [
 {id:'A',compact:'0',effort:null}, {id:'B',compact:'1',effort:null},
 {id:'C',compact:'1',effort:'low'}, {id:'D',compact:'1',effort:'none'},
];
export function schedule(cases,seed=20261108){
 let state=seed>>>0;
 const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
 const shuffle=items=>{for(let i=items.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[items[i],items[j]]=[items[j],items[i]];}return items;};
 // Each repeat is a randomized complete block. Every case/variant occurs once.
 return Array.from({length:3},(_,repeat)=>shuffle(cases.flatMap(c=>variants.map(v=>({caseId:c.id,variant:v.id,repeat:repeat+1}))))).flat();
}
export function stats(values){
 const sorted=values.filter(v=>typeof v==='number'&&Number.isFinite(v)).sort((a,b)=>a-b);
 const rank=p=>sorted[Math.ceil(p*sorted.length)-1]??null;
 return {count:sorted.length,p50:rank(.5),p95:rank(.95),mean:sorted.length?sorted.reduce((a,b)=>a+b,0)/sorted.length:null};
}
export function operationCost(operations,tariff,ledgerComplete=true){
 if(!ledgerComplete||operations.some(o=>o.status!=='settled'))return null;
 let total=0;
 for(const op of operations){
  const d=op.diagnostics;
  if(!d||![d.promptTokens,d.completionTokens].every(n=>Number.isSafeInteger(n)&&n>=0))return null;
  const cached=d.cachedTokens;
  if(!Number.isSafeInteger(cached))return null;
  const cache=cached;
  if(cache<0||cache>d.promptTokens)return null;
  total+=((d.promptTokens-cache)*tariff.inputMicrosPer1K+cache*tariff.cachedInputMicrosPer1K+d.completionTokens*tariff.outputMicrosPer1K)/1000;
 }
 return total;
}
const usageFields=['requests','actual_cost','input_tokens','output_tokens','cache_read_tokens'];
export function sanitizeUsage(payload){
 if(!Array.isArray(payload?.model_stats))return null;
 const entries=payload.model_stats.filter(entry=>entry?.model==='gpt-6-luna');
 if(entries.length>1)return null;
 if(!entries.length)return Object.fromEntries(usageFields.map(key=>[key,0]));
 const entry=entries[0];
 if(!usageFields.every(key=>typeof entry[key]==='number'&&Number.isFinite(entry[key])&&entry[key]>=0&&(key==='actual_cost'||Number.isSafeInteger(entry[key]))))return null;
 return Object.fromEntries(usageFields.map(key=>[key,entry[key]]));
}
export function verifiedUsageDelta(before,after,newProviderCalls){
 if(!before||!after)return {delta:null,actualCostMicros:null,reason:'usage_unavailable'};
 const delta=Object.fromEntries(usageFields.map(key=>[key,after[key]-before[key]]));
 if(usageFields.some(key=>!Number.isFinite(delta[key])||delta[key]<0))return {delta,actualCostMicros:null,reason:'usage_counter_reset'};
 if(!Number.isSafeInteger(newProviderCalls)||newProviderCalls<0||delta.requests!==newProviderCalls)
  return {delta,actualCostMicros:null,reason:'request_count_mismatch'};
 if(delta.requests===0&&usageFields.some(key=>delta[key]!==0))return {delta,actualCostMicros:null,reason:'usage_changed_without_requests'};
 return {delta,actualCostMicros:delta.actual_cost*1_000_000,reason:'matched_request_count'};
}
export function summarize(rows,expected){
 function group(list){
  const tokens={};
  for(const key of ['promptTokens','completionTokens','cachedTokens','reasoningTokens']){
   tokens[key]=stats(list.map(r=>{const ops=r.operations??[];return ops.length&&ops.every(o=>typeof o.diagnostics?.[key]==='number')?ops.reduce((n,o)=>n+o.diagnostics[key],0):null;}));
  }
  return {count:list.length,passed:list.filter(r=>r.passed).length,failures:list.filter(r=>!r.passed).length,
   errors:list.filter(r=>r.error).length,timeouts:list.filter(r=>r.timedOut).length,
   incompleteAnswers:list.filter(r=>r.checks?.fullness===false||r.checks?.facts===false||r.checks?.concepts===false).length,
   unjustifiedRefusals:list.filter(r=>r.answerExpected&&r.decision&&!['approved_faq','grounded_answer'].includes(r.decision.outcome)).length,
   engineLatencyMs:stats(list.map(r=>r.decision?.durationMs)),usefulAnswerLatencyMs:stats(list.filter(r=>r.passed&&r.answerExpected).map(r=>r.decision?.durationMs)),
   correctDecisionLatencyMs:stats(list.filter(r=>r.passed).map(r=>r.decision?.durationMs)),
   outcomes:Object.fromEntries([...new Set(list.map(r=>r.decision?.outcome??'error'))].map(outcome=>[outcome,list.filter(r=>(r.decision?.outcome??'error')===outcome).length])),
   reasons:Object.fromEntries([...new Set(list.map(r=>r.decision?.reasonCode??r.error?.name??'unknown'))].map(reason=>[reason,list.filter(r=>(r.decision?.reasonCode??r.error?.name??'unknown')===reason).length])),
   providerStageLatencyMs:Object.fromEntries(['understand','select','select-expanded','verify'].map(stage=>[stage,stats(list.flatMap(r=>(r.operations??[]).filter(o=>o.diagnostics?.stage===stage).map(o=>o.diagnostics.durationMs)))])),
   attemptElapsedMs:stats(list.map(r=>r.elapsedMs)),tokens,
   costMicros:list.every(r=>r.costMicros!==null)?list.reduce((n,r)=>n+r.costMicros,0):null,
   knownCostMicros:list.reduce((n,r)=>n+(r.costMicros??0),0),unknownCostRequests:list.filter(r=>r.costMicros===null).length,
   actualCostMicros:list.every(r=>typeof r.actualCostMicros==='number')?list.reduce((n,r)=>n+r.actualCostMicros,0):null,
   knownActualCostMicros:list.reduce((n,r)=>n+(r.actualCostMicros??0),0),unknownActualCostRequests:list.filter(r=>typeof r.actualCostMicros!=='number').length,
   ledgerCostMicros:list.every(r=>typeof r.ledgerCostMicros==='number')?list.reduce((n,r)=>n+r.ledgerCostMicros,0):null};
 }
 return {complete:rows.length===expected,planned:expected,recorded:rows.length,winner:null,
  measurement:'AnswerEngine duration only; not frontend or Telegram end-to-end latency',
  variants:Object.fromEntries(variants.map(v=>[v.id,{...group(rows.filter(r=>r.variant===v.id)),
   languages:Object.fromEntries(['ru','kk','en'].map(lang=>[lang,group(rows.filter(r=>r.variant===v.id&&r.lang===lang))]))}]))};
}
