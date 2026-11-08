# Принятые решения

Эти ADR уточняют proposal v2.0. «Принято» обозначает выбор архитектуры;
реализацию и проверку отслеживает [backlog](BACKLOG.md).

| ADR | Решение | Причина и последствия |
| --- | --- | --- |
| 001 | Один NestJS backend: HTTP API, диспетчер и потребители RabbitMQ | Общая бизнес-логика/DI/SQL-транзакции; backend сам публикует и получает задания через брокер. Node-обработчики работают внутри процесса; Python PDF и локальный semantic runtime сохраняют свои границы. Выделять дополнительные Node-процессы по измеренной необходимости |
| 002 | Обязательный tenant scope на сервере | TenantContext из проверенной сессии и membership; SQL/Qdrant/S3 получают явный scope; LLM и браузер не авторизуют; RLS можно добавить позже как defense in depth |
| 003 | Общий versioned REST-контракт | Browser-safe `@openfacto/contracts`, `/api/v1`, единые статусы/ошибки/pagination; DTO не должны раскрывать строки SQL с секретами; runtime business validation добавляется вместе с endpoint |
| 004 | Асинхронная доставка через RabbitMQ; прежний Redis/BullMQ заменён | PostgreSQL хранит durable work ledger, dispatch leases и состояния попыток. Publisher confirms и manual acknowledgements дополняют SQL recovery sweep; DLQ изолирует некорректные сообщения. At least once допускает дубликаты; exactly once для внешних эффектов не обещается |
| 005 | Независимые релизы SPA и backend | React/Vite собирает статические assets; API и Node-обработчики запускаются одним backend-процессом; backward-compatible API и expand/contract migrations; SPA rollback не откатывает SQL |
| 006 | Бесплатные Arc UI, только концепт 7 | Прежний shadcn/ui из v2.0 заменён; новый desktop/mobile-макет требует отдельного апрува; raster logo требует точного SVG master; технический экран не является утверждённым дизайном |
| 007 | Локальные зависимости и opt-in telemetry | Compose PostgreSQL/RabbitMQ/Qdrant/private S3; JSON stdout logs; Qdrant/Turbo telemetry выключается настройками; экспорт OTEL/Observe, платные сервисы и AI не подключаются автоматически |
| 008 | UUIDv4, UTC, Telegram ID strings | Нет потери точности JS Number; даты с timezone; миграции и явные FK/unique constraints в packages/database |
| 009 | SeaweedFS mini для локального private S3 | Прежние MinIO images не загружаются; image 4.38 проверен, bucket создаётся через S3_BUCKET, credentials обязательны, admin UI/WebDAV/telemetry выключены |
| 010 | Единый движок и очередь `ai.questions` для Telegram и Playground | Оба входа исполняют одинаковую политику публикаций, цитат и бюджета с общей границей параллелизма consumer. Право создавать реальные обращения и исходящие сообщения принадлежит live-обработчику. [Контракт](AI-PIPELINE.md) |
| 011 | Бюджет платформы или ключ мероприятия | Каждый платный этап резервируется в SQL. Неопределённый результат сохраняет резерв до сверки. Переключение на другой источник оплаты выполняет администратор. |
| 012 | Асинхронный Playground: POST 202 + GET status | HTTP сохраняет работу без LLM-вызова. Статусы pending/running/completed/failed, автор и scope хранятся в SQL. Повтор того же ID и ввода переиспользует работу; changed payload возвращает 409. GET повторно проверяет права и все источники решения/trace |
| 013 | Миграция брокера без удаления данных | До нового backend применяются 0010/0011, старые BullMQ consumers останавливаются. Новые consumers восстанавливают незавершённые SQL-записи. Существующие Redis volumes сохраняются; автоматический wipe или одновременная работа старых и новых consumers не входят в переход |

Void/Cloudflare остаётся будущим адаптером публикации SPA, а не вторым backend.
`void/db`, `void/auth`, edge queues и Cloudflare Workers AI не становятся источниками
бизнес-логики. Первый этап не включает публичные preview/deploy.

Обратимость: static hosting можно заменить без изменения REST; PostgreSQL остаётся
source of truth при замене queue/vector store; PDF protocol отделяет Node и Python.
Переход на микросервисы, RLS, новую модель embeddings или hosting оформляется новым ADR
с измерениями, migration path и критериями проверки.
