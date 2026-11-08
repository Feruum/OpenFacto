# RabbitMQ and shared AI execution

Approved by user: migrate BullMQ to RabbitMQ; route Telegram and Playground through one AI queue; verify all tests.

Keep one NestJS backend owning background consumers, current AnswerEngine, semantic/PDF services and tenant boundaries. Do not revert concurrent work or split into new deployed microservices.

RabbitMQ is transport. PostgreSQL remains durable work ledger: telegram_inbox/outbox, ingestion/evaluation rows and extended playground_requests. SQL recovery sweeps republish eligible IDs with publisher confirms; manual acknowledgements follow handler completion. Duplicate deliveries are expected and fenced by SQL claim leases and attempt numbers. Bounded retries end in explicit failure; malformed messages go to a dead-letter queue. Reconnect resumes topology and consumers. No secret/question text in broker messages.

One physical ai.questions queue handles telegram and playground jobs with a shared concurrency bound. Other queues isolate documents, evaluation and delivery. Telegram reuses existing durable inbox and delivery guarantees. Playground POST returns 202 {requestId,status}; GET playground/:id returns authorized status/decision. Both channels invoke the same answer policy from consumers. No LLM invocation in the Playground HTTP request.

Playground persists actor, scope, original input, fingerprint, trace ID, status, attempts and lease. Same request ID and payload reuses the job; changed payload conflicts. Polling is actor- and scope-bound and rechecks source visibility including trace candidates. Workers recheck membership/event before execution and at commit. Results and completed status commit atomically; retries reuse trace ID for AI payment idempotency. Expired leases are recoverable, old completed requests remain readable, old incomplete rows fail explicitly.

Frontend polls the durable request using existing playground(): Promise<Decision> interface, displays working state and retains idempotency on network retry. No RabbitMQ or credentials in the browser.

Verification: failing contract tests first; broker confirms/ack, duplicate and recovery tests; access/revocation/context/idempotency API integration; Telegram and Playground actual shared-queue integration; frontend browser scenario; all lint/typecheck/unit/build, SQL/API/worker/Python integration and e2e commands available. Run on isolated local infrastructure. Document any genuinely unavailable external checks, never count skips as passes.
