# Модель угроз

Меры защиты и сценарии проверки сгруппированы по границе доверия.
Проверки доказательств, публикаций и доставки подробнее описаны в [AI-PIPELINE](AI-PIPELINE.md).

Границы доверия: браузер/Telegram → public API; backend → SQL/RabbitMQ; worker → private S3/Qdrant;
worker → Python parser; worker → внешний AI provider. PDF и сообщения всегда untrusted.
Активы: credentials, сессии, права tenant, опубликованные знания, private PDF,
персональные данные сообщений, budgets и воспроизводимые source references.

| Угроза | Механизм и состояние | Этап / обязательная проверка |
| --- | --- | --- |
| Поддельная initData, replay | подпись, срок, replay/session policy; не доверять client user/tenant | 1: неверная подпись/старые данные отклонены |
| Чужой tenant/event, role escalation | серверный TenantContext, RBAC, scoped SQL/Qdrant/S3 | 1+: запросы всех ролей к двум tenant; worker scope mismatch |
| Утечка bot token/BYOK | Реализовано: no secret DTO, env separation, JSON logger redaction; секреты ботов и BYOK шифруются с привязкой к контексту | 0: log/bundle checks; 3/6: encryption, masked responses, rotation |
| Webhook spoof/replay | secret header, server bot mapping, durable inbox UNIQUE(bot,update), outbox | 3: повторный update не повторяет side effects |
| Подмена/опасный PDF | upload scope, MIME/hash/size/page limits, закрытый оригинал, изолированный parser с лимитами | 4: invalid/oversize/encrypted PDF, timeout и retry |
| Prompt injection | evidence как данные, отсутствие tools с произвольным доступом, проверка источников | 4–6: adversarial fixtures, запрет cross-tenant retrieval и раскрытия секретов |
| Старый/удалённый источник | immutable versions, публикация и ACL перепроверяются в SQL после retrieval | 3–5: rollback, удаление, reindex race не возвращают старые данные |
| Недоступность RabbitMQ/SQL | Bounded readiness, отдельная liveness, восстановление соединения и graceful close | Реальные stop/recovery PostgreSQL/RabbitMQ проверены |
| Worker crash / потерянная задача | Consumers в NestJS backend; durable RabbitMQ, confirms/manual ACK, SQL inbox/outbox и dispatch leases | Повторная доставка и восстановление просроченных задач проверены; внешние эффекты не объявляются exactly once |
| Доступ к чужому AI-результату | Playground status привязан к actor/org/event; права и версии повторно проверяются при исполнении и чтении | Чужой request ID не раскрывает результат; отозванные источники и права блокируют выдачу |
| Provider outage / runaway spend | timeout, retry budget, quotas/BYOK, отказ/FAQ/handoff | 5–6: отказ провайдера, исчерпанный бюджет, rate limit |
| Public bucket / infrastructure ports | Реализовано в Compose: loopback ports, anonymous S3 none, console disabled; проверены anonymous GET и сохранность после перезапуска | 0: anonymous object GET denied; 7: private network/TLS/secret store |
| Логи содержат PII/секреты | Реализовано: фиксированные event IDs, нет request body/query logging, рекурсивное маскирование | 0: redaction unit tests; 6: audit/retention/access policy |

Env examples содержат только явно локальные credentials. Их нельзя использовать в публичном
развёртывании. RabbitMQ использует отдельные учётные данные, AMQP и management порты привязаны к loopback. Qdrant без API key допустим здесь только на loopback.
Настройки production TLS, network policies и service identities относятся к этапу 7.

Внутренний parser принимает байты PDF и секрет сервиса, проверяет размер и запускает
дочерний процесс с ограниченными ресурсами. В production требуется ограничить сеть и
файловую систему контейнера. Worker получает оригинал только по проверенному составному ключу.
Qdrant содержит позиции и векторы, текст и актуальная аудитория проверяются в SQL.
Токены Telegram и BYOK хранятся в зашифрованном виде, в браузер выдаётся статус настройки.
Угрозы повторного списания и дублирования сообщения проверяются раздельно. SQL хранит
резерв до вызова провайдера и состояние каждой отправляемой части сообщения.

Logger — минимальная локальная реализация, не универсальный DLP. Не передавать в event/fields
произвольный ввод или raw exception messages. Error stack и URL с credentials отбрасываются;
подключение внешнего log exporter/OTEL требует отдельной настройки и redaction review.
