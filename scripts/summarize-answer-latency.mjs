import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {stats} from './lib/latency-report.mjs';

const ids=['A','B','C','D'];
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const answered=row=>['approved_faq','grounded_answer'].includes(row.decision?.outcome);
const key=row=>`${row.caseId}/${row.repeat}`;
const identify=row=>({caseId:row.caseId,repeat:row.repeat,variant:row.variant,traceId:row.traceId});
const quality=(row,adjusted)=>adjusted?row.adjustedPassed:row.passed===true;
function costs(rows,field){
 const known=rows.map(row=>row[field]).filter(finite),unknown=rows.length-known.length;
 const subtotal=known.reduce((sum,value)=>sum+value,0);
 return {requests:rows.length,knownRequests:known.length,unknownRequests:unknown,knownSubtotalMicros:subtotal,
  totalMicros:unknown?null:subtotal,meanFullRequestMicros:unknown||!rows.length?null:subtotal/rows.length};
}
function tokenStats(operations){
 return Object.fromEntries(['promptTokens','completionTokens','cachedTokens','reasoningTokens'].map(field=>{
  const values=operations.map(op=>op.diagnostics?.[field]);
  return [field,{...stats(values),unknown:values.filter(value=>!finite(value)).length}];
 }));
}
function stageStats(rows){
 const operations=rows.flatMap(row=>row.operations??[]);
 const provider=Object.fromEntries([...new Set(operations.map(op=>op.diagnostics?.stage??'unknown'))].sort().map(stage=>{
  const selected=operations.filter(op=>(op.diagnostics?.stage??'unknown')===stage);
  return [stage,{operations:selected.length,durationMs:stats(selected.map(op=>op.diagnostics?.durationMs)),tokens:tokenStats(selected),
   failures:selected.filter(op=>op.status!=='settled'||op.diagnostics?.parseStatus!=='ok').length}];
 }));
 const steps=rows.flatMap(row=>row.decision?.steps??[]).filter(step=>finite(step.durationMs));
 const engine=Object.fromEntries([...new Set(steps.map(step=>step.stage))].sort().map(stage=>[stage,stats(steps.filter(step=>step.stage===stage).map(step=>step.durationMs))]));
 return {provider,engine,allProviderTokens:tokenStats(operations)};
}
function languageStats(rows){
 return Object.fromEntries(['ru','kk','en'].map(lang=>{
  const selected=rows.filter(row=>row.lang===lang);
  return [lang,{count:selected.length,rawFailures:selected.filter(row=>!row.passed).length,
   adjustedFailures:selected.filter(row=>!row.adjustedPassed).length,
   rawIncompleteAnswers:selected.filter(row=>row.checks?.fullness===false||row.checks?.facts===false||row.checks?.concepts===false).length,
   reviewedIncompleteAnswers:selected.filter(row=>row.review?.classification==='real_incomplete_answer').length,
   refusalOutcomes:selected.filter(row=>['handoff','refuse'].includes(row.decision?.outcome)).length,
   answerableNotAnswered:selected.filter(row=>row.answerExpected&&!answered(row)).length,
   reviewedUnjustifiedRefusals:selected.filter(row=>row.review?.classification==='real_unjustified_refusal').length}];
 }));
}
function providerFailures(rows){
 const failed=rows.flatMap(row=>(row.operations??[]).filter(op=>op.failure||['reserved','uncertain'].includes(op.status)));
 const possibleTimeout=op=>op.failure==='connection'&&finite(op.diagnostics?.durationMs)&&op.diagnostics.durationMs>=39000;
 return {
  providerUnavailableRequests:rows.filter(row=>row.decision?.reasonCode==='provider_unavailable').length,
  operationUncertainRequests:rows.filter(row=>row.decision?.reasonCode==='operation_uncertain').length,
  uncertainLedgerRequests:rows.filter(row=>(row.operations??[]).some(op=>['reserved','uncertain'].includes(op.status))).length,
  providerFailureOperations:{count:failed.length,byFailure:Object.fromEntries([...new Set(failed.map(op=>op.failure??`status:${op.status}`))].sort().map(failure=>
   [failure,failed.filter(op=>(op.failure??`status:${op.status}`)===failure).length]))},
  confirmedProviderTimeoutOperations:failed.filter(op=>op.failure==='timeout').length,
  confirmedProviderTimeoutRequests:rows.filter(row=>(row.operations??[]).some(op=>op.failure==='timeout')).length,
  possibleProviderTimeoutOperations:failed.filter(possibleTimeout).length,
  possibleProviderTimeoutRequests:rows.filter(row=>(row.operations??[]).some(possibleTimeout)).length,
  possibleTimeoutCaveat:'A connection failure lasting at least 39 seconds is a possible timeout near the frozen 40-second provider deadline, not a confirmed timeout. Only failure=timeout is counted as confirmed; child timeouts remain separate.',
  unknownBillingRequests:rows.filter(row=>!finite(row.actualCostMicros)).length,
  unknownLedgerCostRequests:rows.filter(row=>!finite(row.ledgerCostMicros)).length,
  unknownTariffEstimateRequests:rows.filter(row=>!finite(row.costMicros)).length,
 };
}
function variantStats(rows,planned){
 return {recorded:rows.length,planned,rawPassed:rows.filter(row=>row.passed).length,adjustedPassed:rows.filter(row=>row.adjustedPassed).length,
  individuallyReviewed:rows.filter(row=>row.review).length,appliedOverrides:rows.filter(row=>typeof row.review?.passOverride==='boolean').length,
  unreviewedRawFailures:rows.filter(row=>!row.passed&&!row.review).map(identify),
  errors:rows.filter(row=>row.error).length,timeouts:rows.filter(row=>row.timedOut).length,
  ...providerFailures(rows),
  allEngineLatencyMs:stats(rows.map(row=>row.decision?.durationMs)),
  rawUsefulAnswerLatencyMs:stats(rows.filter(row=>row.passed&&row.answerExpected&&answered(row)).map(row=>row.decision?.durationMs)),
  adjustedUsefulAnswerLatencyMs:stats(rows.filter(row=>row.adjustedPassed&&row.answerExpected&&answered(row)).map(row=>row.decision?.durationMs)),
  actualCost:costs(rows,'actualCostMicros'),tariffEstimate:costs(rows,'costMicros'),ledgerCost:costs(rows,'ledgerCostMicros'),
  languages:languageStats(rows),stages:stageStats(rows)};
}
function pairedLatency(pairs){
 const measured=pairs.filter(([a,b])=>finite(a.decision?.durationMs)&&finite(b.decision?.durationMs));
 const baseline=stats(measured.map(([a])=>a.decision.durationMs)),candidate=stats(measured.map(([,b])=>b.decision.durationMs));
 const reduction=(a,b)=>finite(a)&&a>0&&finite(b)?(a-b)/a*100:null;
 return {eligiblePairs:pairs.length,measuredPairs:measured.length,missingDurationPairs:pairs.length-measured.length,baseline,candidate,
  p50ReductionPercent:reduction(baseline.p50,candidate.p50),p95ReductionPercent:reduction(baseline.p95,candidate.p95),
  meanReductionPercent:reduction(baseline.mean,candidate.mean),
  pairedDifferenceMs:stats(measured.map(([a,b])=>b.decision.durationMs-a.decision.durationMs))};
}
function comparison(rows,baseline,candidate){
 const before=new Map(rows.filter(row=>row.variant===baseline).map(row=>[key(row),row]));
 const after=rows.filter(row=>row.variant===candidate);
 const pairs=after.filter(row=>before.has(key(row))).map(row=>[before.get(key(row)),row]);
 const changes=adjusted=>({
  newQualityFailures:pairs.filter(([a,b])=>quality(a,adjusted)&&!quality(b,adjusted)).map(([a,b])=>({baseline:identify(a),candidate:identify(b),review:b.review??null,checks:b.checks??null})),
  qualityImprovements:pairs.filter(([a,b])=>!quality(a,adjusted)&&quality(b,adjusted)).map(([a,b])=>({baseline:identify(a),candidate:identify(b)})),
  sharedFailures:pairs.filter(([a,b])=>!quality(a,adjusted)&&!quality(b,adjusted)).length,
  matchedCorrectAnswerLatencyMs:pairedLatency(pairs.filter(([a,b])=>a.answerExpected&&b.answerExpected&&answered(a)&&answered(b)&&quality(a,adjusted)&&quality(b,adjusted))),
 });
 return {baseline,candidate,matchedPairs:pairs.length,unmatchedBaseline:before.size-pairs.length,unmatchedCandidate:after.length-pairs.length,
  allMatchedEngineLatencyMs:pairedLatency(pairs),raw:changes(false),independentlyAdjusted:changes(true)};
}
export function summarizeBrowser(documents=[]){
 const records=documents.flatMap(({name,data})=>(data.results??[]).map(row=>({...row,variant:data.variant,repeat:data.repeat,file:name,caseSetSha256:data.caseSetSha256??null})));
 return {files:documents.map(({name,data})=>({name,status:data.status,variant:data.variant,repeat:data.repeat,errors:data.errors??[]})),
  note:'Separate live browser case set; labels alone do not verify provider settings. Queue is reported only from explicit delivery metadata. No quality overrides or synthetic timings are merged into this set.',
  variants:Object.fromEntries(ids.map(variant=>{
   const rows=records.filter(row=>row.variant===variant),requests=rows.flatMap(row=>row.requests??[]);
   return [variant,{count:rows.length,completed:rows.filter(row=>row.status==='completed').length,errors:rows.flatMap(row=>row.errors??[]),
    sendToRenderMs:stats(rows.map(row=>row.performance?.sendToRenderMs)),engineMs:stats(rows.map(row=>row.decision?.durationMs)),
    getCount:stats(rows.map(row=>row.getCount)),getRoundTripMs:stats(requests.filter(request=>request.method==='GET').map(request=>request.durationMs)),
    queueWaitMs:stats(rows.map(row=>row.decision?.delivery?.queueWaitMs)),workerDurationMs:stats(rows.map(row=>row.decision?.delivery?.workerDurationMs)),
    combinedOverheadMs:stats(rows.map(row=>row.delivery?.sendToRenderMinusEngineMs)),
    actualCost:costs(rows,'actualCostMicros'),decisionLedgerCost:costs(rows.map(row=>({cost:row.decision?.usage?.costMicros})),'cost')}];
  })),records};
}
export function summarizeReport(report,manualReview=null,browserDocuments=[]){
 assert(Array.isArray(report.rows),'Report rows are required');
 if(manualReview)assert.equal(manualReview.runId,report.runId,'Manual review belongs to another run');
 const reviews=new Map((manualReview?.reviews??[]).map(review=>[review.traceId,review]));
 const seen=new Set();
 const rows=report.rows.map(row=>{
  assert(ids.includes(row.variant),'Unknown variant');
  const trial=row.variant+'/'+key(row);assert(!seen.has(trial),'Duplicate trial: '+trial);seen.add(trial);
  const review=reviews.get(row.traceId);
  if(review){
   assert.equal(review.caseId,row.caseId,'Review case mismatch');assert.equal(review.variant,row.variant,'Review variant mismatch');
   if(typeof review.rawPassed==='boolean')assert.equal(review.rawPassed,row.passed,'Review raw result mismatch');
  }
  return {...row,review:review??null,adjustedPassed:typeof review?.passOverride==='boolean'?review.passOverride:row.passed===true};
 }).sort((a,b)=>a.caseId.localeCompare(b.caseId,'en')||a.repeat-b.repeat||a.variant.localeCompare(b.variant,'en'));
 const planned=report.schedule?.length??report.planned;
 const complete=Number.isSafeInteger(planned)&&rows.length===planned&&report.complete===true;
 return {schemaVersion:1,runId:report.runId,model:report.model,seed:report.seed,snapshotSha256:report.snapshotSha256,
  complete,planned,recorded:rows.length,winner:null,
  measurement:'Engine-only comparison; request process startup, browser delivery and Telegram delivery are not included in engine duration.',
  twentyPercentCriterion:{judgment:null,reason:'A 20% end-to-end improvement cannot be established from engine-only latency. Browser samples are reported separately; quality, comparable scope and sample completeness require review.'},
  review:{reviewer:manualReview?.reviewer??null,reviewedAt:manualReview?.reviewedAt??null,reviewedThroughRecordedCount:manualReview?.reviewedThroughRecordedCount??null,
   note:'Independent coding-agent source review, not human labeling. Explicit overrides are separate from frozen raw quality; unreviewed rows retain their raw results.',
   unmatchedReviewTraceIds:[...reviews.keys()].filter(traceId=>!rows.some(row=>row.traceId===traceId)).sort()},
  variants:Object.fromEntries(ids.map(variant=>[variant,variantStats(rows.filter(row=>row.variant===variant),report.schedule?.filter(row=>row.variant===variant).length??null)])),
  providerFailures:providerFailures(rows),
  comparisons:Object.fromEntries([['A','B'],['B','C'],['B','D']].map(([a,b])=>[`${a}_to_${b}`,comparison(rows,a,b)])),
  browser:summarizeBrowser(browserDocuments),
  auditRows:rows.map(row=>({...identify(row),lang:row.lang,rawPassed:row.passed===true,adjustedPassed:row.adjustedPassed,review:row.review,
   outcome:row.decision?.outcome??null,reasonCode:row.decision?.reasonCode??null,checks:row.checks??null,error:row.error??null,
   timedOut:row.timedOut??false,snapshotChanged:row.snapshotChanged??false,snapshotError:row.snapshotError??null,
   effortRejection:row.effortRejection??null,actualCostMicros:row.actualCostMicros??null,costMicros:row.costMicros??null,
   usageVerification:row.usageVerification??null,operationFailures:(row.operations??[]).filter(op=>op.failure||op.status!=='settled'||op.diagnostics?.parseStatus!=='ok')}))};
}
const number=value=>finite(value)?Number(value.toFixed(3)).toString():'—';
export function renderMarkdown(summary){
 const lines=['# Answer latency experiment', '',`Run: ${summary.runId}. Recorded ${summary.recorded}/${summary.planned}; ${summary.complete?'complete':'incomplete — provisional'}. No winner selected.`,
  '',summary.measurement,'',summary.review.note,'',summary.twentyPercentCriterion.reason,'',
  '| Variant | Recorded/planned | Raw pass | Adjusted pass | Reviewed | Engine p50/p95 ms | Correct-answer p50/p95 ms (adjusted) | Actual known subtotal μUSD | Unknown costs | Mean full-request μUSD |',
  '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|'];
 for(const id of ids){const v=summary.variants[id];lines.push(`| ${id} | ${v.recorded}/${v.planned??'—'} | ${v.rawPassed} | ${v.adjustedPassed} | ${v.individuallyReviewed} | ${number(v.allEngineLatencyMs.p50)}/${number(v.allEngineLatencyMs.p95)} | ${number(v.adjustedUsefulAnswerLatencyMs.p50)}/${number(v.adjustedUsefulAnswerLatencyMs.p95)} | ${number(v.actualCost.knownSubtotalMicros)} | ${v.actualCost.unknownRequests} | ${number(v.actualCost.meanFullRequestMicros)} |`);}
 lines.push('','Actual known subtotals exclude unknown charges; they are not complete totals. Tariff estimates and rounded ledger costs are separate in JSON. Percentiles use nearest rank. Useful-answer samples exclude refusals and incomplete/incorrect answers.','',
  '## Failures and unknown billing','',
  'Child errors/timeouts and provider failures are separate. A provider failure can produce a normal engine fallback with no child error. Operation-uncertain requests count that explicit engine reason; uncertain-ledger requests count reserved/uncertain operations.',
  '',summary.providerFailures.possibleTimeoutCaveat,'',
  '| Variant | Child errors/timeouts | Provider unavailable | Operation uncertain | Uncertain ledger requests | Provider failure operations | Confirmed/possible provider timeout requests | Unknown actual charges |',
  '|---|---:|---:|---:|---:|---:|---:|---:|');
 for(const id of ids){const v=summary.variants[id];lines.push(`| ${id} | ${v.errors}/${v.timeouts} | ${v.providerUnavailableRequests} | ${v.operationUncertainRequests} | ${v.uncertainLedgerRequests} | ${v.providerFailureOperations.count} | ${v.confirmedProviderTimeoutRequests}/${v.possibleProviderTimeoutRequests} | ${v.unknownBillingRequests} |`);}
 lines.push('','Provider failure strings: '+JSON.stringify(summary.providerFailures.providerFailureOperations.byFailure)+'.','',
  '## Language quality','', '| Variant/language | Cases | Raw failures | Adjusted failures | Refusal outcomes | Answerable not answered | Reviewed unjustified refusals |','|---|---:|---:|---:|---:|---:|---:|');
 for(const id of ids)for(const [lang,v] of Object.entries(summary.variants[id].languages))lines.push(`| ${id}/${lang} | ${v.count} | ${v.rawFailures} | ${v.adjustedFailures} | ${v.refusalOutcomes} | ${v.answerableNotAnswered} | ${v.reviewedUnjustifiedRefusals} |`);
 lines.push('','## Paired engine comparisons','','Pairs share caseId and repeat. Correct-answer comparisons use the intersection of correct answerable results, separately for raw and adjusted quality. Positive reduction means faster; this is not an end-to-end acceptance decision.','',
  '| Comparison | Matched | All p50 reduction % | Raw correct pairs / p50 reduction % | Adjusted correct pairs / p50 reduction % | New raw/adjusted failures |','|---|---:|---:|---:|---:|---:|');
 for(const [name,c] of Object.entries(summary.comparisons)){const raw=c.raw.matchedCorrectAnswerLatencyMs,adjusted=c.independentlyAdjusted.matchedCorrectAnswerLatencyMs;lines.push(`| ${name} | ${c.matchedPairs} | ${number(c.allMatchedEngineLatencyMs.p50ReductionPercent)} | ${raw.measuredPairs} / ${number(raw.p50ReductionPercent)} | ${adjusted.measuredPairs} / ${number(adjusted.p50ReductionPercent)} | ${c.raw.newQualityFailures.length}/${c.independentlyAdjusted.newQualityFailures.length} |`);}
 lines.push('','New adjusted quality failures:');
 for(const [name,c] of Object.entries(summary.comparisons))for(const f of c.independentlyAdjusted.newQualityFailures)lines.push(`- ${name}: ${f.candidate.caseId}, repeat ${f.candidate.repeat}, trace ${f.candidate.traceId}${f.review?`, ${f.review.classification}`:''}.`);
 lines.push('','## Provider stages','','Tokens are per operation; missing diagnostics remain unknown. Engine stage timings, including retrieval and reranking, are retained in JSON.','',
  '| Variant/stage | Operations | Failure operations | Duration p50/p95 ms | Prompt mean | Completion mean | Cached mean (unknown) | Reasoning mean (unknown) |','|---|---:|---:|---:|---:|---:|---:|---:|');
 for(const id of ids)for(const [stage,s] of Object.entries(summary.variants[id].stages.provider))lines.push(`| ${id}/${stage} | ${s.operations} | ${s.failures} | ${number(s.durationMs.p50)}/${number(s.durationMs.p95)} | ${number(s.tokens.promptTokens.mean)} | ${number(s.tokens.completionTokens.mean)} | ${number(s.tokens.cachedTokens.mean)} (${s.tokens.cachedTokens.unknown}) | ${number(s.tokens.reasoningTokens.mean)} (${s.tokens.reasoningTokens.unknown}) |`);
 lines.push('','## Browser observations','',summary.browser.note,'',`Files: ${summary.browser.files.length}.`);
 if(summary.browser.files.length){
  lines.push('','| Variant | Cases | Send-to-render p50/p95 ms | GET count mean | Queue p50 ms | Actual known subtotal μUSD / unknown |','|---|---:|---:|---:|---:|---:|');
  for(const id of ids){const b=summary.browser.variants[id];lines.push(`| ${id} | ${b.count} | ${number(b.sendToRenderMs.p50)}/${number(b.sendToRenderMs.p95)} | ${number(b.getCount.mean)} | ${number(b.queueWaitMs.p50)} | ${number(b.actualCost.knownSubtotalMicros)} / ${b.actualCost.unknownRequests} |`);}
 }
 lines.push('','Errors, timeouts, unresolved provider operations, raw checks and review rationale are preserved in the JSON audit rows. Unreviewed failures and missing measurements remain in their denominators.','');
 return lines.join('\n');
}

