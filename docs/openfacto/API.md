# REST-контракт

Реализованный browser-safe пакет: `@openfacto/contracts`. Экспортирует DTO, locale
`ru | kk | en`, роли, статусы событий, cursor pagination, health-типы и ошибки.
Это контракт TypeScript, а не универсальная runtime-валидация входных бизнес-запросов:
схемы валидации будут добавлены вместе с endpoint на этапе 1+.

| Endpoint | Состояние | Ответ |
| --- | --- | --- |
| `GET /health/live` | Реализовано | `200 {"status":"ok"}`; без SQL/Redis |
| `GET /health/ready` | Реализовано | 200 при доступности PostgreSQL и Redis; иначе 503 |
| `/api/v1/*` | Запланировано | Бизнес-API; сейчас возвращает 404 |
| `/webhooks/telegram/*` | Запланировано, этап 3 | Отдельный ingress; не browser API |

Readiness выполняет настоящий `SELECT 1` и Redis `PING` (с AUTH/SELECT/TLS по URL).
Проверки параллельны, ограничены `DEPENDENCY_TIMEOUT_MS` (100–10000 ms, default 2000),
одновременные probes объединяются. Следующий probe повторяет проверку, позволяя восстановиться.
SQL connect/statement timeout также ограничены. Зависимости закрываются при shutdown.

```json
{"status":"unavailable","dependencies":{"postgres":"up","redis":"down"}}
```

Health — отдельный operational-контракт с этой формой тела. Ошибки обычных HTTP-запросов:

```json
{"code":"NOT_FOUND","message":"Resource not found","requestId":"UUIDv4"}
```

Коды: `VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`,
`RATE_LIMITED`, `DEPENDENCY_UNAVAILABLE`, `INTERNAL_ERROR`. Внутренние сообщения исключений
не возвращаются. Сервер создаёт собственный `x-request-id`; входному значению не доверяет.
Ошибки неизвестных URL нормализуются и вне `/api/v1`: после регистрации Nest routes
добавлены завершающие JSON fallback handlers. `configureHttp` асинхронна и инициализирует приложение.

Health и ошибки получают `Cache-Control: no-store`. Логи содержат requestId, HTTP status
и duration; payload, query string и секреты в request logs не попадают.
CORS разрешает один точный `MINI_APP_ORIGIN`; wildcard не принимается.

Запланированные группы:

| Этап | API | Проверяемый сценарий |
| --- | --- | --- |
| 1 | `POST /api/v1/auth/telegram`, сессии, organizations, events, memberships | Подпись/срок initData; роли; tenant isolation |
| 3 | bots, FAQ, publications, versions, rollback | Secret не возвращается; повтор webhook без side effects |
| 4 | documents, upload intents, ingestion jobs, source access | ACL, лимиты, идемпотентность и защищённые source URLs |
| 5 | answers, citations, handoffs, moderator replies | Только актуальные источники; отказ без evidence |
| 6 | credentials/BYOK, quotas, usage, audit, evals | Маскирование секретов, budgets и права |

Создание организации: `CreateOrganizationDto {name}`. Создание мероприятия:
`CreateEventDto {name}`; organizationId задаётся проверенным сервером scope маршрута.
DTO описывают публичные поля, а не database rows. Присланные role/tenant/status никогда
не становятся полномочиями без серверной проверки. Session transport/CSRF policy
будут приняты вместе с Telegram auth; stage 0 не создаёт фиктивную сессию.

Pagination: `{items: T[], nextCursor: string | null}`; параметры `cursor` и `limit`.
На этапе 1 принять default 20, max 100; opaque cursor кодирует `(createdAt, id)` и tenant,
валидируется сервером, сортировка стабильная. Текущая SQL-схема даёт tenant index по
`(organization_id,id)`; индекс для фактической сортировки добавляется в доменном этапе.

Все UUID — UUIDv4, Telegram IDs — десятичные JSON strings; даты — UTC ISO 8601.
Секретные bot tokens, provider keys, initData и внутренние storage keys не входят в DTO.
SPA импортирует только contracts; server config/logger/database запрещены её графу импортов.
`pnpm check:spa` проверяет собранные assets на server secret markers и переданные значения
секретов; это дополнительная проверка, а не доказательство отсутствия любого возможного секрета.
