import { readFileSync } from 'node:fs';
const review = JSON.parse(readFileSync(new URL('./manual-review.json', import.meta.url), 'utf8'));
const report = JSON.parse(readFileSync(new URL(`./${review.runId}/report.json`, import.meta.url), 'utf8'));
const byTrace = new Map(review.reviews.map(row => [row.traceId, row]));
const effective = row => typeof byTrace.get(row.traceId)?.passOverride === 'boolean' ? byTrace.get(row.traceId).passOverride : row.passed;
const availabilityFailure = row => row.decision?.reasonCode === 'provider_unavailable' || byTrace.get(row.traceId)?.classification === 'real_provider_timeout';
const summary = row => ({caseId:row.caseId, repeat:row.repeat, traceId:row.traceId,
  rawPassed:row.passed, adjustedPassed:effective(row), review:byTrace.get(row.traceId)?.classification??'not_individually_annotated'});
const variants = Object.fromEntries(['A','B','C','D'].map(variant => {
  const rows = report.rows.filter(row => row.variant === variant);
  return [variant, { recorded: rows.length, rawPassed: rows.filter(row=>row.passed).length,
    independentlyAdjustedPassed: rows.filter(effective).length,
    reviewed: rows.filter(row=>byTrace.has(row.traceId)).length,
    availabilityFailures: rows.filter(availabilityFailure).map(summary),
    reviewedUnjustifiedRefusals:rows.filter(row=>byTrace.get(row.traceId)?.classification==='real_unjustified_refusal').map(summary),
    pendingFailures: rows.filter(row=>!row.passed&&!byTrace.has(row.traceId)).map(row=>({traceId:row.traceId,caseId:row.caseId,repeat:row.repeat})) }];
}));
const pairedComparisons = Object.fromEntries([['A','B'],['B','C'],['B','D']].map(([baseline,candidate])=>{
  const reference = new Map(report.rows.filter(row=>row.variant===baseline).map(row=>[`${row.caseId}/${row.repeat}`,row]));
  const pairs=report.rows.filter(row=>row.variant===candidate&&reference.has(`${row.caseId}/${row.repeat}`)).map(row=>({baseline:reference.get(`${row.caseId}/${row.repeat}`),candidate:row}));
  return [`${candidate}_relative_${baseline}`,{pairedCount:pairs.length,
    newQualityFailures:pairs.filter(pair=>effective(pair.baseline)&&!effective(pair.candidate)&&!availabilityFailure(pair.candidate)).map(pair=>({baseline:summary(pair.baseline),candidate:summary(pair.candidate)})),
    newAvailabilityFailures:pairs.filter(pair=>effective(pair.baseline)&&availabilityFailure(pair.candidate)).map(pair=>({baseline:summary(pair.baseline),candidate:summary(pair.candidate)})),
    improvements:pairs.filter(pair=>!effective(pair.baseline)&&effective(pair.candidate)).map(pair=>({baseline:summary(pair.baseline),candidate:summary(pair.candidate)})),
    sharedFailures:pairs.filter(pair=>!effective(pair.baseline)&&!effective(pair.candidate)).map(pair=>({baseline:summary(pair.baseline),candidate:summary(pair.candidate)}))}];
}));
console.log(JSON.stringify({runId:review.runId, complete:report.complete, recorded:report.recorded,
  reviewer:review.reviewer, reviewedAt:review.reviewedAt,
  note:'Independent source review performed by coding agent, not human labeling. Provisional until all 444 rows are recorded and failures reviewed. Raw report, frozen evaluator, corpus and benchmark winner are unchanged. Unreviewed rows retain raw results. Provider availability failures are listed separately from semantic quality regressions.',
  variants,pairedComparisons,
  clarificationConcerns:review.reviews.filter(row=>row.classification==='pass_with_quality_concern')},null,2));
