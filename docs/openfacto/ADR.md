# Принятые решения

Эти ADR уточняют proposal v2.0. «Принято» обозначает выбор архитектуры;
реализацию и проверку отслеживает [backlog](BACKLOG.md).

| ADR | Решение | Причина и последствия |
| --- | --- | --- |
| 001 | Modular monolith NestJS + отдельные workers | Единая бизнес-логика/DI/SQL-транзакции; отдельный CPU/runtime PDF; сервисы выделять по измерениям, не по названиям доменов |
| 002 | Обязательный tenant scope на сервере | TenantContext из проверенной сессии и membership; SQL/Qdrant/S3 получают явный scope; LLM и браузер не авторизуют; RLS можно добавить позже как defense in depth |
| 003 | Общий versioned REST-контракт | Browser-safe `@openfacto/contracts`, `/api/v1`, единые статусы/ошибки/pagination; DTO не должны раскрывать строки SQL с секретами; runtime business validation добавляется вместе с endpoint |
| 004 | Асинхронная доставка через Redis/BullMQ | At least once, ограниченные retries/backoff; inbox/outbox и side-effect дедупликация в PostgreSQL появятся в этапе 3; job success не равен публикации без SQL state transition |
| 005 | Независимые релизы SPA и backend | React/Vite собирает статические assets; API и workers живут отдельно; backward-compatible API и expand/contract migrations; SPA rollback не откатывает SQL |
| 006 | Бесплатные Arc UI, только концепт 7 | Прежний shadcn/ui из v2.0 заменён; новый desktop/mobile-макет требует отдельного апрува; raster logo требует точного SVG master; технический экран не является утверждённым дизайном |
| 007 | Локальные зависимости и opt-in telemetry | Compose PostgreSQL/Redis/Qdrant/private S3; JSON stdout logs; Qdrant/Turbo telemetry выключается настройками; экспорт OTEL/Observe, платные сервисы и AI не подключаются автоматически |
| 008 | UUIDv4, UTC, Telegram ID strings | Нет потери точности JS Number; даты с timezone; миграции и явные FK/unique constraints в packages/database |
| 009 | SeaweedFS mini для локального private S3 | Прежние MinIO images не загружаются; image 4.38 проверен, bucket создаётся через S3_BUCKET, credentials обязательны, admin UI/WebDAV/telemetry выключены |

Void/Cloudflare остаётся будущим адаптером публикации SPA, а не вторым backend.
`void/db`, `void/auth`, edge queues и Cloudflare Workers AI не становятся источниками
бизнес-логики. Первый этап не включает публичные preview/deploy.

Обратимость: static hosting можно заменить без изменения REST; PostgreSQL остаётся
source of truth при замене queue/vector store; PDF protocol отделяет Node и Python.
Переход на микросервисы, RLS, новую модель embeddings или hosting оформляется новым ADR
с измерениями, migration path и критериями проверки.
