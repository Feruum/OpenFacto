# Answer latency experiment

Run: 8994e9c4-b708-4b25-b15e-46a7fca675a2. Recorded 444/444; complete. No winner selected.

Engine-only comparison; request process startup, browser delivery and Telegram delivery are not included in engine duration.

Independent coding-agent source review, not human labeling. Explicit overrides are separate from frozen raw quality; unreviewed rows retain their raw results.

A 20% end-to-end improvement cannot be established from engine-only latency. Browser samples are reported separately; quality, comparable scope and sample completeness require review.

| Variant | Recorded/planned | Raw pass | Adjusted pass | Reviewed | Engine p50/p95 ms | Correct-answer p50/p95 ms (adjusted) | Actual known subtotal μUSD | Unknown costs | Mean full-request μUSD |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A | 111/111 | 92 | 103 | 28 | 9985/17086 | 9726/16444 | 3308.13 | 9 | — |
| B | 111/111 | 97 | 105 | 18 | 10304/17385 | 9830/14550 | 3389.21 | 15 | — |
| C | 111/111 | 89 | 97 | 25 | 7868/13778 | 8099/15575 | 3427.58 | 6 | — |
| D | 111/111 | 73 | 82 | 46 | 6192/11427 | 6964/11673 | 3266.24 | 10 | — |

Actual known subtotals exclude unknown charges; they are not complete totals. Tariff estimates and rounded ledger costs are separate in JSON. Percentiles use nearest rank. Useful-answer samples exclude refusals and incomplete/incorrect answers.

## Failures and unknown billing

Child errors/timeouts and provider failures are separate. A provider failure can produce a normal engine fallback with no child error. Operation-uncertain requests count that explicit engine reason; uncertain-ledger requests count reserved/uncertain operations.

A connection failure lasting at least 39 seconds is a possible timeout near the frozen 40-second provider deadline, not a confirmed timeout. Only failure=timeout is counted as confirmed; child timeouts remain separate.

| Variant | Child errors/timeouts | Provider unavailable | Operation uncertain | Uncertain ledger requests | Provider failure operations | Confirmed/possible provider timeout requests | Unknown actual charges |
|---|---:|---:|---:|---:|---:|---:|---:|
| A | 0/0 | 0 | 0 | 0 | 0 | 0/0 | 9 |
| B | 0/0 | 0 | 0 | 0 | 0 | 0/0 | 15 |
| C | 0/0 | 1 | 0 | 1 | 1 | 0/1 | 6 |
| D | 0/0 | 0 | 0 | 0 | 0 | 0/0 | 10 |

Provider failure strings: {"connection":1}.

## Language quality

| Variant/language | Cases | Raw failures | Adjusted failures | Refusal outcomes | Answerable not answered | Reviewed unjustified refusals |
|---|---:|---:|---:|---:|---:|---:|
| A/ru | 60 | 7 | 4 | 24 | 2 | 2 |
| A/kk | 27 | 4 | 1 | 4 | 0 | 0 |
| A/en | 24 | 8 | 3 | 3 | 0 | 0 |
| B/ru | 60 | 4 | 1 | 25 | 1 | 1 |
| B/kk | 27 | 4 | 1 | 5 | 0 | 0 |
| B/en | 24 | 6 | 4 | 3 | 0 | 0 |
| C/ru | 60 | 7 | 4 | 27 | 2 | 2 |
| C/kk | 27 | 6 | 2 | 7 | 1 | 1 |
| C/en | 24 | 9 | 8 | 5 | 1 | 1 |
| D/ru | 60 | 13 | 10 | 33 | 6 | 6 |
| D/kk | 27 | 12 | 8 | 11 | 6 | 6 |
| D/en | 24 | 13 | 11 | 9 | 3 | 3 |

## Paired engine comparisons

Pairs share caseId and repeat. Correct-answer comparisons use the intersection of correct answerable results, separately for raw and adjusted quality. Positive reduction means faster; this is not an end-to-end acceptance decision.

| Comparison | Matched | All p50 reduction % | Raw correct pairs / p50 reduction % | Adjusted correct pairs / p50 reduction % | New raw/adjusted failures |
|---|---:|---:|---:|---:|---:|
| A_to_B | 111 | -3.195 | 47 / -1.634 | 54 / -1.634 | 2/4 |
| B_to_C | 111 | 23.641 | 43 / 19.281 | 51 / 19.678 | 12/11 |
| B_to_D | 111 | 39.907 | 34 / 35.259 | 43 / 30.665 | 26/24 |

