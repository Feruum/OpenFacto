# Browser queue and delivery comparison

A → Q: 21/21 comparable case/repeat pairs. Complete. No winner selected.

A: Original combined prompt, default effort omitted, immediate dispatch disabled. Q: Same original prompt/default effort; immediate dispatch enabled.

Observed browser reductions are descriptive, not an automatic 20% acceptance verdict. Confirm completeness, runtime comparability, source quality and delivery-clock limitations.

| Metric | Matched samples | A p50/p95 | Q p50/p95 | p50/p95 reduction % |
|---|---:|---:|---:|---:|
| sendToRenderMs | 21 | 11059.4/14981 | 11094.5/16324.1 | -0.317/-8.965 |
| queueWaitMs | 21 | 1327/1953 | 53/108 | 96.006/94.47 |
| engineMs | 21 | 10452/13051 | 10657/15432 | -1.961/-18.244 |
| workerDurationMs | 21 | 10471/13092 | 10670/15463 | -1.9/-18.11 |
| residualMs | 21 | 279.5/469.7 | 268.2/455.7 | 4.043/2.981 |
| sendToRenderMinusEngineMs | 21 | 1668.3/2229.3 | 366.7/529.7 | 78.02/76.239 |
| getCount | 21 | 33/45 | 33/46 | 0/-2.222 |

All timing units are milliseconds; getCount is a request count. Each metric uses only pairs where both measurements exist. Missing durations and errors remain visible below.

| Arm | Recorded/eligible | Requests with errors | Source reviewed pass/fail/unknown | Actual known subtotal μUSD | Unknown actual costs | Mean full-request cost μUSD |
|---|---:|---:|---:|---:|---:|---:|
| A | 21/21 | 0 | 16/5/0 | 723.66 | 1 | — |
| Q | 21/21 | 0 | 16/5/0 | 717.92 | 1 | — |

Independently reviewed useful-correct-answer intersection: 9 pairs; send-to-render A p50/p95 12704.5/14981 ms, Q 12088.5/16324.1 ms.

New reviewed quality failures: 1. Missing A/Q records: 0/0. Excluded matched pairs: 0.

Known subtotals include recorded spending from invalid files; eligible-only costs are separate in JSON. Unknown charges are not zero, and a full-request mean is withheld whenever any included charge is unknown.

- Nearest-rank percentiles are computed independently from actual samples; stage p95 values are never added.
- Residual = send-to-render minus queueWait minus workerDuration per request, not a pure network/polling delay. Queue timestamps and process duration clocks have different boundaries; negative residuals are retained.
- answerReadyAt/workerDuration precede final result persistence; browser end is after React commit, not confirmed screen paint.
- Invalid or unverified runtime rows remain in audit and recorded spending, but are excluded from comparable latency metrics.
- Source review is independent coding-agent review unless its provenance explicitly states otherwise; no human labeling is inferred. Unreviewed quality is unknown.

Excluded/invalid files:

Errors, runtime verification, source-review rationale, excluded-pair reasons and all original sample rows are preserved in the JSON report.
