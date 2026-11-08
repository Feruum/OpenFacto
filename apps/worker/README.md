# Backend background jobs

This package is a library loaded by the NestJS backend, not a separate service.
`startBackgroundJobs` is owned by Nest's lifecycle: the backend schedules durable
SQL jobs into RabbitMQ and consumes them in the same process. Startup is through
`pnpm --filter @openfacto/api start`; there is no standalone worker entry point.
The `dev` command watches compilation only. The Python PDF parser remains a separate runtime.

Runbook: [local services](../../docs/openfacto/RUNBOOK.md).

Telegram and Playground share the physical `ai.questions` queue and its
`WORKER_CONCURRENCY` limit within the backend. Both invoke the same AnswerEngine.
Playground HTTP requests persist work and return 202; the browser polls an authorized
GET endpoint for status and the completed decision. The HTTP handler does not call the LLM.
`documents.ingest`, `ai.evaluations` and `messages.delivery` separate ingestion,
evaluation and delivery from interactive questions.

PostgreSQL is the durable work ledger. Dispatch leases in `queue_dispatches` prevent
every sweep from republishing the same outstanding ID. Claim leases, attempt counts
and SQL state transitions fence execution and commit. The dispatcher awaits publisher
confirms, consumers manually acknowledge after the handler completes, and invalid
messages or unhandled failures go to `<queue>.dead`. The transport restores topology
and subscriptions after reconnect. SQL sweeps recover eligible work after lost
notifications or expired leases. Messages contain a job type and ID, not questions or secrets.
Delivery is at least once; neither RabbitMQ nor SQL deduplication promises exactly-once
external provider or Telegram effects. Preserve uncertain payment/delivery state for reconciliation.

Before starting this backend version, stop the old BullMQ consumers and apply migrations
`0010_async_playground` and `0011_queue_dispatches`. Existing SQL work is recovered by
the new dispatcher. Migration does not automatically wipe Redis keys or volumes.
Configure `RABBITMQ_URL` and matching Compose `RABBITMQ_DEFAULT_USER` /
`RABBITMQ_DEFAULT_PASS`; the checked-in example credentials are for local use only.
The local semantic Python environment and model weights are prepared separately;
`dev:local` can start the prepared loopback service without adding a second Node backend.

## Private PDF ingestion

The API creates a scoped version and writes its original to the private S3 bucket.
The worker recovers pending versions from PostgreSQL, verifies the SHA-256, then sends
the bytes to the authenticated [PDF parser](../pdf-worker/README.md). Page-bounded
chunks use stable IDs. PostgreSQL controls publication, access and citations. Qdrant
stores dense and sparse vectors, scope IDs and page positions. It never stores
document text. Scope filters constrain both search branches before reciprocal rank
fusion. The worker checks the active SQL version again before returning text.
Deleting a version durably schedules removal from S3 and each indexed collection.

If a replacement PDF contains unreadable pages, its version fails before indexing.
Version history lists the one-based pages requiring OCR or a replacement text layer.
Re-upload the corrected PDF (or remove intentionally blank pages) and publish the new
ready version. Participants continue using the previously published version meanwhile.

Required services use `DATABASE_URL`, `RABBITMQ_URL`, `S3_ENDPOINT`, `S3_BUCKET`,
`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `QDRANT_URL` and `PDF_WORKER_TOKEN`.
`PDF_WORKER_URL` defaults to `http://127.0.0.1:8001`. A secured Qdrant installation
can set `QDRANT_API_KEY`. The bucket must already exist and deny anonymous reads.

### Embedding options

Publishing an FAQ makes its immutable title and aliases eligible for background embedding.
The ingestion sweep dispatches at most 32 missing FAQ versions at a time. A SQL lease
prevents duplicate inference across workers and schedules retries after failures. The
cache key includes the representation, model revision and output dimension. A model
change queues new vectors, and rollback can reuse a vector already computed for the
restored version.

An exact FAQ match uses PostgreSQL alone. For a paraphrase, the worker embeds the question
once and scores every authorized current FAQ version against its cached vector in SQL.
It combines cosine similarity with term coverage. Unindexed versions still participate
in lexical retrieval. Preview can reuse a published question's vector when its title
and aliases match the draft. A changed draft uses lexical retrieval until publication.
FAQ cache entries are private to the organization/event and cascade on version deletion.

Run `node --env-file=.env --test apps/worker/test/ingestion-faq.integration.mjs` with
a migrated test database to check all 55 fixture publications, model changes, retries,
scope revocation, and exact answers with the inference and queue services offline.

By default the worker computes a 256-dimensional character-trigram vector on its own CPU.
The sparse branch uses BM25 term saturation and Qdrant IDF. Final reranking combines
query-term coverage and the fused rank score. The CPU baseline supports all three
alphabets, with semantic paraphrase quality depending on the model selected.

To use a local multilingual model, serve an OpenAI-compatible embeddings implementation
on the same machine and set all four environment variables in the API and worker.

