# AnswerEngine latency experiment

This runner measures AnswerEngine duration, including retrieval and provider work. It does **not** measure frontend, HTTP queue, Telegram delivery or end-to-end user latency. Child process elapsed time is reported separately and includes process startup. No live experiment is implied by these instructions.

Only `gpt-6-luna` is allowed. The four variants are A: original combined prompt, effort omitted; B: compact combined prompt, effort omitted; C: compact, `low`; D: compact, `none`. All keep combined planning enabled. Unsupported efforts remain failed trials with HTTP diagnostics; the runner never retries with a different effort or model. A 4xx diagnostic alone does not prove that effort was the cause: confirm from provider logs before labelling it unsupported.

The suite freezes the existing 30 QADAM cases plus seven English rubric, appeal, final, refusal and history/ambiguity cases. Each repeat is a seeded shuffled block containing every case and variant once. Three repeats, 37 cases and four variants produce **444 sequential requests**, each potentially containing several paid operations. `mode: evaluation`, disabled response cache and fresh trace IDs bypass answer and operation reuse. Provider-side prompt caching remains observable through cached-token usage.

## Prepare without paid calls

Run from the repository root with Node directly (the pnpm wrapper may reject the local Node engine):

```powershell
node --test scripts/lib/latency-report.test.mjs
node scripts/benchmark-answer-latency.mjs --dry-run --out output/latency
```

Dry run imports no database or worker runtime, reads no credentials, and performs no network calls. It writes the exact plan, frozen case definitions and an unreviewed authority template. An existing authority template is preserved.

Build the worker, answer-engine and database using the repository's existing build procedure before freezing. Keep those compiled outputs fixed through all variants. Supply organization/event IDs explicitly; the runner never copies historical fixture IDs. Supply the normal `.env` locally and do not include it in artifacts.

## Required source-authority preflight

Review the intended baseline corpus independently of the model's `verify` result. The original authored corpus is `output/pdf/qadam-content.json`, `tmp/pdfs/build_qadam.py`, the original PDFs, and the published source/version receipt. Verify that these really are the intended authoritative event documents, that publication/version IDs and PDF hashes match, and that competing relevant sources do not contradict them. Model agreement or successful provider verification does not establish source authority.

Copy `authority-template.json` to a separate reviewed file. For **every case**, record a rationale grounded in the original authored material. For answerable cases, add all allowed source/version references (page required for PDF passages), exact supporting excerpts, and nontrivial `requiredPatterns` that assert the complete answer, including conditions/negation. Each pattern is a JavaScript Unicode, case-insensitive regular expression. Match every requested part, not merely a few numbers. For example, rubric patterns must cover all five criterion/weight associations and the actual calculation; the allergy case must never promise personal safety. Refusal and ambiguous cases need an explicit rationale even when references are empty. Prefer allowing all authoritative equivalent citations rather than one arbitrarily preferred citation.

```json
{
  "reviewed": true,
  "reviewer": "person who independently reviewed the corpus",
  "reviewedAt": "ISO date",
  "cases": {
    "case-01": {
      "rationale": "Explain which published section establishes the complete rubric",
      "requiredPatterns": ["replace with independently reviewed completeness assertions"],
      "references": [{"sourceId":"actual UUID","versionId":"actual UUID","page":3,"quote":"exact supporting text from the indexed page"}]
    }
  }
}
```

The example is a schema illustration, not a usable authority file. Complete all 37 entries. The runner verifies references are published, participant-visible, ready and contain the exact reviewed excerpt. Regex checks and source membership are explicit regression checks, not a semantic proof; manually review substantive failures and sampled successes before making a quality decision.

```powershell
node --env-file=.env scripts/benchmark-answer-latency.mjs --freeze --org <org-uuid> --event <event-uuid> --authority <reviewed-authority.json> --out output/latency
```

Freeze performs database reads only; it makes no paid model calls and refuses to overwrite an existing snapshot. The snapshot contains source rows, all versions/chunks, test conversation histories, authority assertions, compiled-code hashes, retrieval configuration and existing budget settings. It contains no API keys. Keep it local if the event corpus is private. The runner compares this snapshot before and after every trial and stops on any change. This catches publication/content changes; it does not independently prove a mutable external vector service is unchanged. Keep embedding/reranking services, models and vector indexes fixed during the experiment.

## Verified tariff and live run

Obtain the actual tariff for the configured provider and exact model before running. Do not infer it from a similarly named model. Store only these fields in a JSON file, with the actual numeric rates:

