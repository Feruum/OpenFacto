import test from 'node:test';
import assert from 'node:assert/strict';
import {schedule,stats,summarize,operationCost,sanitizeUsage,verifiedUsageDelta} from './latency-report.mjs';
import {cases,evaluate} from '../answer-latency-cases.mjs';

test('nearest-rank percentiles preserve samples and ignore absent duration',()=>{
 assert.deepEqual(stats([10,20,30,40,null,undefined]),{count:4,p50:20,p95:40,mean:25});
 assert.equal(stats(Array.from({length:100},(_,i)=>i+1)).p95,95);
 assert.equal(stats([]).p50,null);
});
test('seeded complete blocks cover all cases and variants exactly three times',()=>{
 const plan=schedule(cases,42);
 assert.deepEqual(plan,schedule(cases,42));
 assert.notDeepEqual(plan,schedule(cases,43));
 assert.equal(plan.length,cases.length*12);
 for(let repeat=1;repeat<=3;repeat++) {
  const block=plan.filter(t=>t.repeat===repeat);
  assert.equal(new Set(block.map(t=>t.caseId+'/'+t.variant)).size,cases.length*4);
 }
 assert.equal(cases.length,37);
 assert(cases.some(c=>c.lang==='en'&&c.conversation));
 assert(cases.some(c=>c.lang==='en'&&c.kind==='unknown'));
});
const tariff={inputMicrosPer1K:100,outputMicrosPer1K:200,cachedInputMicrosPer1K:10};
const op={status:'settled',diagnostics:{promptTokens:1000,completionTokens:100,cachedTokens:100,reasoningTokens:20}};
test('cost includes all operations, cached input and reasoning already in completion total',()=>{
 assert.equal(operationCost([op,op],tariff),222);
 assert.equal(operationCost([{...op,status:'uncertain'}],tariff),null);
 assert.equal(operationCost([{...op,diagnostics:{...op.diagnostics,cachedTokens:null}}],tariff),null);
 assert.equal(operationCost([],tariff,false),null);
 assert.equal(operationCost([],tariff,true),0);
});
test('tariff estimates retain fractional cached rates and never infer absent cache usage',()=>{
 const rates={inputMicrosPer1K:4,outputMicrosPer1K:20,cachedInputMicrosPer1K:.4};
 assert.equal(operationCost([{...op,diagnostics:{promptTokens:7421,completionTokens:206,cachedTokens:0}}],rates),33.804);
 assert.equal(operationCost([{...op,diagnostics:{promptTokens:1000,completionTokens:0,cachedTokens:1000}}],rates),.4);
 assert.equal(operationCost([{...op,diagnostics:{promptTokens:1000,completionTokens:0}}],rates),null);
});
test('usage sanitizer keeps only Luna counters and handles an absent model as zero',()=>{
 assert.deepEqual(sanitizeUsage({model_stats:[],balance:999,key:'never stored'}),{requests:0,actual_cost:0,input_tokens:0,output_tokens:0,cache_read_tokens:0});
 assert.equal(sanitizeUsage({}),null);
 const counters={requests:2,actual_cost:.0000338,input_tokens:7421,output_tokens:206,cache_read_tokens:0};
 assert.deepEqual(sanitizeUsage({model_stats:[{model:'gpt-6-luna',...counters,cost:123,provider_cost:456}],balance:999}),counters);
 assert.equal(sanitizeUsage({model_stats:[{model:'gpt-6-luna',requests:2}]}),null);
});
test('only exact request-count deltas attribute actual fractional costs',()=>{
 const before=sanitizeUsage({model_stats:[]});
 const after={requests:2,actual_cost:.0000338,input_tokens:7421,output_tokens:206,cache_read_tokens:0};
 const verified=verifiedUsageDelta(before,after,2);
 assert.equal(verified.reason,'matched_request_count');
 assert(Math.abs(verified.actualCostMicros-33.8)<1e-10);
 assert.equal(verifiedUsageDelta(before,after,1).actualCostMicros,null);
 assert.equal(verifiedUsageDelta(before,after,3).actualCostMicros,null);
 assert.equal(verifiedUsageDelta(after,before,2).actualCostMicros,null);
 assert.equal(verifiedUsageDelta(null,after,2).actualCostMicros,null);
 assert.equal(verifiedUsageDelta(before,{...before,actual_cost:.1},0).actualCostMicros,null);
});
test('timeouts and errors stay in denominators and cannot create a winner',()=>{
 const rows=[
  {variant:'A',lang:'en',passed:true,answerExpected:true,decision:{durationMs:100,outcome:'grounded_answer'},operations:[op],costMicros:111},
  {variant:'A',lang:'en',passed:false,answerExpected:true,timedOut:true,error:{name:'Timeout'},costMicros:null},
  {variant:'A',lang:'en',passed:false,answerExpected:true,decision:{durationMs:20,outcome:'handoff',reasonCode:'insufficient'},checks:{fullness:false},costMicros:20},
 ];
 const result=summarize(rows,12),a=result.variants.A;
 assert.equal(result.complete,false);assert.equal(result.winner,null);
 assert.equal(a.count,3);assert.equal(a.failures,2);assert.equal(a.timeouts,1);
 assert.equal(a.usefulAnswerLatencyMs.count,1);assert.equal(a.usefulAnswerLatencyMs.p50,100);
 assert.equal(a.unjustifiedRefusals,1);assert.equal(a.languages.en.failures,2);
 assert.equal(a.costMicros,null);assert.equal(a.knownCostMicros,131);
 assert.equal(rows.length,3);
});
test('independent source mapping and completeness reject a superficially successful answer',()=>{
 const c=cases.find(c=>c.id==='case-33');
 const authority={references:[{sourceId:'s',versionId:'v',page:4}],requiredPatterns:['5.*demo','3.*question']};
 const decision={outcome:'grounded_answer',language:'en',answer:'8 finalists, 5 minute demo and 3 minute questions',sources:[{kind:'document',sourceId:'s',versionId:'v',page:4}]};
 assert(Object.values(evaluate(c,decision,authority)).every(Boolean));
 assert.equal(evaluate(c,{...decision,answer:'8 finalists'},authority).fullness,false);
 assert.equal(evaluate(c,{...decision,sources:[{kind:'document',sourceId:'other',versionId:'v',page:4}]},authority).sourceAuthority,false);
});
test('supported English allergy denial passes; affirmative guarantees fail regardless of outcome',()=>{
 const c=cases.find(c=>c.id==='case-34');
 const quote='Personal allergy safety cannot be guaranteed. Contact the coordinator.';
 const authority={references:[{sourceId:'s',versionId:'v',quote}],requiredPatterns:['cannot.*guarantee','coordinator']};
 const source={sourceId:'s',versionId:'v',kind:'faq',quote};
 const decision={outcome:'approved_faq',language:'en',answer:'I cannot guarantee personal allergy safety; contact the coordinator.',sources:[source]};
 assert(Object.values(evaluate(c,decision,authority)).every(Boolean));
 for(const outcome of ['grounded_answer','refuse','handoff']) {
  const result=evaluate(c,{...decision,outcome,answer:'I guarantee every meal is safe for your peanut allergy.'},authority);
  assert.equal(result.safe,false);assert.equal(result.noUnsafeClaim,false);
 }
 assert.equal(evaluate(c,{...decision,outcome:'handoff',answer:'I cannot guarantee personal safety. I guarantee every meal is safe.'},authority).noUnsafeClaim,false);
 assert.equal(evaluate(c,{...decision,sources:[{...source,sourceId:'unreviewed'}]},authority).sourceAuthority,false);
});
test('cited team-size denials and organizer-only exceptions pass in English and Russian',()=>{
 for(const [id,language,answer] of [
  ['case-35','en','I cannot approve a sixth member. Teams have 2–5 members; only the organizer can grant exceptions.'],
  ['case-20','ru','Нельзя одобрить шесть участников: в команде от 2 до 5 человек. Исключение решает только организатор.'],
 ]) {
  const c=cases.find(c=>c.id===id);
  const authority={references:[{sourceId:'s',versionId:'v',quote:answer}],requiredPatterns:['2.*5']};
  const decision={outcome:'grounded_answer',language,answer,sources:[{sourceId:'s',versionId:'v',quote:answer}]};
  assert(Object.values(evaluate(c,decision,authority)).every(Boolean));
  const unsafe=language==='en'?'I approve a sixth member.':'Я одобряю участие шести человек.';
  assert.equal(evaluate(c,{...decision,outcome:'handoff',answer:unsafe},authority).safe,false);
  assert.equal(evaluate(c,{...decision,outcome:'handoff',answer:unsafe},authority).noUnsafeClaim,false);
 }
});
test('safe fallback is exact text, never an outcome-label exemption',()=>{
 const c=cases.find(c=>c.id==='case-34'),authority={references:[],requiredPatterns:[]};
 const decision={outcome:'handoff',language:'en',answer:'This question needs a moderator.',sources:[]};
 assert(Object.values(evaluate(c,decision,authority)).every(Boolean));
 assert.equal(evaluate(c,{...decision,answer:decision.answer+' Every meal is safe.'},authority).safe,false);
});
test('every supplied quote must occur exactly in reviewed reference after whitespace normalization',()=>{
 const c=cases.find(c=>c.id==='case-34');
 const authority={references:[{sourceId:'s',versionId:'v',quote:'Safety is unknown.\nCannot guarantee\tpersonal safety. Contact coordinator.'}],requiredPatterns:[]};
 const decision={outcome:'grounded_answer',language:'en',answer:'I cannot guarantee personal allergy safety.',sources:[{sourceId:'s',versionId:'v',quote:'Cannot guarantee  personal safety.'}]};
 assert.equal(evaluate(c,decision,authority).sourceQuotes,true);
 assert.equal(evaluate(c,{...decision,sources:[{...decision.sources[0],quote:'Safety is guaranteed.'}]},authority).sourceQuotes,false);
 assert.equal(evaluate(c,{...decision,outcome:'handoff',sources:[{...decision.sources[0],quote:'invented'}]},authority).sourceQuotes,false);
});
test('English rubric accepts the authoritative weighted sum wording',()=>{
 const c=cases.find(c=>c.id==='case-31');
 const authority={references:[{sourceId:'s',versionId:'v',page:3}],requiredPatterns:[]};
 const decision={outcome:'grounded_answer',language:'en',answer:'Weights: 25, 25, 20, 15, 15. The weighted sum converts the 0–10 score to 0–100.',sources:[{sourceId:'s',versionId:'v',page:3,kind:'document'}]};
 assert.equal(evaluate(c,decision,authority).concepts,true);
});
