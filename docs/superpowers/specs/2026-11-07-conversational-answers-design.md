# Conversational answers

Approved in chat: architecture explanation followed by “работай”.

Preserve original participant text and bounded conversation turns. After the free exact-FAQ path, a budgeted server-side interpretation produces up to three retrieval queries or a concrete clarification. Retrieval crosses RU/KK/EN while keeping organization, event, visibility and version constraints. Selection and verification see the original question, context and interpretation; rewritten queries are never evidence. Cross-language FAQ answers are translated only through a verified model result. Ambiguous fragments clarify; missing providers use an explicit technical response.

Telegram and authenticated Playground use runScopedAnswer. Store up to three recent turns, expire them after ten minutes, and isolate Telegram context by organization/event/bot/chat/thread/user. Playground clears context on mode, language, FAQ-only or event changes and offers a new-conversation action.

Provide opt-in local development login guarded by actual API bind configuration, loopback peer and exact loopback Origin/Host. It creates an isolated synthetic organizer/event with published example FAQs and ordinary scoped sessions. Disabled in production and without explicit LOCAL_DEMO_ENABLED. Vite opts in with VITE_LOCAL_DEMO; otherwise the offline sample remains labelled and cannot pretend to run AI.

No model keys in the frontend, no unbounded automatic query expansion, no relaxation of source access, no guessing from similarity alone, no replacement of the deployment's embedding model without evaluation. Verify policy/validation with deterministic tests and language quality separately against the configured live provider within its current budget.
