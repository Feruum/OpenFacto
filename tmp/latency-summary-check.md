# Answer latency experiment

Run: 8994e9c4-b708-4b25-b15e-46a7fca675a2. Recorded 150/444; incomplete — provisional. No winner selected.

Engine-only comparison; request process startup, browser delivery and Telegram delivery are not included in engine duration.

Independent coding-agent source review, not human labeling. Explicit overrides are separate from frozen raw quality; unreviewed rows retain their raw results.

A 20% end-to-end improvement cannot be established from engine-only latency. Browser samples are reported separately; quality, comparable scope and sample completeness require review.

| Variant | Recorded/planned | Raw pass | Adjusted pass | Reviewed | Engine p50/p95 ms | Correct-answer p50/p95 ms (adjusted) | Actual known subtotal μUSD | Unknown costs | Mean full-request μUSD |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A | 37/111 | 31 | 34 | 11 | 10212/17397 | 9547/18650 | 1476.59 | 0 | 39.908 |
| B | 38/111 | 34 | 37 | 6 | 10076/15684 | 10044/13741 | 1467.17 | 1 | — |
| C | 37/111 | 28 | 31 | 9 | 7990/16217 | 8595/16217 | 1407.65 | 1 | — |
| D | 38/111 | 25 | 27 | 18 | 5782/10493 | 6954/10493 | 1428.99 | 0 | 37.605 |

Actual known subtotals exclude unknown charges; they are not complete totals. Tariff estimates and rounded ledger costs are separate in JSON. Percentiles use nearest rank. Useful-answer samples exclude refusals and incomplete/incorrect answers.

## Failures and unknown billing

Child errors/timeouts and provider failures are separate. A provider failure can produce a normal engine fallback with no child error. Operation-uncertain requests count that explicit engine reason; uncertain-ledger requests count reserved/uncertain operations.

A connection failure lasting at least 39 seconds is a possible timeout near the frozen 40-second provider deadline, not a confirmed timeout. Only failure=timeout is counted as confirmed; child timeouts remain separate.

| Variant | Child errors/timeouts | Provider unavailable | Operation uncertain | Uncertain ledger requests | Provider failure operations | Confirmed/possible provider timeout requests | Unknown actual charges |
|---|---:|---:|---:|---:|---:|---:|---:|
| A | 0/0 | 0 | 0 | 0 | 0 | 0/0 | 0 |
| B | 0/0 | 0 | 0 | 0 | 0 | 0/0 | 1 |
| C | 0/0 | 1 | 0 | 1 | 1 | 0/1 | 1 |
| D | 0/0 | 0 | 0 | 0 | 0 | 0/0 | 0 |

Provider failure strings: {"connection":1}.

## Language quality

| Variant/language | Cases | Raw failures | Adjusted failures | Refusal outcomes | Answerable not answered | Reviewed unjustified refusals |
|---|---:|---:|---:|---:|---:|---:|
| A/ru | 20 | 3 | 2 | 7 | 1 | 0 |
| A/kk | 9 | 1 | 0 | 2 | 0 | 0 |
| A/en | 8 | 2 | 1 | 1 | 0 | 0 |
| B/ru | 21 | 1 | 0 | 10 | 0 | 0 |
| B/kk | 9 | 1 | 0 | 2 | 0 | 0 |
| B/en | 8 | 2 | 1 | 1 | 0 | 0 |
| C/ru | 20 | 3 | 2 | 10 | 1 | 1 |
| C/kk | 9 | 2 | 1 | 2 | 0 | 0 |
| C/en | 8 | 4 | 3 | 1 | 0 | 0 |
| D/ru | 21 | 5 | 4 | 12 | 2 | 2 |
| D/kk | 9 | 4 | 3 | 4 | 2 | 2 |
| D/en | 8 | 4 | 4 | 3 | 1 | 1 |

## Paired engine comparisons

Pairs share caseId and repeat. Correct-answer comparisons use the intersection of correct answerable results, separately for raw and adjusted quality. Positive reduction means faster; this is not an end-to-end acceptance decision.

| Comparison | Matched | All p50 reduction % | Raw correct pairs / p50 reduction % | Adjusted correct pairs / p50 reduction % | New raw/adjusted failures |
|---|---:|---:|---:|---:|---:|
| A_to_B | 37 | 1.332 | 16 / -3.375 | 19 / -7.929 | 0/0 |
| B_to_C | 37 | 20.703 | 14 / 0.821 | 18 / 11.474 | 6/5 |
| B_to_D | 37 | 42.616 | 11 / 28.366 | 14 / 30.765 | 10/10 |

