import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeReport,renderMarkdown} from '../summarize-answer-latency.mjs';

const row=(variant,caseId,repeat,passed,ms,extra={})=>({variant,caseId,repeat,traceId:`${variant}-${caseId}-${repeat}`,lang:'en',passed,answerExpected:true,
 actualCostMicros:2,costMicros:null,ledgerCostMicros:3,decision:{outcome:'grounded_answer',durationMs:ms,steps:[]},operations:[],...extra});
const report=rows=>({runId:'run',model:'gpt-6-luna',seed:42,complete:false,planned:12,rows});
test('unknown full-request cost stays null; known subtotal does not become a full-request mean',()=>{
 const summary=summarizeReport(report([row('A','c1',1,true,100),row('A','c2',1,false,200,{actualCostMicros:null})]));
 const cost=summary.variants.A.actualCost;
 assert.equal(cost.knownSubtotalMicros,2);assert.equal(cost.unknownRequests,1);
 assert.equal(cost.totalMicros,null);assert.equal(cost.meanFullRequestMicros,null);
 assert.equal(summary.winner,null);assert.equal(summary.twentyPercentCriterion.judgment,null);
 assert.equal(summary.complete,false);
});
test('coding-agent overrides remain separate and pairing uses case plus repeat',()=>{
 const data=report([
  row('A','c1',1,true,100),row('B','c1',1,false,50),
  row('A','c2',1,true,200),row('B','c2',2,true,10),
  row('B','c3',1,true,60),row('C','c3',1,false,30),
 ]);
 const manual={runId:'run',reviewer:'Independent coding agent',reviews:[{traceId:'B-c1-1',caseId:'c1',variant:'B',rawPassed:false,passOverride:true,classification:'evaluator_false_negative'}]};
 const result=summarizeReport(data,manual);
 assert.equal(result.variants.B.rawPassed,2);assert.equal(result.variants.B.adjustedPassed,3);
 assert.equal(result.variants.B.languages.en.rawFailures,1);assert.equal(result.variants.B.languages.en.adjustedFailures,0);
 const pair=result.comparisons.A_to_B;
 assert.equal(pair.matchedPairs,1);assert.equal(pair.unmatchedBaseline,1);assert.equal(pair.unmatchedCandidate,2);
 assert.equal(pair.raw.newQualityFailures.length,1);assert.equal(pair.independentlyAdjusted.newQualityFailures.length,0);
 assert.equal(pair.raw.matchedCorrectAnswerLatencyMs.measuredPairs,0);
 assert.equal(pair.independentlyAdjusted.matchedCorrectAnswerLatencyMs.p50ReductionPercent,50);
 assert.equal(result.comparisons.B_to_C.independentlyAdjusted.newQualityFailures.length,1);
});
test('errors and refusal outcomes survive; all latency and useful-answer intersections differ',()=>{
 const error={name:'Timeout',message:'Preserve this failure'};
 const result=summarizeReport(report([
  row('A','c1',1,true,100),row('B','c1',1,false,5,{decision:{outcome:'handoff',durationMs:5}}),
  row('A','c2',1,true,200),row('B','c2',1,false,null,{decision:undefined,error,timedOut:true,actualCostMicros:null}),
 ]));
 assert.equal(result.comparisons.A_to_B.matchedPairs,2);
 assert.equal(result.comparisons.A_to_B.allMatchedEngineLatencyMs.measuredPairs,1);
 assert.equal(result.comparisons.A_to_B.allMatchedEngineLatencyMs.missingDurationPairs,1);
 assert.equal(result.comparisons.A_to_B.raw.matchedCorrectAnswerLatencyMs.measuredPairs,0);
 assert.equal(result.variants.B.languages.en.refusalOutcomes,1);
 assert.equal(result.variants.B.languages.en.answerableNotAnswered,2);
 assert.deepEqual(result.auditRows.find(item=>item.traceId==='B-c2-1').error,error);
 assert.equal(result.variants.B.errors,1);assert.equal(result.variants.B.timeouts,1);
});
test('stage diagnostics preserve absent cached tokens and uncertain operation failure',()=>{
 const result=summarizeReport(report([row('A','c1',1,false,100,{operations:[
  {status:'settled',diagnostics:{stage:'select',durationMs:80,parseStatus:'ok',promptTokens:100,completionTokens:20,cachedTokens:null,reasoningTokens:5}},
  {status:'uncertain',failure:'http_502',diagnostics:{stage:'verify',durationMs:5,parseStatus:null}},
 ]})]));
 assert.equal(result.variants.A.stages.provider.select.tokens.cachedTokens.unknown,1);
 assert.equal(result.variants.A.stages.provider.select.tokens.cachedTokens.mean,null);
 assert.equal(result.variants.A.stages.provider.verify.failures,1);
 assert.equal(result.auditRows[0].operationFailures[0].failure,'http_502');
});
test('provider fallbacks and uncertain billing are visible without a child error or timeout',()=>{
 const result=summarizeReport(report([
  row('C','c25',1,false,41000,{timedOut:false,actualCostMicros:null,ledgerCostMicros:null,decision:{outcome:'handoff',reasonCode:'provider_unavailable',durationMs:41000},
   operations:[{status:'uncertain',failure:'connection',diagnostics:{stage:'verify',durationMs:40006}}]}),
  row('C','c26',1,false,10,{actualCostMicros:null,ledgerCostMicros:null,decision:{outcome:'handoff',reasonCode:'operation_uncertain',durationMs:10},
   operations:[{status:'uncertain',failure:'http_502',diagnostics:{stage:'select',durationMs:2}}]}),
  row('D','c25',1,false,40005,{actualCostMicros:null,ledgerCostMicros:null,decision:{outcome:'handoff',reasonCode:'provider_unavailable',durationMs:40005},
   operations:[{status:'uncertain',failure:'timeout',diagnostics:{stage:'select',durationMs:40000}}]}),
 ]));
 const c=result.variants.C;
 assert.equal(c.errors,0);assert.equal(c.timeouts,0);
 assert.equal(c.providerUnavailableRequests,1);assert.equal(c.operationUncertainRequests,1);
 assert.equal(c.uncertainLedgerRequests,2);assert.equal(c.unknownBillingRequests,2);
 assert.deepEqual(c.providerFailureOperations.byFailure,{connection:1,http_502:1});
 assert.equal(c.confirmedProviderTimeoutRequests,0);assert.equal(c.possibleProviderTimeoutRequests,1);
 assert.equal(result.variants.D.confirmedProviderTimeoutOperations,1);assert.equal(result.variants.D.possibleProviderTimeoutOperations,0);
 assert.equal(result.providerFailures.providerUnavailableRequests,2);
 assert.match(renderMarkdown(result),/not a confirmed timeout/);
 assert.match(renderMarkdown(result),/Provider unavailable/);
});
test('browser metrics remain separate, queue requires explicit metadata, and errors are kept',()=>{
 const browser=[{name:'live-browser-A-1.json',data:{variant:'A',repeat:1,status:'completed_with_errors',errors:[{message:'file error'}],results:[
  {id:'b1',status:'completed',performance:{sendToRenderMs:1000},getCount:3,requests:[{method:'GET',durationMs:20}],decision:{durationMs:700,usage:{costMicros:5},delivery:{queueWaitMs:100,workerDurationMs:750}},actualCostMicros:4},
  {id:'b2',status:'error',errors:[{message:'UI error'}],decision:{usage:{costMicros:null}}},
 ]}}];
 const result=summarizeReport(report([]),null,browser),a=result.browser.variants.A;
 assert.equal(result.recorded,0);assert.equal(a.count,2);assert.equal(a.sendToRenderMs.count,1);
 assert.equal(a.queueWaitMs.p50,100);assert.equal(a.queueWaitMs.count,1);
 assert.equal(a.getRoundTripMs.mean,20);assert.equal(a.actualCost.unknownRequests,1);
 assert.equal(a.actualCost.totalMicros,null);assert.equal(a.actualCost.knownSubtotalMicros,4);
 assert.equal(result.browser.files[0].errors[0].message,'file error');assert.equal(a.errors[0].message,'UI error');
});
test('summary is deterministic, leaves input untouched, and rejects mismatched or duplicate records',()=>{
 const data=report([row('B','c1',1,true,100),row('A','c1',1,true,200)]),original=JSON.stringify(data);
 const first=summarizeReport(data),second=summarizeReport(data);
 assert.equal(JSON.stringify(first),JSON.stringify(second));assert.equal(renderMarkdown(first),renderMarkdown(second));
 assert.equal(JSON.stringify(data),original);
 assert.match(renderMarkdown(first),/incomplete — provisional/);
 assert.throws(()=>summarizeReport(data,{runId:'wrong',reviews:[]}),/another run/);
 assert.throws(()=>summarizeReport(report([data.rows[0],data.rows[0]])),/Duplicate trial/);
});
