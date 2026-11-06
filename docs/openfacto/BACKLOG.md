# Последовательный backlog и приёмка

Этап 0: фундамент. Затем этапы 1–7 идут по порядку; каждый заканчивается пользовательским
сценарием с реальным API в готовом UI. Статусы ниже отражают код и фактические проверки;
наличие проектного DTO не означает готовности endpoint.

| ID | Требование | Этап | Состояние | Критерий приёмки |
| --- | --- | --- | --- | --- |
| F01 | pnpm Workspaces/Turbo, React/Vite, NestJS | 0 | Проверено | Чистая frozen install, root check на Node 24/26; общий dev запускает SPA/API/worker |
| F02 | Общие contracts/config/logger/TypeScript | 0 | Проверено | Все пакеты и приложения собираются; contracts используются API и SPA |
| F03 | Env validation и безопасные примеры | 0 | Проверено | Нет значений секретов в ошибках, URL/port/origin/concurrency bounds проверены unit tests |
| F04 | PostgreSQL/Redis/Qdrant/private S3 в Compose | 0 | Проверено частично | Все healthy, S3 private; после down/up подтверждены PostgreSQL/Redis, финальный Qdrant/S3 readback ещё повторить |
| F05 | Drizzle baseline: users/orgs/memberships/events | 0 | Проверено | Generator без diff, migrate дважды на чистой БД, реальные SQL/ORM integration tests |
| F06 | UUIDv4, UTC, Telegram ID strings | 0 | Проверено | UUIDv4, большой decimal Telegram ID, SQL UTC и ORM Date проверены |
| F07 | API live/ready, errors/requestId, CORS | 0 | Проверено | Unit/HTTP e2e/real dependency integration; отказ PostgreSQL/Redis даёт ready=503 при live=200, recovery=200 |
| F08 | Отдельный Node BullMQ worker | 0 | Проверено | Отдельный процесс потребляет smoke job из Redis и корректно завершается |
| F09 | Python-worker и uv | 0 | Проверено | Locked sync, Ruff, 6 unit/startup и 1 HTTP integration проходят на Python 3.12 и 3.14 |
| F10 | CI lint/typecheck/test/build/migrations/Python | 0 | Проверено частично | Все команды workflow прошли локально в чистой копии на Node 24/Python 3.12; GitHub Actions run ещё не запущен |
| F11 | Структурированные логи, без внешней телеметрии | 0 | Проверено | Redaction tests и JSON runtime logs проверены; внешние exporters не подключены |
| F12 | Сохранённый v2.0, актуальные docs/ADR/диаграммы | 0 | Реализовано | Архитектура/API/данные/runbook/угрозы/backlog согласованы с кодом |
| F13 | Сборка SPA без секретов | 0 | Проверено | Typecheck/SPA build/bundle-marker scan; integration запрета импорта server modules добавляется по мере роста |
| A01 | Telegram initData и сессии | 1 | Запланировано | Подпись, срок, replay/logout/session expiry; секреты не попадают в SPA |
| A02 | Организации, мероприятия, memberships и роли | 1 | Запланировано | Создать organization/event; две организации не видят данные друг друга; last-owner и role checks |
| U01 | Новый desktop/mobile-макет концепта 7 | 2 | Запланировано | Отдельно согласован новый макет; апрув знака недостаточен |
| U02 | Бесплатные Arc UI, RU/KK/EN, typed demo adapter | 2 | Запланировано | Доступные mobile/desktop экраны; locale switching; demo и API adapters одного контракта |
| T01 | Manager Bot и подключение клиентских ботов | 3 | Запланировано | Проверка token, encrypted credentials, activation aliases/mentions/replies/commands/privacy rules |
| T02 | Webhook inbox/outbox, dedup и retries | 3 | Запланировано | Duplicate update, worker crash и повторная доставка не дублируют ответ |
| K01 | FAQ CRUD, drafts, aliases, publish, versions/rollback | 3 | Запланировано | Редактор публикует FAQ; Telegram возвращает утверждённый ответ; rollback воспроизводим |
| D01 | Protected PDF upload и PyMuPDF | 4 | Запланировано | PDF проходит size/MIME/ACL/quarantine; страницы и ошибки парсинга воспроизводимы |
| D02 | Ingestion queues, embeddings, Qdrant | 4 | Запланировано | Idempotent indexing с tenant/event/version; worker failure восстанавливается |
| D03 | Hybrid retrieval и reranking | 4 | Запланировано | RU/KK/EN golden set; Recall@K/MRR/nDCG сравниваются с dense baseline |
| R01 | FAQ → grounded RAG → clarify/refuse/handoff | 5 | Запланировано | Только актуальные разрешённые источники; неизвестный вопрос не порождает выдуманный ответ |
| R02 | Moderator reply и FAQ draft | 5 | Запланировано | Обращение доходит модератору; ответ доставлен; draft создаётся только по выбору, не autopublish |
| Q01 | BYOK, budgets, quotas и provider failure policy | 6 | Запланировано | Keys masked/encrypted; budget/rate-limit/provider outage tests |
| Q02 | Analytics, audit, multilingual/adversarial evals | 6 | Запланировано | Воспроизводимые eval runs, cost/latency, source grounding, права и retention |
| O01 | Staging и независимые deployment pipelines | 7 | Запланировано | Раздельные SPA/backend releases; compatible rollout и rollback |
| O02 | Monitoring, backup restore, load checks/runbooks | 7 | Запланировано | Из backup восстановлен пользовательский сценарий, измерены пределы нагрузки |

Приёмка этапа 0: clean install → dependencies healthy → migrate → API live/ready →
Node smoke/Python startup → shared contracts build → CI. Затем dependency stop/recovery,
перезапуск без потери данных и SPA secret scan. Основные проверки пройдены; до полной
приёмки остаются повторный readback Qdrant/S3 после restart и удалённый CI run.
Смотреть [VERIFICATION](VERIFICATION.md).

Полный сквозной критерий этапов 1–7: организатор создаёт мероприятие, публикует знания;
участник получает подтверждённый ответ с источниками; неизвестный вопрос доходит до
модератора, который отвечает и при необходимости создаёт FAQ-черновик.

Обязательные regression gates доменных этапов: все роли; cross-tenant SQL/Qdrant/S3/API/worker;
повторные webhook; старые/удалённые источники; worker restart; provider outage; отсутствие
секретов в DTO/logs/SPA. Реальные боты и AI включаются только после настройки соответствующего
этапа. Публичных деплоев в этапе 0 нет.
