# RabbitMQ shared AI implementation plan

**Goal:** RabbitMQ replaces BullMQ and one AI queue serves Telegram and Playground.
**Architecture:** SQL work ledgers plus recoverable RabbitMQ notifications; one backend process; tenant-scoped asynchronous Playground.
**Tech Stack:** TypeScript, NestJS, amqplib, PostgreSQL/Drizzle, React, RabbitMQ.

- [x] Transport/runtime: add typed RabbitMQ transport with confirmed publish, durable topology, bounded prefetch, manual ack, reconnect and shutdown; replace business/runtime BullMQ integration; adapt ingestion queue port. Test failures then broker integration.
- [x] Configuration/infra: replace Redis dependency with RabbitMQ in config, health, Compose, env examples and local verification. Update corresponding unit/integration/e2e tests; preserve single-backend startup.
- [x] Durable Playground: migration/schema, worker claim/execute/fenced commit, POST enqueue and scoped GET status; add API regressions for pending/replay/role revocation/tenant isolation and shared queue.
- [x] Frontend: POST then poll; preserve existing Decision-facing interface, pending recovery and error semantics; browser test.
- [x] Install dependencies centrally, apply migration to QA DB, run all checks and broker recovery tests; independent review and fixes; update architecture and runbook with actual results.

Results: [RabbitMQ verification, 2026-11-08](../../openfacto/CHECK-RABBITMQ-2026-11-08.md).

Work in the existing authorized dirty workspace; no commits or destructive resets. Ownership is assigned explicitly to independent agents; root owns Playground API/data/worker handler and integration.
