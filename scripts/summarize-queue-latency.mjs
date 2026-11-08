import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {stats} from './lib/latency-report.mjs';

const caseIds=['case-01','case-04','case-12','case-15','case-21','case-34','case-37'];
const metricNames=['sendToRenderMs','queueWaitMs','engineMs','workerDurationMs','residualMs','sendToRenderMinusEngineMs','getCount'];
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const trialKey=row=>`${row.id??row.caseId}/${row.repeat}`;
const identity=row=>({arm:row.arm,caseId:row.id??row.caseId,repeat:row.repeat,traceId:row.traceId??null,file:row.file});
function cost(rows,field){
 const values=rows.map(row=>row[field]).filter(finite),known=values.reduce((sum,value)=>sum+value,0),unknown=rows.length-values.length;
 return {requests:rows.length,knownRequests:values.length,unknownRequests:unknown,knownSubtotalMicros:known,
  totalMicros:unknown?null:known,meanFullRequestMicros:unknown||!rows.length?null:known/rows.length};
}
function metrics(row){
 const sendToRenderMs=row.performance?.sendToRenderMs,queueWaitMs=row.decision?.delivery?.queueWaitMs;
 const engineMs=row.decision?.durationMs,workerDurationMs=row.decision?.delivery?.workerDurationMs;
 return {sendToRenderMs,queueWaitMs,engineMs,workerDurationMs,
  residualMs:[sendToRenderMs,queueWaitMs,workerDurationMs].every(finite)?sendToRenderMs-queueWaitMs-workerDurationMs:null,
  sendToRenderMinusEngineMs:[sendToRenderMs,engineMs].every(finite)?sendToRenderMs-engineMs:null,getCount:row.getCount};
}
function runtimeIssues(data,arm){
 const issues=[];
 if(data.runtimeVerification?.verified!==true||!data.runtimeVerification?.runtimeSha256)issues.push('runtime_not_verified');
 if(data.status==='invalid_runtime_change')issues.push('invalid_runtime_change');
 if(data.variant!=='A')issues.push('model_variant_not_A');
 if(data.arm!==(arm==='A'?'A':'queue-enabled'))issues.push('unexpected_arm');
 if(data.immediateDispatch!==(arm==='Q'))issues.push('unexpected_dispatch_setting');
 if(data.expectedModel!=='gpt-6-luna')issues.push('unexpected_model');
 if(data.expectedProviderSettings?.reasoningEffort!==null||data.expectedProviderSettings?.compactOutput!==false||data.expectedProviderSettings?.combinedPlanning!==true)issues.push('unexpected_prompt_or_effort');
 if(![1,2,3].includes(data.repeat))issues.push('unexpected_repeat');
 return issues;
}
function pairedMetrics(pairs){
 return Object.fromEntries(metricNames.map(metric=>{
  const measured=pairs.filter(([a,q])=>finite(a.metrics[metric])&&finite(q.metrics[metric]));
  const a=stats(measured.map(([row])=>row.metrics[metric])),q=stats(measured.map(([,row])=>row.metrics[metric]));
  const reduction=(baseline,candidate)=>finite(baseline)&&baseline>0&&finite(candidate)?(baseline-candidate)/baseline*100:null;
  return [metric,{eligiblePairs:pairs.length,measuredPairs:measured.length,missingPairs:pairs.length-measured.length,A:a,Q:q,
   differenceQMinusA:stats(measured.map(([before,after])=>after.metrics[metric]-before.metrics[metric])),
   p50ReductionPercent:reduction(a.p50,q.p50),p95ReductionPercent:reduction(a.p95,q.p95),meanReductionPercent:reduction(a.mean,q.mean)}];
 }));
}
function summarizeArm(rows){
 const eligible=rows.filter(row=>!row.excludedReasons.length);
 return {recorded:rows.length,planned:21,eligible:eligible.length,excluded:rows.length-eligible.length,
  completed:rows.filter(row=>row.status==='completed').length,
  requestsWithErrors:rows.filter(row=>(row.errors??[]).length||!row.status?.startsWith('completed')).length,
  individuallyReviewed:rows.filter(row=>row.review).length,reviewedPass:rows.filter(row=>row.sourcePassed===true).length,
  reviewedFail:rows.filter(row=>row.sourcePassed===false).length,unreviewed:rows.filter(row=>row.sourcePassed===null).length,
  metrics:Object.fromEntries(metricNames.map(metric=>[metric,{...stats(eligible.map(row=>row.metrics[metric])),missing:eligible.filter(row=>!finite(row.metrics[metric])).length}])),
  negativeResiduals:eligible.filter(row=>finite(row.metrics.residualMs)&&row.metrics.residualMs<0).map(identity),
  getRoundTripMs:stats(eligible.flatMap(row=>(row.requests??[]).filter(request=>request.method==='GET').map(request=>request.durationMs))),
  allRecordedActualCost:cost(rows,'actualCostMicros'),eligibleActualCost:cost(eligible,'actualCostMicros'),allRecordedLedgerCost:cost(rows,'ledgerCostMicros'),
  errors:rows.flatMap(row=>(row.errors??[]).map(error=>({...identity(row),error})))};
}
export function summarizeQueue(documents,review=null){
 const reviewMap=new Map((review?.reviews??[]).map(item=>[item.traceId,item]));
 const files=[],rows=[],seen=new Set();
 for(const document of [...documents].sort((a,b)=>a.name.localeCompare(b.name,'en'))){
  const {data,arm,name}=document;assert(['A','Q'].includes(arm),'Unknown comparison arm');
  const issues=runtimeIssues(data,arm);
  files.push({file:name,arm,repeat:data.repeat,status:data.status,runtimeVerification:data.runtimeVerification??null,
   excludedReasons:issues,errors:data.errors??[],recorded:(data.results??[]).length});
  for(const original of data.results??[]){
   const sourceReview=reviewMap.get(original.traceId),caseId=original.id??original.caseId;
   const recordKey=`${arm}/${caseId}/${data.repeat}`;
   assert(!seen.has(recordKey),'Duplicate arm/case/repeat: '+recordKey);seen.add(recordKey);
   if(sourceReview){
    if(sourceReview.arm)assert.equal(sourceReview.arm,arm,'Review arm mismatch');
    if(sourceReview.caseId)assert.equal(sourceReview.caseId,caseId,'Review case mismatch');
    if(sourceReview.repeat)assert.equal(sourceReview.repeat,data.repeat,'Review repeat mismatch');
   }
   const excludedReasons=[...issues];
   if(!caseIds.includes(caseId))excludedReasons.push('unexpected_case');
   if(![true,'not_applicable_zero_calls'].includes(original.configurationVerified))excludedReasons.push('provider_configuration_not_verified');
   if(original.performance&&(original.performance.requestId!==original.requestId||original.performance.traceId!==original.traceId))excludedReasons.push('measurement_identity_mismatch');
   const sourcePassed=typeof sourceReview?.passOverride==='boolean'?sourceReview.passOverride:typeof sourceReview?.passed==='boolean'?sourceReview.passed:null;
   rows.push({...original,arm,repeat:data.repeat,file:name,excludedReasons,metrics:metrics(original),review:sourceReview??null,sourcePassed,
    scope:{runtimeSha256:data.runtimeVerification?.runtimeSha256,caseSetSha256:data.caseSetSha256,corpusSha256:data.corpus?.snapshotSha256,
     organizationId:data.organizationId,eventId:data.eventId}});
  }
 }
 rows.sort((a,b)=>trialKey(a).localeCompare(trialKey(b),'en')||a.arm.localeCompare(b.arm,'en'));
 const before=new Map(rows.filter(row=>row.arm==='A').map(row=>[trialKey(row),row]));
 const after=new Map(rows.filter(row=>row.arm==='Q').map(row=>[trialKey(row),row]));
 const pairs=[],excludedPairs=[];
 for(const [key,a] of before){
  const q=after.get(key);if(!q)continue;
  const reasons=[...a.excludedReasons.map(reason=>'A:'+reason),...q.excludedReasons.map(reason=>'Q:'+reason)];
  for(const field of Object.keys(a.scope))if(!a.scope[field]||a.scope[field]!==q.scope[field])reasons.push('scope_mismatch:'+field);
  if(a.question!==q.question||a.language!==q.language)reasons.push('question_or_language_mismatch');
  if(reasons.length)excludedPairs.push({A:identity(a),Q:identity(q),reasons});else pairs.push([a,q]);
 }
 const reviewedPairs=pairs.filter(([a,q])=>a.sourcePassed!==null&&q.sourcePassed!==null);
 const correct=pairs.filter(([a,q])=>a.sourcePassed===true&&q.sourcePassed===true);
 const answerable=row=>['answer','pdf'].includes(row.kind)&&['approved_faq','grounded_answer'].includes(row.decision?.outcome);
 const useful=correct.filter(([a,q])=>answerable(a)&&answerable(q));
 const expectedKeys=caseIds.flatMap(id=>[1,2,3].map(repeat=>`${id}/${repeat}`));
 const missing=Object.fromEntries(['A','Q'].map(arm=>[arm,expectedKeys.filter(key=>!(arm==='A'?before:after).has(key))]));
 return {schemaVersion:1,comparison:'A_to_Q',armsMeaning:{A:'Original combined prompt, default effort omitted, immediate dispatch disabled',Q:'Same original prompt/default effort; immediate dispatch enabled'},
  plannedPerArm:21,complete:missing.A.length===0&&missing.Q.length===0&&pairs.length===21&&files.every(file=>['completed','completed_with_errors'].includes(file.status)),
  winner:null,twentyPercentCriterion:{judgment:null,reason:'Observed browser reductions are descriptive, not an automatic 20% acceptance verdict. Confirm completeness, runtime comparability, source quality and delivery-clock limitations.'},
  caveats:['Nearest-rank percentiles are computed independently from actual samples; stage p95 values are never added.',
   'Residual = send-to-render minus queueWait minus workerDuration per request, not a pure network/polling delay. Queue timestamps and process duration clocks have different boundaries; negative residuals are retained.',
   'answerReadyAt/workerDuration precede final result persistence; browser end is after React commit, not confirmed screen paint.',
   'Invalid or unverified runtime rows remain in audit and recorded spending, but are excluded from comparable latency metrics.',
   'Source review is independent coding-agent review unless its provenance explicitly states otherwise; no human labeling is inferred. Unreviewed quality is unknown.'],
  files,missing,arms:Object.fromEntries(['A','Q'].map(arm=>[arm,summarizeArm(rows.filter(row=>row.arm===arm))])),
  pairs:{matchedCaseRepeat:expectedKeys.filter(key=>before.has(key)&&after.has(key)).length,comparable:pairs.length,excluded:excludedPairs,
   actualCost:{A:cost(pairs.map(([a])=>a),'actualCostMicros'),Q:cost(pairs.map(([,q])=>q),'actualCostMicros')},
   ledgerCost:{A:cost(pairs.map(([a])=>a),'ledgerCostMicros'),Q:cost(pairs.map(([,q])=>q),'ledgerCostMicros')},
   allMatched:pairedMetrics(pairs),independentlyReviewedPairs:reviewedPairs.length,correctDecisionIntersection:pairedMetrics(correct),
   usefulCorrectAnswerIntersection:pairedMetrics(useful),
   newReviewedQualityFailures:reviewedPairs.filter(([a,q])=>a.sourcePassed&&!q.sourcePassed).map(([a,q])=>({A:identity(a),Q:identity(q),review:q.review})),
   reviewedQualityImprovements:reviewedPairs.filter(([a,q])=>!a.sourcePassed&&q.sourcePassed).map(([a,q])=>({A:identity(a),Q:identity(q)}))},
  review:{reviewer:review?.reviewer??null,reviewedAt:review?.reviewedAt??null,unmatchedTraceIds:[...reviewMap.keys()].filter(trace=>!rows.some(row=>row.traceId===trace)).sort()},
  auditRows:rows};
}
const number=value=>finite(value)?Number(value.toFixed(3)).toString():'—';
export function queueMarkdown(summary){
 const lines=['# Browser queue and delivery comparison','',`A → Q: ${summary.pairs.comparable}/21 comparable case/repeat pairs. ${summary.complete?'Complete':'Incomplete or invalid — provisional'}. No winner selected.`,
  '',`A: ${summary.armsMeaning.A}. Q: ${summary.armsMeaning.Q}.`,'',summary.twentyPercentCriterion.reason,'',
  '| Metric | Matched samples | A p50/p95 | Q p50/p95 | p50/p95 reduction % |','|---|---:|---:|---:|---:|'];
 for(const metric of metricNames){const m=summary.pairs.allMatched[metric];lines.push(`| ${metric} | ${m.measuredPairs} | ${number(m.A.p50)}/${number(m.A.p95)} | ${number(m.Q.p50)}/${number(m.Q.p95)} | ${number(m.p50ReductionPercent)}/${number(m.p95ReductionPercent)} |`);}
 lines.push('','All timing units are milliseconds; getCount is a request count. Each metric uses only pairs where both measurements exist. Missing durations and errors remain visible below.','',
  '| Arm | Recorded/eligible | Requests with errors | Source reviewed pass/fail/unknown | Actual known subtotal μUSD | Unknown actual costs | Mean full-request cost μUSD |','|---|---:|---:|---:|---:|---:|---:|');
 for(const arm of ['A','Q']){const a=summary.arms[arm],c=a.allRecordedActualCost;lines.push(`| ${arm} | ${a.recorded}/${a.eligible} | ${a.requestsWithErrors} | ${a.reviewedPass}/${a.reviewedFail}/${a.unreviewed} | ${number(c.knownSubtotalMicros)} | ${c.unknownRequests} | ${number(c.meanFullRequestMicros)} |`);}
 const useful=summary.pairs.usefulCorrectAnswerIntersection.sendToRenderMs;
 lines.push('',`Independently reviewed useful-correct-answer intersection: ${useful.measuredPairs} pairs; send-to-render A p50/p95 ${number(useful.A.p50)}/${number(useful.A.p95)} ms, Q ${number(useful.Q.p50)}/${number(useful.Q.p95)} ms.`,
  '',`New reviewed quality failures: ${summary.pairs.newReviewedQualityFailures.length}. Missing A/Q records: ${summary.missing.A.length}/${summary.missing.Q.length}. Excluded matched pairs: ${summary.pairs.excluded.length}.`,
  '', 'Known subtotals include recorded spending from invalid files; eligible-only costs are separate in JSON. Unknown charges are not zero, and a full-request mean is withheld whenever any included charge is unknown.','');
 for(const caveat of summary.caveats)lines.push('- '+caveat);
 lines.push('','Excluded/invalid files:');
 for(const file of summary.files.filter(file=>file.excludedReasons.length))lines.push(`- ${file.file}: ${file.excludedReasons.join(', ')}.`);
 lines.push('','Errors, runtime verification, source-review rationale, excluded-pair reasons and all original sample rows are preserved in the JSON report.','');
 return lines.join('\n');
}
async function main(){
 const args=process.argv.slice(2),option=(name,fallback)=>{const i=args.indexOf('--'+name);return i<0?fallback:args[i+1];};
 const directory=path.resolve(option('dir','output/latency')),queueDirectory=path.resolve(option('queue-dir',path.join(directory,'queue-enabled')));
 const documents=[],missingFiles=[];
 for(const arm of ['A','Q'])for(const repeat of [1,2,3]){
  const filename=path.join(arm==='A'?directory:queueDirectory,`live-browser-A-${repeat}.json`);
  try{documents.push({arm,name:filename,data:JSON.parse(await readFile(filename,'utf8'))});}catch(error){if(error.code!=='ENOENT')throw error;missingFiles.push(filename);}
 }
 const reviewFile=path.resolve(option('review',path.join(directory,'browser-source-review.json')));
 let review=null;try{review=JSON.parse(await readFile(reviewFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 const summary=summarizeQueue(documents,review);summary.missingFiles=missingFiles;
 const stem=path.resolve(option('out',path.join(directory,'queue-comparison')));
 assert(![...documents.map(file=>file.name),reviewFile].includes(stem+'.json'),'Output would overwrite an input');
 await mkdir(path.dirname(stem),{recursive:true});
 await writeFile(stem+'.json',JSON.stringify(summary,null,2)+'\n');await writeFile(stem+'.md',queueMarkdown(summary));
 console.log(`Queue summary: ${summary.pairs.comparable}/21 comparable pairs; ${stem}.{json,md}; no winner selected`);
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)await main();