```text
model: gpt-6-luna
endpoint: exact AI_CHAT_ENDPOINT URL
currency: USD
verified: true
verifiedAt: ISO date of verification
source: provider pricing page or attributable provider confirmation
inputMicrosPer1K: integer micro-USD per 1,000 uncached input tokens
cachedInputMicrosPer1K: finite nonnegative micro-USD per 1,000 cached input tokens (fractional allowed)
outputMicrosPer1K: integer micro-USD per 1,000 total completion tokens
```

Never put an API key in that file. The runner requires a preverified tariff; it does not contact a pricing endpoint. The verified Luna tariff for this experiment is input 4, output 20 and cached input 0.4 micro-USD per 1,000 tokens. The public provider marketplace group-1 rates were checked against an authenticated usage delta: 7,421 input tokens, 206 output tokens, no cache, two requests, and actual cost USD 0.0000338 versus the tariff estimate USD 0.000033804. Keep the attributable provider pricing source and verification date in the supplied tariff file.

The current provider ledger reserves using integer full input/output rates and rounds each operation upward; the report's tariff estimate preserves fractional micro-USD and accounts for the supplied cached-input rate. Reasoning tokens are reported separately but not charged a second time when included in completion tokens. If completion usage omits cached tokens, the report leaves them unknown and returns a null tariff estimate; it never infers zero.

```powershell
node --env-file=.env scripts/benchmark-answer-latency.mjs --run --org <org-uuid> --event <event-uuid> --authority <reviewed-authority.json> --tariff <verified-tariff.json> --out output/latency --seed 20261108 --verify-usage
```

`BENCH_ORGANIZATION_ID` and `BENCH_EVENT_ID` may replace ID flags. `--snapshot` selects a frozen snapshot; `--timeout-ms` defaults to 240000 per isolated child. Existing daily budgets and credential storage are unchanged. A budget exhaustion stops the run, leaving an incomplete report. A killed child can leave an uncertain reserved operation; the runner does not settle, delete or retry it. No resumptions or cross-run merging occur automatically; each run has a new UUID directory.

`--verify-usage` is optional and requires platform funding. It performs one authenticated GET to the provider origin's `/v1/usage` immediately before and after each sequential trial, using the existing platform key. It extracts only the `gpt-6-luna` model's request count, actual cost, input/output tokens and cache-read tokens, and stores their sanitized deltas. It never saves raw account usage, balance or the key. A valid model-stats array without a Luna entry means zero prior usage; missing or malformed counters remain unknown. No usage request is retried.

Actual cost is attributable only when the counter increase exactly matches the new provider operation count for that trial. Overlapping same-key Luna traffic, delayed counters, resets and failed usage reads leave `actualCostMicros` null. Keep Telegram and other same-key Luna calls idle during trials; run delivery smoke checks before or after the experiment. Exact count matching cannot detect coincidentally offsetting concurrent traffic, so account isolation remains necessary. Verified actual-cost deltas preserve fractional micro-USD and take precedence for billing analysis even when completion cache usage is absent. They do not fill missing per-operation token diagnostics.

The live run observed decreases in the provider's returned model statistics, including request/token counts. Their cause is not established; these responses are not treated as lifetime-monotonic billing counters. A decrease is retained as `usage_counter_reset` with unknown attributed cost. Known subtotals cannot establish a complete average cost or prove non-increasing cost when any request remains unattributed.

Reports are written after every attempted trial, preserving errors, timeouts, refusals, parse failures, all outcomes and all stage diagnostics. Cost includes all four possible operation stages (`understand`, `select`, `select-expanded`, `verify`), not just the first response. Unknown tariff estimates or actual attribution produce **null** totals with known subtotals retained. `costMicros` is the tariff estimate, `ledgerCostMicros` is the rounded reservation ledger's settled charge, and `actualCostMicros` is the attributable account usage delta. No raw provider payloads or credentials are copied into reports.

Per-language summaries show failures, incomplete answers and answerable questions refused. Useful-answer latency includes only complete passing answerable cases; correct-decision latency also includes correct refusals and clarification. General engine percentiles must never be interpreted as quality-adjusted performance. Percentiles use nearest rank; token summaries include cached and reasoning counts where reported. A missing duration is not zero. With three samples per case, individual-case p95 is simply the maximum; inspect distributions and quality failures, not just aggregate means.

Reports always leave `winner: null`. Incomplete or budget-truncated data cannot establish a winner. After a complete experiment, independently audit source authority, correctness and completeness, compare equal case/repeat samples and failure rates, then interpret speed/cost differences. A fast refusal, truncated answer or parser rejection is not a useful latency improvement.

