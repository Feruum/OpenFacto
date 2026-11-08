# Browser queue and delivery comparison

A → Q: 14/21 comparable case/repeat pairs. Incomplete or invalid — provisional. No winner selected.

A: Original combined prompt, default effort omitted, immediate dispatch disabled. Q: Same original prompt/default effort; immediate dispatch enabled.

Observed browser reductions are descriptive, not an automatic 20% acceptance verdict. Confirm completeness, runtime comparability, source quality and delivery-clock limitations.

| Metric | Matched samples | A p50/p95 | Q p50/p95 | p50/p95 reduction % |
|---|---:|---:|---:|---:|
| sendToRenderMs | 14 | 11046.4/15050.4 | 10745.3/16324.1 | 2.726/-8.463 |
| queueWaitMs | 14 | 1293/1953 | 53/126 | 95.901/93.548 |
| engineMs | 14 | 10397/13141 | 10339/15432 | 0.558/-17.434 |
| workerDurationMs | 14 | 10410/13184 | 10351/15463 | 0.567/-17.286 |
| residualMs | 14 | 263.4/504 | 268.2/789.1 | -1.822/-56.567 |
| sendToRenderMinusEngineMs | 14 | 1559.8/2229.3 | 362.5/892.1 | 76.76/59.983 |
| getCount | 14 | 33/45 | 32/46 | 3.03/-2.222 |

All timing units are milliseconds; getCount is a request count. Each metric uses only pairs where both measurements exist. Missing durations and errors remain visible below.

| Arm | Recorded/eligible | Requests with errors | Source reviewed pass/fail/unknown | Actual known subtotal μUSD | Unknown actual costs | Mean full-request cost μUSD |
|---|---:|---:|---:|---:|---:|---:|
| A | 14/14 | 0 | 10/4/0 | 477.38 | 1 | — |
| Q | 14/14 | 0 | 10/4/0 | 507.29 | 1 | — |

Independently reviewed useful-correct-answer intersection: 5 pairs; send-to-render A p50/p95 13348.8/14981 ms, Q 12442.8/16324.1 ms.

New reviewed quality failures: 1. Missing A/Q records: 7/7. Excluded matched pairs: 0.

Known subtotals include recorded spending from invalid files; eligible-only costs are separate in JSON. Unknown charges are not zero, and a full-request mean is withheld whenever any included charge is unknown.

- Nearest-rank percentiles are computed independently from actual samples; stage p95 values are never added.
- Residual = send-to-render minus queueWait minus workerDuration per request, not a pure network/polling delay. Queue timestamps and process duration clocks have different boundaries; negative residuals are retained.
- answerReadyAt/workerDuration precede final result persistence; browser end is after React commit, not confirmed screen paint.
- Invalid or unverified runtime rows remain in audit and recorded spending, but are excluded from comparable latency metrics.
- Source review is independent coding-agent review unless its provenance explicitly states otherwise; no human labeling is inferred. Unreviewed quality is unknown.

Excluded/invalid files:

Errors, runtime verification, source-review rationale, excluded-pair reasons and all original sample rows are preserved in the JSON report.
