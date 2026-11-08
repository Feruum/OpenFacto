# Последовательный backlog и приёмка

Этап 0: фундамент. Затем этапы 1–7 идут по порядку; каждый заканчивается пользовательским
сценарием с реальным API в готовом UI. Статусы ниже отражают код и фактические проверки;
наличие проектного DTO не означает готовности endpoint.

| ID | Требование | Этап | Состояние | Критерий приёмки |
| --- | --- | --- | --- | --- |
| F01 | pnpm Workspaces/Turbo, React/Vite, NestJS | 0 | Проверено | Чистая frozen install, root check на Node 24/26; общий dev запускает SPA/API/worker |
| F02 | Общие contracts/config/logger/TypeScript | 0 | Проверено | Все пакеты и приложения собираются; contracts используются API и SPA |
| F03 | Env validation и безопасные примеры | 0 | Проверено | Нет значений секретов в ошибках, URL/port/origin/concurrency bounds проверены unit tests |
| F04 | PostgreSQL/RabbitMQ/Qdrant/private S3 в Compose | 0 | Проверено | Все четыре сервиса вернули сохранённые данные после down/up. Persistent RabbitMQ-сообщение сохранилось; анонимное чтение S3 отклонено |
| F05 | Drizzle baseline: users/orgs/memberships/events | 0 | Проверено | Generator без diff, migrate дважды на чистой БД, реальные SQL/ORM integration tests |
| F06 | UUIDv4, UTC, Telegram ID strings | 0 | Проверено | UUIDv4, большой decimal Telegram ID, SQL UTC и ORM Date проверены |
| F07 | API live/ready, errors/requestId, CORS | 0 | Проверено | Unit/HTTP e2e/real dependency integration; отказ PostgreSQL/RabbitMQ даёт ready=503 при live=200, recovery=200 |
| F08 | RabbitMQ consumers внутри NestJS backend | 0 | Проверено | Telegram и Playground исполняются через ai.questions; SQL retries, confirms/ack, лимиты и graceful shutdown проверены |
| F09 | Python-worker и uv | 0 | Проверено | Locked sync, Ruff, 6 unit/startup и 1 HTTP integration проходят на Python 3.12 и 3.14 |
| F10 | CI lint/typecheck/test/build/migrations/Python | 0 | Проверено частично | Фундамент прошёл локальные проверки и GitHub Actions. Текущие доменные изменения проверяются локально |
| F11 | Структурированные логи, без внешней телеметрии | 0 | Проверено | Redaction tests и JSON runtime logs проверены; внешние exporters не подключены |
| F12 | Сохранённый v2.0, актуальные docs/ADR/диаграммы | 0 | Реализовано | Архитектура/API/данные/runbook/угрозы/backlog согласованы с кодом |
| F13 | Сборка SPA без секретов | 0 | Проверено | Typecheck/SPA build/bundle-marker scan; integration запрета импорта server modules добавляется по мере роста |
| A01 | Telegram initData и сессии | 1 | Проверено локально | Подпись, срок, replay/logout/session expiry; секреты не попадают в SPA |
| A02 | Организации, мероприятия, memberships и роли | 1 | Проверено локально | Создать organization/event; две организации не видят данные друг друга; last-owner и role checks |
| U01 | Новый desktop/mobile-макет концепта 7 | 2 | Макет реализован, ожидает просмотра | Отдельно согласован новый макет; апрув знака недостаточен |
| U02 | Бесплатные Arc UI, RU/KK/EN, typed demo adapter | 2 | Проверено локально | Доступные mobile/desktop экраны; locale switching; demo и API adapters одного контракта |
| T01 | Manager Bot и подключение клиентских ботов | 3 | Реализовано, реальный webhook ожидает HTTPS | Проверка token, encrypted credentials, activation aliases/mentions/replies/commands/privacy rules |
| T02 | Webhook inbox/outbox, dedup и retries | 3 | Проверено локально | Duplicate update, worker crash и повторная доставка не дублируют ответ |
| K01 | FAQ CRUD, drafts, aliases, publish, versions/rollback | 3 | Проверено локально | Редактор публикует FAQ; Telegram возвращает утверждённый ответ; rollback воспроизводим |
| D01 | Protected PDF upload и PyMuPDF | 4 | Проверено локально | PDF проходит size/MIME/ACL/quarantine; страницы и ошибки парсинга воспроизводимы |
| D02 | Ingestion queues, embeddings, Qdrant | 4 | Проверено локально | Idempotent indexing с tenant/event/version; worker failure восстанавливается |
| D03 | Hybrid retrieval и reranking | 4 | Измерено на 24 вопросах | RU/KK/EN golden set; Recall@K/MRR/nDCG сравниваются с dense baseline |
| R01 | FAQ → grounded RAG → clarify/refuse/handoff | 5 | Проверено с WikiVibe | Только актуальные разрешённые источники; неизвестный вопрос не порождает выдуманный ответ |
| R02 | Moderator reply и FAQ draft | 5 | Проверено с тестовой доставкой | Обращение доходит модератору; ответ доставлен; draft создаётся только по выбору, не autopublish |
| Q01 | BYOK, budgets, quotas и provider failure policy | 6 | Реализовано и проверено частично | Keys masked/encrypted; budget/rate-limit/provider outage tests |
| Q02 | Analytics, audit, multilingual/adversarial evals | 6 | Реализовано и проверено частично | Воспроизводимые eval runs, cost/latency, source grounding, права и retention |
| O01 | Staging и независимые deployment pipelines | 7 | Запланировано | Раздельные SPA/backend releases; compatible rollout и rollback |
| O02 | Monitoring, backup restore, load checks/runbooks | 7 | Проверено частично | FAQ восстановлен и прочитан из отдельной базы PostgreSQL после pg_dump/pg_restore. Полный DR-тест закрытых PDF и ключей и предельная нагрузка staging остаются открытыми |

Приёмка этапа 0: clean install → dependencies healthy → migrate → API live/ready →
Node smoke/Python startup → shared contracts build → CI. Затем dependency stop/recovery,
перезапуск без потери данных и SPA secret scan. Проверки фундамента и новых доменных путей приведены раздельно.
Смотреть [VERIFICATION](VERIFICATION.md).

Полный сквозной критерий этапов 1–7: организатор создаёт мероприятие, публикует знания;
участник получает подтверждённый ответ с источниками; неизвестный вопрос доходит до
модератора, который отвечает и при необходимости создаёт FAQ-черновик.

Обязательные regression gates доменных этапов: все роли; cross-tenant SQL/Qdrant/S3/API/worker;
повторные webhook; старые/удалённые источники; worker restart; provider outage; отсутствие
секретов в DTO/logs/SPA. Реальные боты и AI включаются только после настройки соответствующего
этапа. Публичных деплоев в этапе 0 нет.
