# Local semantic retrieval

This separate Python environment serves CPU inference on **127.0.0.1:7312**. It uses safetensors, pinned Hugging Face revisions and `trust_remote_code=False`. Preparation downloads model files; serving and benchmarking can run with networking disabled. The public frontend never calls it directly.

```powershell
uv sync --locked --project apps/semantic-worker
apps/semantic-worker/.venv/Scripts/python.exe apps/semantic-worker/models.py
$env:HF_HUB_OFFLINE='1'
$env:TRANSFORMERS_OFFLINE='1'
apps/semantic-worker/.venv/Scripts/python.exe apps/semantic-worker/benchmark.py
node scripts/configure-semantic.mjs --apply
pnpm build
pnpm dev:local
```

`dev:local` starts the semantic service if needed and checks its pinned identity before starting the API. A compatible service already running is reused. To start it separately:

```powershell
apps/semantic-worker/.venv/Scripts/python.exe apps/semantic-worker/server.py --model e5
```

`GET /health` exposes the loaded model/revision and device, not questions or credentials. `POST /v1/embeddings` accepts model, revision, input array and `input_type=query|passage`. E5 receives its required `query: ` / `passage: ` prefix. `POST /v1/rerank` accepts a query and documents; returned indices can only reorder previously authorized candidates. Both endpoints reject browser Origin headers and bound request sizes. Models are serialized through a lock; this is a local development service, not a public inference gateway.

## Measured selection (2026-11-07)

120 synthetic queries, 12 event topics, including RU, KK, mixed speech, transliteration and incomplete words. The comparison uses the same full title/body corpus for all models. These are **retrieval metrics**, not end-to-end answer accuracy or production claims. Labels still require a Kazakh-speaking human review and a separate held-out corpus; there are no independent live-user samples in this set.

| Model | Hit@1 | Recall@3 |
| --- | ---: | ---: |
| Local character trigrams | 58.3% | 69.2% |
| multilingual MiniLM | 65.0% | 85.0% |
| multilingual E5 small | 79.2% | 88.3% |
| E5 + mMARCO MiniLM reranker (top 5) | 74.2% | 89.2% |

Selected **E5**. The reranker implementation is available but `RERANK_URL` remains empty because top-1 quality regressed. Do not enable it merely because it is neural. See `benchmark-results.json` for per-category results, misses, duration and exact model revisions. The benchmark does not measure no-answer calibration, LLM factuality, or extraction accuracy from real PDFs. `packages/answer-engine/test/quality-gates.test.ts` separately checks enforcement with controlled provider outputs, not live-model attack resistance.

Primary model references: [E5](https://huggingface.co/intfloat/multilingual-e5-small), [MiniLM](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2), [mMARCO reranker](https://huggingface.co/cross-encoder/mmarco-mMiniLMv2-L12-H384-v1).

## Reindex without deleting old data

After restarting the backend with the selected embedding settings and confirming the intended local DATABASE_URL:

```powershell
node --env-file=.env scripts/reindex-semantic.mjs
node --env-file=.env scripts/reindex-semantic.mjs --apply
```

The first command is read-only. The second prepares model-specific FAQ vectors and queues published PDFs missing the new collection for normal ingestion. Existing vector collections and FAQ caches remain. Never run PDF migration while another backend is serving the old chunk representation. FAQ caches are additive and safe to prepare before restart. Do not confuse a new model configuration with completed PDF ingestion: check pending jobs before testing answers.

On this machine the existing QA PostgreSQL container listens on **55432**, while the root `.env` currently points to **5432**. Use the intended database configuration; this task did not replace unrelated credentials or infrastructure settings.

## Verification

```powershell
pnpm --filter @openfacto/answer-engine test
pnpm --filter @openfacto/worker test
# From apps/worker, with the service running:
node --env-file=../../.env --test test/semantic-local.integration.mjs
```

Document chunks retain paragraph/list/table separators and repeat explicit section headings. Long prose splits at sentence boundaries first; pathological long sentences still require bounded overlapping cuts. PDF retrieval attaches adjacent chunks from the **same page/version/tenant**, preserving valid citation page numbers; cross-page qualifications are not automatically joined. Real scanned/table-heavy PDFs still need separate extraction/OCR evaluation.

The answer trace records stage duration and cost deltas. Evaluation results separate retrieval hit, outcome match and selected-source match. The independent verifier also receives the authorized shortlist to check contradictions. Exact single FAQ matches retain their existing fast path; this is **not** a global contradiction detector across all publications.

`retrievalHit` includes a successful `exact_faq` lookup and a completed ranked search. It is `null` when no expected source was labeled or the question was clarified before search completed; timing-only trace entries are not search results. Historical evaluation records are immutable: rerun them to obtain the corrected metric. The verifier receives the selected source with its claim only once, while other candidate sources/chunks remain available for contradiction checks.

For a real-provider check beyond the three demo FAQs, build the worker and run the isolated multi-source fixture from `apps/worker`:

```powershell
$env:OPENFACTO_TEST_WIKIVIBE='1'
node --env-file=../../.env --test test/multi-source-live.integration.mjs
```

Use the intended local database settings (including the QA port noted above). This opt-in suite makes billable calls to the configured chat provider. It creates a temporary event with two similar role-specific FAQs and four published text documents, checks eight RU/KK cases, and removes its own fixture afterward. Billing totals remain in the archived ledger. It prints per-stage timings/costs and exits unsuccessfully on a wrong source, missing condition, unsafe answer or technical failure. This tests text tables and published text retrieval; it does not test PDF extraction/OCR. Do not interpret one passing run as a population-level accuracy estimate.

Moderator feedback: publish the reviewed FAQ draft, then GET `/organizations/:org/events/:event/handoffs/:id/evaluation-case` as an editor/admin/owner. This returns a case plus the published reference answer for human review and submission to the existing evaluations endpoint. It neither publishes content nor starts paid evaluations automatically. Unpublished/internal drafts cannot be exported by this endpoint.
