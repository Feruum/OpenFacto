# Browser queue and delivery comparison

A → Q: 0/21 comparable case/repeat pairs. Incomplete or invalid — provisional. No winner selected.

A: Original combined prompt, default effort omitted, immediate dispatch disabled. Q: Same original prompt/default effort; immediate dispatch enabled.

Observed browser reductions are descriptive, not an automatic 20% acceptance verdict. Confirm completeness, runtime comparability, source quality and delivery-clock limitations.

| Metric | Matched samples | A p50/p95 | Q p50/p95 | p50/p95 reduction % |
|---|---:|---:|---:|---:|
| sendToRenderMs | 0 | —/— | —/— | —/— |
| queueWaitMs | 0 | —/— | —/— | —/— |
| engineMs | 0 | —/— | —/— | —/— |
| workerDurationMs | 0 | —/— | —/— | —/— |
| residualMs | 0 | —/— | —/— | —/— |
| sendToRenderMinusEngineMs | 0 | —/— | —/— | —/— |
| getCount | 0 | —/— | —/— | —/— |

All timing units are milliseconds; getCount is a request count. Each metric uses only pairs where both measurements exist. Missing durations and errors remain visible below.

| Arm | Recorded/eligible | Requests with errors | Source reviewed pass/fail/unknown | Actual known subtotal μUSD | Unknown actual costs | Mean full-request cost μUSD |
|---|---:|---:|---:|---:|---:|---:|
| A | 0/0 | 0 | 0/0/0 | 0 | 0 | — |
| Q | 0/0 | 0 | 0/0/0 | 0 | 0 | — |

Independently reviewed useful-correct-answer intersection: 0 pairs; send-to-render A p50/p95 —/— ms, Q —/— ms.

New reviewed quality failures: 0. Missing A/Q records: 21/21. Excluded matched pairs: 0.

Known subtotals include recorded spending from invalid files; eligible-only costs are separate in JSON. Unknown charges are not zero, and a full-request mean is withheld whenever any included charge is unknown.

- Nearest-rank percentiles are computed independently from actual samples; stage p95 values are never added.
- Residual = send-to-render minus queueWait minus workerDuration per request, not a pure network/polling delay. Queue timestamps and process duration clocks have different boundaries; negative residuals are retained.
- answerReadyAt/workerDuration precede final result persistence; browser end is after React commit, not confirmed screen paint.
- Invalid or unverified runtime rows remain in audit and recorded spending, but are excluded from comparable latency metrics.
- Source review is independent coding-agent review unless its provenance explicitly states otherwise; no human labeling is inferred. Unreviewed quality is unknown.

Excluded/invalid files:

Errors, runtime verification, source-review rationale, excluded-pair reasons and all original sample rows are preserved in the JSON report.
