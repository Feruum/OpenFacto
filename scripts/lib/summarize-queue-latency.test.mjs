import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeQueue,queueMarkdown} from '../summarize-queue-latency.mjs';

function sample(arm,id='case-01',ms=1000){return {id,question:'Question '+id,language:'en',kind:'pdf',status:'completed',requestId:arm+id,traceId:arm+'trace'+id,
 configurationVerified:true,performance:{sendToRenderMs:ms,requestId:arm+id,traceId:arm+'trace'+id},getCount:4,
 decision:{outcome:'grounded_answer',durationMs:500,delivery:{queueWaitMs:200,workerDurationMs:600}},actualCostMicros:2,ledgerCostMicros:3,errors:[],requests:[]};}
function file(arm,results,repeat=1,extra={}){return {arm,name:`${arm}-${repeat}.json`,data:{variant:'A',arm:arm==='A'?'A':'queue-enabled',repeat,
 immediateDispatch:arm==='Q',expectedModel:'gpt-6-luna',expectedProviderSettings:{reasoningEffort:null,compactOutput:false,combinedPlanning:true},
 runtimeVerification:{verified:true,runtimeSha256:'runtime'},caseSetSha256:'cases',corpus:{snapshotSha256:'corpus'},organizationId:'org',eventId:'event',status:'completed',results,errors:[],...extra}};}
test('matches case AND repeat, computes actual full-path percentiles and per-request residual',()=>{
 const a=sample('A'),q=sample('Q',undefined,800);
 const result=summarizeQueue([file('A',[a]),file('Q',[q]),file('Q',[sample('Q','case-04')],2)]);
 assert.equal(result.pairs.comparable,1);assert.equal(result.pairs.allMatched.sendToRenderMs.p50ReductionPercent,20);
 assert.equal(result.pairs.allMatched.residualMs.A.p50,200);assert.equal(result.pairs.allMatched.residualMs.Q.p50,0);
 assert.equal(result.pairs.allMatched.engineMs.A.p50,500);assert.equal(result.pairs.allMatched.getCount.A.p95,4);
 assert.equal(result.complete,false);assert.equal(result.winner,null);assert.equal(result.twentyPercentCriterion.judgment,null);
});
test('invalid runtime files remain in audit, errors and costs but not comparable metrics',()=>{
 const bad=sample('Q');bad.errors=[{message:'runtime changed'}];
 const result=summarizeQueue([file('A',[sample('A')]),file('Q',[bad],1,{runtimeVerification:{verified:false,runtimeSha256:'runtime'},status:'invalid_runtime_change'})]);
 assert.equal(result.pairs.comparable,0);assert.equal(result.pairs.excluded.length,1);
 assert.equal(result.arms.Q.eligible,0);assert.equal(result.arms.Q.recorded,1);
 assert.equal(result.arms.Q.allRecordedActualCost.knownSubtotalMicros,2);
 assert.equal(result.arms.Q.errors[0].error.message,'runtime changed');assert.equal(result.auditRows.length,2);
 assert.match(queueMarkdown(result),/runtime_not_verified/);
});
test('missing verification, mismatched runtime/corpus and incorrect dispatch setting exclude comparisons',()=>{
 for(const extra of [{runtimeVerification:null},{runtimeVerification:{verified:true,runtimeSha256:'different'}},{corpus:{snapshotSha256:'different'}},{immediateDispatch:false}]){
  assert.equal(summarizeQueue([file('A',[sample('A')]),file('Q',[sample('Q')],1,extra)]).pairs.comparable,0);
 }
});
test('unknown costs and missing queue measurements never turn into zero',()=>{
 const q=sample('Q');q.actualCostMicros=null;delete q.decision.delivery;
 const result=summarizeQueue([file('A',[sample('A')]),file('Q',[q])]);
 assert.equal(result.arms.Q.allRecordedActualCost.totalMicros,null);assert.equal(result.arms.Q.allRecordedActualCost.meanFullRequestMicros,null);
 assert.equal(result.arms.Q.allRecordedActualCost.unknownRequests,1);
 assert.equal(result.pairs.allMatched.queueWaitMs.measuredPairs,0);assert.equal(result.pairs.allMatched.residualMs.Q.p50,null);
 assert.equal(result.pairs.allMatched.sendToRenderMs.measuredPairs,1);
});
test('independent review gates useful-correct answers and preserves raw responses',()=>{
 const a=sample('A'),q=sample('Q');
 const review={reviewer:'Coding agent',reviews:[{traceId:a.traceId,caseId:a.id,arm:'A',passOverride:true},{traceId:q.traceId,caseId:q.id,arm:'Q',passOverride:false,reason:'Missing condition'}]};
 const raw=JSON.stringify([a,q]),result=summarizeQueue([file('A',[a]),file('Q',[q])],review);
 assert.equal(result.pairs.allMatched.sendToRenderMs.measuredPairs,1);
 assert.equal(result.pairs.usefulCorrectAnswerIntersection.sendToRenderMs.measuredPairs,0);
 assert.equal(result.pairs.newReviewedQualityFailures.length,1);assert.equal(JSON.stringify([a,q]),raw);
 assert.equal(summarizeQueue([file('A',[a]),file('Q',[q])]).arms.A.unreviewed,1);
});
test('empty inputs are provisional, output deterministic, and negative residuals remain visible',()=>{
 assert.equal(summarizeQueue([]).pairs.comparable,0);assert.equal(summarizeQueue([]).complete,false);
 const q=sample('Q',undefined,700),files=[file('Q',[q]),file('A',[sample('A')])];
 const first=summarizeQueue(files),second=summarizeQueue(files);
 assert.equal(first.arms.Q.metrics.residualMs.p50,-100);assert.equal(first.arms.Q.negativeResiduals.length,1);
 assert.equal(queueMarkdown(first),queueMarkdown(second));assert.equal(JSON.stringify(first),JSON.stringify(second));
 assert.throws(()=>summarizeQueue([...files,files[0]]),/Duplicate arm/);
});
