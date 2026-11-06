# Модель угроз

Этап 0 не принимает production-данные, Telegram updates или PDF. Ниже разделены
действующие ограничения и требования будущих доменных этапов.

Границы доверия: браузер/Telegram → public API; API → SQL/Redis; worker → private S3/Qdrant;
worker → Python parser; worker → внешний AI provider. PDF и сообщения всегда untrusted.
Активы: credentials, сессии, права tenant, опубликованные знания, private PDF,
персональные данные сообщений, budgets и воспроизводимые source references.

| Угроза | Механизм и состояние | Этап / обязательная проверка |
| --- | --- | --- |
| Поддельная initData, replay | Запланировано: подпись, срок, replay/session policy; не доверять client user/tenant | 1: неверная подпись/старые данные отклонены |
| Чужой tenant/event, role escalation | Запланировано: серверный TenantContext, RBAC, scoped SQL/Qdrant/S3 | 1+: запросы всех ролей к двум tenant; worker scope mismatch |
| Утечка bot token/BYOK | Реализовано: no secret DTO, env separation, JSON logger redaction; credential vault ещё нет | 0: log/bundle checks; 3/6: encryption, masked responses, rotation |
| Webhook spoof/replay | Запланировано: secret header, server bot mapping, durable inbox UNIQUE(bot,update), outbox | 3: повторный update не повторяет side effects |
| Подмена/опасный PDF | Запланировано: upload scope, MIME/hash/size/page limits, карантин, bounded parser без лишнего egress | 4: invalid/oversize/encrypted PDF, timeout и retry |
| Prompt injection | Запланировано: evidence как данные, отсутствие tools с произвольным доступом, проверка источников | 4–6: adversarial fixtures, запрет cross-tenant retrieval и раскрытия секретов |
| Старый/удалённый источник | Запланировано: immutable versions, публикация и ACL перепроверяются в SQL после retrieval | 3–5: rollback, удаление, reindex race не возвращают старые данные |
| Недоступность Redis/SQL | Реализовано: bounded readiness, coalesced probes, отдельная liveness, graceful close | 0: unit/HTTP checks и реальные stop/recovery PostgreSQL/Redis пройдены |
| Worker crash / потерянная задача | Реализовано: отдельный BullMQ process и shutdown; durable outbox ещё запланирован | 3–5: crash/retry, side-effect дедупликация и восстановление backlog |
| Provider outage / runaway spend | Запланировано: timeout, retry budget, quotas/BYOK, отказ/FAQ/handoff | 5–6: отказ провайдера, исчерпанный бюджет, rate limit |
| Public bucket / infrastructure ports | Реализовано в Compose: loopback ports, anonymous S3 none, console disabled; runtime не проверен | 0: anonymous object GET denied; 7: private network/TLS/secret store |
| Логи содержат PII/секреты | Реализовано: фиксированные event IDs, нет request body/query logging, рекурсивное маскирование | 0: redaction unit tests; 6: audit/retention/access policy |

Env examples содержат только явно локальные credentials. Их нельзя использовать в публичном
развёртывании. Redis без пароля и Qdrant без API key допустимы здесь только на loopback.
Настройки production TLS, network policies и service identities относятся к этапу 7.

PDF-worker сейчас только loopback health scaffold без парсинга. Endpoint POST возвращает 501.
Перед включением job endpoint на этапе 4 нужны service authentication, schema/version,
allowlisted object reference (не произвольный URL), deadline, resource limits и идемпотентность.

Logger — минимальная локальная реализация, не универсальный DLP. Не передавать в event/fields
произвольный ввод или raw exception messages. Error stack и URL с credentials отбрасываются;
подключение внешнего log exporter/OTEL требует отдельной настройки и redaction review.