## Browser delivery and correlation

`apps/mini-app/test/latency-delivery.browser.mjs` runs the actual Playground component and sequential polling against intercepted HTTP responses with fixed readiness times. Run it from `apps/mini-app` with a loopback Vite server. The old arm substitutes only the compiled polling schedule with 1500 ms; the new arm runs the current module unchanged. It asserts the old GET count, one active request and matching request IDs. Results are saved to `output/latency/browser-delivery.json`. This isolates delivery overhead; it does not call a model or establish live end-to-end speedup. Browser/route overhead can move an individual result across a poll boundary, so faster polling need not win every sample.

The browser emits `openfacto.playground.send_to_render` after React commits the verified decision. Its detail contains `requestId` and `traceId`; it does not contain question text. This measures DOM commit, not a guaranteed screen paint. A manual retry starts a new browser measurement, even if it reuses a durable request ID.

New Playground decisions optionally include `delivery` inside their existing JSON record: request ID, queue creation/claim timestamps, answer-ready timestamp, queue wait and worker duration. Queue timestamps use the database clock; worker duration uses the monotonic process clock. `answerReadyAt` is captured before the final access checks and persistence transaction, so it is not an exact durable-commit or browser-delivery timestamp. The remaining browser time includes HTTP, final persistence, polling and rendering. Per-HTTP `x-request-id` headers correlate POST/GET calls with API request logs. Old records without delivery or provider diagnostics remain readable.

Runtime total and stage costs are `null` when a provider operation has uncertain billing. Playground and evaluation results display `—`; an actual known zero still displays zero. Invalid content with complete known token usage is settled before rejection and retains its billed estimate. The reservation ledger is an estimate using configured full-token rates, not proof of the provider's final debit or prompt-cache discount.

## Immediate queue dispatch

The shared backend used a two-second recovery sweep both to discover newly committed questions and to discover ready Telegram outbox records. Those waits are separate from model inference and frontend polling. `requestBusinessWake()` now gives the in-process dispatcher an advisory signal after a Playground/webhook transaction commits and after a successful worker completes its durable cleanup. A failed handler does not trigger an immediate retry of itself. Moderator replies created outside those worker/ingress paths still use periodic recovery. SQL leases and the same RabbitMQ queues still fence duplicates; the signal contains no user content and is never the durable source of work.

The scheduler permits one active sweep and coalesces bursts, retaining one follow-up when a signal arrives during a sweep. A lost signal or a backend without a local subscriber still recovers on the two-second timer. Shutdown unsubscribes, stops new sweeps and drains the active sweep before closing PostgreSQL. Maintenance and ingestion scans retain a ten-second cadence instead of running more often because of user activity. `AI_IMMEDIATE_DISPATCH=0` disables advisory wake-ups for rollback and controlled measurement.

The live browser comparison uses A/B with immediate dispatch disabled to isolate instructions, then A with it enabled to isolate queue delivery. Every arm uses the new identical Playground polling schedule. The `queue-enabled` arm is stored separately from the model/instruction arms so its improvement cannot be attributed to a model or prompt. Server settings are set per process; operations are checked against the expected model, effort, compact-policy and combined-planning diagnostics. Failed requests and cost-attribution failures remain in their respective reports.

## Clarification evidence guard

Independent review found a fact embedded in a generated clarification without a verification stage. Both understanding and selection clarification paths now render the fixed localized clarification prompt rather than arbitrary model text. This adds no paid call and cannot publish an unverified event fact. The tradeoff is a less specific clarification question. Regression tests cover both paths and language selection; cache policy v3 prevents reuse of older clarification behavior. The frozen engine experiment predates this guard and remains unchanged. All later live browser arms use the guard equally, with their own runtime hashes; do not merge their timings with the earlier engine trials.

## Rollback

Keep `AI_CHAT_MODEL=gpt-6-luna`. Compact output is opt-in (`AI_COMPACT_OUTPUT=1`); unset or `0` keeps the original combined-planning instructions. The current experiment found new quality errors in compact/low-effort candidates, so they must not be promoted merely for lower latency. Clearing `AI_REASONING_EFFORT` omits the effort parameter. Restart the backend after configuration changes. Keep the verified key tariff and existing budget. Changes to prompt/effort participate in the response-cache policy, so results from another policy are not reused. Original instruction strings and legacy operation signatures without effort remain supported. `AI_IMMEDIATE_DISPATCH=0` independently restores the previous two-second queue discovery schedule.