New adjusted quality failures:
- A_to_B: case-02, repeat 3, trace dd46dd0d-fd23-46a3-a155-9a836ac8f047, real_incomplete_answer.
- A_to_B: case-27, repeat 3, trace 254b3759-eaab-43e9-a2bf-dd48bee4f8cc, real_unjustified_refusal.
- A_to_B: case-31, repeat 2, trace 0a2c9ad4-75dd-4aaa-aee6-be0e6abf71c8, real_language_failure.
- A_to_B: case-36, repeat 2, trace d58cfcb0-bb10-433d-bd65-7e647ec78814, real_temporal_precision_failure.
- B_to_C: case-02, repeat 2, trace 4fad782a-30dc-4eff-9842-bc35564bdcee, real_incomplete_answer.
- B_to_C: case-10, repeat 3, trace 0f8f48f4-a22d-4697-888f-8e9ed3763a04, real_missing_permission_condition.
- B_to_C: case-12, repeat 3, trace 55a94607-033d-4fa5-9936-f2d17031ddce, real_unjustified_refusal.
- B_to_C: case-15, repeat 3, trace 85257bbd-fe7c-4c14-8e54-d5d5f0fd2eb1, real_unjustified_refusal.
- B_to_C: case-25, repeat 1, trace f855c737-72b5-45e9-9b0a-2fcb403423b1, real_provider_timeout.
- B_to_C: case-27, repeat 1, trace f10f03c0-ac21-4e95-99d1-b6430c8f1a7c, real_unjustified_refusal.
- B_to_C: case-30, repeat 3, trace 6e81e563-02b7-486c-bd65-57b4865a4a33, real_unjustified_refusal.
- B_to_C: case-31, repeat 3, trace 75b38e75-547a-4f48-b5bb-91ffc977375d, real_language_failure.
- B_to_C: case-32, repeat 1, trace ca17bbca-dc90-4b68-8b3e-b36c5e96fd44, real_language_failure.
- B_to_C: case-32, repeat 3, trace dbcc7ab0-21e1-4c5d-9832-676c7840d928, real_language_failure.
- B_to_C: case-37, repeat 1, trace 5af96554-92d0-41c4-85df-fcd7d0593cde, real_language_failure.
- B_to_D: case-02, repeat 1, trace 5fdaa703-ed76-46a0-b5e7-5675596e073f, real_incomplete_answer.
- B_to_D: case-06, repeat 2, trace 75186925-2f88-4a1b-a107-1b029f6878ae, real_unjustified_refusal.
- B_to_D: case-10, repeat 3, trace ae3ad602-be32-4c6b-8704-b820b9f21f8a, real_unjustified_refusal.
- B_to_D: case-12, repeat 1, trace b38c316b-08d2-4fc5-855b-72109169e71e, real_unjustified_refusal.
- B_to_D: case-13, repeat 1, trace 291d20c1-c38f-4e7c-8d41-fd619b316220, real_unjustified_refusal.
- B_to_D: case-13, repeat 2, trace 06f02316-cc87-46a2-a940-5b624a104f07, real_unjustified_refusal.
- B_to_D: case-13, repeat 3, trace d0517535-30ea-4474-aae6-04ee848c0534, real_unjustified_refusal.
- B_to_D: case-14, repeat 2, trace 30f791b9-ab37-4026-95a8-905c0e94764e, real_unjustified_refusal.
- B_to_D: case-14, repeat 3, trace 5514fe66-294b-4421-b290-8942f86839be, real_unjustified_refusal.
- B_to_D: case-15, repeat 1, trace afaf176b-e913-4742-b582-cf57816eaf4d, real_unjustified_refusal.
- B_to_D: case-15, repeat 2, trace f3d452e8-3501-40c8-b711-9ea6c91e4db8, real_unjustified_refusal.
- B_to_D: case-15, repeat 3, trace 4e117dcd-858a-4698-8f78-ca49961244ed, real_unjustified_refusal.
- B_to_D: case-27, repeat 1, trace 826476b4-3409-482d-aa05-b7bea804d740, real_context_failure.
- B_to_D: case-27, repeat 2, trace 025e30bd-1076-4f1f-b14d-e2d647e9c31b, real_unjustified_refusal.
- B_to_D: case-28, repeat 1, trace ffbba36a-78dd-483c-9825-f531457bccf9, real_ambiguity_failure.
- B_to_D: case-28, repeat 3, trace 526448b2-6503-4a5a-af6d-c8f3c9774e3e, real_ambiguity_failure.
- B_to_D: case-29, repeat 1, trace feb4ffde-48aa-4c84-b2ae-c8faad5ba837, real_unjustified_refusal.
- B_to_D: case-29, repeat 2, trace ffe412b2-e793-4a9a-829a-8ce3f74ea032, real_unjustified_refusal.
- B_to_D: case-30, repeat 1, trace 752b5278-8674-4267-9c4d-e60bac3f06ba, real_unjustified_refusal.
- B_to_D: case-35, repeat 1, trace df50d3f0-cd1d-4151-8ca7-90fc5daca4f0, real_language_failure.
- B_to_D: case-35, repeat 2, trace 071eed83-cd2a-480c-a6aa-6caf763eb1d4, real_language_failure.
- B_to_D: case-35, repeat 3, trace 8f1d5b08-11fc-4a55-ad82-2f21030f6e42, real_language_failure.
- B_to_D: case-37, repeat 1, trace 249080ef-9c26-4bd4-980f-823e7d94687b, real_ambiguity_failure.
- B_to_D: case-37, repeat 2, trace 7695c71f-ef0c-4c5a-a570-e75e946cedb0, real_ambiguity_failure.