| Variable | Value |
| --- | --- |
| `EMBEDDING_URL` | `http://127.0.0.1:8082/v1/embeddings` or literal IPv6 loopback |
| `EMBEDDING_MODEL` | The pinned model ID sent in the request and echoed by the local runtime |
| `EMBEDDING_REVISION` | Immutable revision or artifact digest of the installed model |
| `EMBEDDING_DIMENSIONS` | Actual output dimension (8–4096) |

Requests use batches of up to 16 texts, ten-second timeouts and bounded responses.
The endpoint must return the configured model ID and one finite, nonzero vector per input.
Use a locally installed model with the pinned weights. Requests carry no credentials
and redirects fail. The model ID, revision and dimension determine the collection name.
Changing these settings requires reindexing version rows through the ingestion queue.
Keep API and worker on the same settings throughout a rollout. In production, stage
and verify the new index before switching traffic. The live worker updates the selected
collection only and keeps the old collection until version deletion.

### Verification

Start PostgreSQL, RabbitMQ, Qdrant, the private S3 bucket and the locked Python worker. Set the
service environment variables above, apply database migrations and build the worker.
Run from the repository root:

```sh
node --env-file=.env --test apps/worker/test/ingestion.integration.mjs
```

This test creates and cleans up its own tenant, PDF, scoped points and S3 key. It checks
anonymous-read denial, idempotent indexing, draft and published retrieval, cross-tenant
denial, immediate revocation and durable purge.

### Retrieval evaluation

Run `node --env-file=.env --test apps/worker/test/ingestion-eval.integration.mjs`
against Qdrant. The fixture creates a new temporary collection and deletes it after the
run. It indexes 12 labeled passages, asks a direct and a paraphrased question for each
and ranks the same passages four ways. Each of RU, KK and EN has eight questions.
The result includes language-level precision at rank 1, recall/MRR/nDCG at rank 3 and
a hash of the corpus, model and ranking settings. To evaluate another model, configure
the loopback model variables, rebuild if needed, and run the same command.

Measured on Qdrant 1.15.5 with `local-char-trigrams-v1`, 256 dimensions,
candidate depth 16, on 2026-11-07:

| Retrieval | Precision@1 | Recall@3 | MRR@3 | nDCG@3 |
| --- | ---: | ---: | ---: | ---: |
| Dense character features | 0.625 | 0.750 | 0.688 | 0.704 |
| BM25 | 0.542 | 0.583 | 0.556 | 0.563 |
| Dense + BM25 RRF | 0.625 | 0.750 | 0.681 | 0.698 |
| RRF + term-coverage reranking | 0.625 | 0.750 | 0.681 | 0.698 |

Reranked hybrid Recall@3 was 0.625 for RU, 0.875 for KK and 0.750 for EN.
The dense baseline produced slightly better MRR on this fixture. Reranking did
not improve the aggregate scores. Model selection and relevance thresholds
require more labeled questions from actual events.
Config hash: `4f1247887ccc4bb8ad4c6619b411ee5841a2dad74d1b3c0cdb3fc37911c7d1ec`.

The same benchmark also ran with 384-dimensional CPU embeddings from the quantized
multilingual MiniLM model. ONNX Runtime used local weights and mean-pooled token
outputs with the attention mask.

| Retrieval with MiniLM | Precision@1 | Recall@3 | MRR@3 | nDCG@3 |
| --- | ---: | ---: | ---: | ---: |
| Semantic dense | 0.750 | 1.000 | 0.875 | 0.908 |
| BM25 | 0.542 | 0.583 | 0.556 | 0.563 |
| Semantic dense + BM25 RRF | 0.667 | 0.958 | 0.806 | 0.845 |
| RRF + term-coverage reranking | 0.750 | 0.917 | 0.833 | 0.855 |

With MiniLM, hybrid reranking improved precision at rank 1 over RRF, with lower
recall at rank 3. Semantic dense found the relevant passage in the first three
positions for each of the 24 questions. The semantic reranked hybrid Recall@3
was 0.875 in RU, 1.000 in KK and 0.875 in EN.
Config hash: `af8721a61eb0b05d0f30b0e2e13d9e5b1c344dd79a28d83cd61bbbaee514a21f`.

For the exact CPU profile, obtain `onnx/model_quint8_avx2.onnx` and `tokenizer.json`
from the [pinned publisher revision](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2/tree/e8f8c211226b894fcb81acc59f3b34ba3efd5f42).
Run the following fixture on an AVX2-capable x86_64 host. It checks both SHA-256
digests before starting a loopback-only inference service with offline weights.

```sh
uv run --with onnxruntime==1.24.4 --with tokenizers==0.22.2 \
  apps/worker/test/ingestion-embedding-fixture.py /path/to/model_quint8_avx2.onnx /path/to/tokenizer.json
```

Set `EMBEDDING_URL=http://127.0.0.1:58082/v1/embeddings`,
`EMBEDDING_MODEL=sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`,
`EMBEDDING_REVISION=e8f8c211226b894fcb81acc59f3b34ba3efd5f42-quint8-avx2`
and `EMBEDDING_DIMENSIONS=384`, then rerun the benchmark. Stop the fixture when
finished. The model files are external artifacts and ordinary development uses the
built-in CPU baseline.
