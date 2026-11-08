# Conversational Answers Implementation Plan

**Goal:** Answer colloquial RU, mixed RU/KK, transliteration and recoverable fragments with cited evidence; clarify ambiguity.

**Architecture:** One server policy pipeline, budgeted query understanding, multilingual retrieval and verified responses. Bounded conversation context in both channels; opt-in loopback-only local workspace.

**Tech Stack:** Existing TypeScript/NestJS, PostgreSQL, BullMQ, React and Vite.

- [x] Add failing policy tests in packages/answer-engine/test/conversation.test.ts: preserve original query, cross-language selection/translation, explicit clarification, context and source revocation. Run `pnpm --filter @openfacto/answer-engine test` and confirm failures.
- [x] Implement conversation/interpretation contracts in packages/answer-engine/src and wire provider understand/select/verify and bounded multi-query retrieval in apps/worker/src. Validate model JSON, preserve original text, keep exact FAQ free and require verification for translations. Re-run policy and worker tests.
- [x] Add bounded context parsing and replay fingerprint tests; wire API playground, Telegram context and Playground reset controls. Test malformed contexts and prevention of cross-mode reuse.
- [x] Add local-login boundary tests before implementing apps/api/src/product/local-demo.controller.ts. Register only for explicitly enabled development loopback config; require matching Origin/Host and loopback peer. Bootstrap a new scoped workspace with ordinary sessions; wire explicit Vite local mode.
- [x] Build and run SQL/API/browser integrations on isolated infrastructure. Exercise original screenshot, mixed language, transliteration, ambiguous fragment, follow-up and negation against live provider without raising configured spend limits.
- [x] Document startup, actual quality results and limits; run full lint/typecheck/unit/build and SPA secret scan. Leave local UI connected for user review.

Execute inline in existing working tree to preserve user's extensive uncommitted changes. No unrelated commits or refactors.