async function main(){
 const args=process.argv.slice(2),option=(name,fallback)=>{const i=args.indexOf('--'+name);return i<0?fallback:args[i+1];};
 assert(option('report'),'Usage: node scripts/summarize-answer-latency.mjs --report <report.json> [--review <manual-review.json>] [--browser-dir <directory>] [--out <summary stem>]');
 const reportFile=path.resolve(option('report')),directory=path.resolve(option('browser-dir','output/latency'));
 const reviewFile=path.resolve(option('review','output/latency/manual-review.json'));
 const reportText=await readFile(reportFile,'utf8');
 let review=null;try{review=JSON.parse(await readFile(reviewFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 let names=[];try{names=(await readdir(directory)).filter(name=>/^live-browser-.*\.json$/.test(name)).sort();}catch(error){if(error.code!=='ENOENT')throw error;}
 const browser=[];for(const name of names)browser.push({name,data:JSON.parse(await readFile(path.join(directory,name),'utf8'))});
 const summary=summarizeReport(JSON.parse(reportText),review,browser);
 summary.inputs={report:reportFile,reportSha256:createHash('sha256').update(reportText).digest('hex'),review:review?reviewFile:null,browserDirectory:directory};
 const stem=path.resolve(option('out','output/latency/final-summary'));
 assert(![reportFile,reviewFile].includes(stem+'.json'),'Output must not overwrite an input');
 await mkdir(path.dirname(stem),{recursive:true});
 await writeFile(stem+'.json',JSON.stringify(summary,null,2)+'\n');
 await writeFile(stem+'.md',renderMarkdown(summary));
 console.log(`Summary: ${stem}.json and ${stem}.md (${summary.recorded}/${summary.planned}; no winner selected)`);
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)await main();