## Provider stages

Tokens are per operation; missing diagnostics remain unknown. Engine stage timings, including retrieval and reranking, are retained in JSON.

| Variant/stage | Operations | Failure operations | Duration p50/p95 ms | Prompt mean | Completion mean | Cached mean (unknown) | Reasoning mean (unknown) |
|---|---:|---:|---:|---:|---:|---:|---:|
| A/select | 111 | 0 | 6188/10564 | 4998.865 | 230.333 | 4837.744 (72) | 115.118 (1) |
| A/select-expanded | 7 | 0 | 5796/13458 | 5205.143 | 272.714 | — (7) | 186.571 (0) |
| A/verify | 88 | 0 | 3712/7223 | 3935.477 | 118.909 | 3500.8 (68) | 108.682 (3) |
| B/select | 111 | 0 | 6053/11610 | 5046.865 | 224.171 | 4816.593 (84) | 116.115 (7) |
| B/select-expanded | 9 | 0 | 4970/9750 | 5278.889 | 181.222 | — (9) | 100.556 (0) |
| B/verify | 88 | 0 | 4105/6512 | 3924.284 | 120.011 | 3571.2 (68) | 108.523 (2) |
| C/select | 111 | 0 | 4940/9846 | 5046.865 | 168.351 | 4893.257 (76) | 75.167 (27) |
| C/select-expanded | 11 | 0 | 3975/6247 | 5385.818 | 101 | — (11) | 50 (5) |
| C/verify | 85 | 1 | 3204/5962 | 3920.321 | 65.881 | 3492.571 (78) | 73.433 (25) |
| D/select | 111 | 0 | 3432/8995 | 5046.865 | 108.919 | 4932.571 (83) | — (111) |
| D/select-expanded | 14 | 0 | 2914/4613 | 5472.143 | 56.214 | — (14) | — (14) |
| D/verify | 83 | 0 | 1989/2698 | 3906.458 | 12 | 3520 (77) | — (83) |

## Browser observations

Separate live browser case set; labels alone do not verify provider settings. Queue is reported only from explicit delivery metadata. No quality overrides or synthetic timings are merged into this set.

Files: 6.

| Variant | Cases | Send-to-render p50/p95 ms | GET count mean | Queue p50 ms | Actual known subtotal μUSD / unknown |
|---|---:|---:|---:|---:|---:|
| A | 21 | 11059.4/14981 | 35.381 | 1327 | 723.66 / 1 |
| B | 21 | 11351.6/17313.3 | 34.238 | 1351 | 647.04 / 2 |
| C | 0 | —/— | — | — | 0 / 0 |
| D | 0 | —/— | — | — | 0 / 0 |

Errors, timeouts, unresolved provider operations, raw checks and review rationale are preserved in the JSON audit rows. Unreviewed failures and missing measurements remain in their denominators.