New adjusted quality failures:
- B_to_C: case-08, repeat 1, trace a41e18a1-f0e0-4832-958e-2c253625e7c5.
- B_to_C: case-25, repeat 1, trace f855c737-72b5-45e9-9b0a-2fcb403423b1, real_provider_timeout.
- B_to_C: case-27, repeat 1, trace f10f03c0-ac21-4e95-99d1-b6430c8f1a7c, real_unjustified_refusal.
- B_to_C: case-32, repeat 1, trace ca17bbca-dc90-4b68-8b3e-b36c5e96fd44, real_language_failure.
- B_to_C: case-37, repeat 1, trace 5af96554-92d0-41c4-85df-fcd7d0593cde, real_language_failure.
- B_to_D: case-02, repeat 1, trace 5fdaa703-ed76-46a0-b5e7-5675596e073f, real_incomplete_answer.
- B_to_D: case-12, repeat 1, trace b38c316b-08d2-4fc5-855b-72109169e71e, real_unjustified_refusal.
- B_to_D: case-13, repeat 1, trace 291d20c1-c38f-4e7c-8d41-fd619b316220, real_unjustified_refusal.
- B_to_D: case-15, repeat 1, trace afaf176b-e913-4742-b582-cf57816eaf4d, real_unjustified_refusal.
- B_to_D: case-27, repeat 1, trace 826476b4-3409-482d-aa05-b7bea804d740.
- B_to_D: case-28, repeat 1, trace ffbba36a-78dd-483c-9825-f531457bccf9, real_ambiguity_failure.
- B_to_D: case-29, repeat 1, trace feb4ffde-48aa-4c84-b2ae-c8faad5ba837, real_unjustified_refusal.
- B_to_D: case-30, repeat 1, trace 752b5278-8674-4267-9c4d-e60bac3f06ba, real_unjustified_refusal.
- B_to_D: case-35, repeat 1, trace df50d3f0-cd1d-4151-8ca7-90fc5daca4f0, real_language_failure.
- B_to_D: case-37, repeat 1, trace 249080ef-9c26-4bd4-980f-823e7d94687b, real_ambiguity_failure.

## Provider stages

Tokens are per operation; missing diagnostics remain unknown. Engine stage timings, including retrieval and reranking, are retained in JSON.

| Variant/stage | Operations | Failure operations | Duration p50/p95 ms | Prompt mean | Completion mean | Cached mean (unknown) | Reasoning mean (unknown) |
|---|---:|---:|---:|---:|---:|---:|---:|
| A/select | 37 | 0 | 6213/10771 | 4998.865 | 232.568 | — (37) | 115.73 (0) |
| A/select-expanded | 2 | 0 | 4881/6578 | 5365.5 | 229.5 | — (2) | 131 (0) |
| A/verify | 30 | 0 | 3628/6424 | 3926.3 | 108.133 | 3264 (28) | 101 (2) |
| B/select | 38 | 0 | 5427/11029 | 5027.105 | 213.237 | — (38) | 106.639 (2) |
| B/select-expanded | 4 | 0 | 4009/8636 | 5220.75 | 160.75 | — (4) | 73.75 (0) |
| B/verify | 31 | 0 | 4051/6561 | 3925.613 | 117.452 | 3456 (25) | 110.724 (2) |
| C/select | 37 | 0 | 4912/10947 | 5046.865 | 168.595 | — (37) | 74.036 (9) |
| C/select-expanded | 4 | 0 | 3501/4491 | 5442.5 | 88 | — (4) | 47 (2) |
| C/verify | 28 | 1 | 3323/8595 | 3955.852 | 71.074 | — (28) | 73.952 (7) |
| D/select | 38 | 0 | 3322/8213 | 5061.263 | 102.5 | — (38) | — (38) |
| D/select-expanded | 6 | 0 | 2914/3843 | 5607.5 | 55.167 | — (6) | — (6) |
| D/verify | 28 | 0 | 1992/2527 | 3873.571 | 12 | — (28) | — (28) |

## Browser observations

Separate live browser case set; labels alone do not verify provider settings. Queue is reported only from explicit delivery metadata. No quality overrides or synthetic timings are merged into this set.

Files: 0.

Errors, timeouts, unresolved provider operations, raw checks and review rationale are preserved in the JSON audit rows. Unreviewed failures and missing measurements remain in their denominators.
