# Проверки фундамента

7 ноября 2026. Локальный каркас работает; основные функциональные проверки пройдены.
Полная приёмка этапа 0 ещё включает два пункта из раздела «Осталось подтвердить» ниже.

| Проверка | Результат |
| --- | --- |
| Чистая установка `pnpm install --frozen-lockfile` | Exit 0 в новой копии без node_modules/dist/.env; lockfile актуален |
| `pnpm check` | Lint, typecheck, 33 unit tests и все builds проходят; Node 26.13.0 и чистая копия Node 24.22.2 |
| Drizzle generator | `No schema changes, nothing to migrate` — baseline согласован с schema |
| Drizzle migrator | Применён дважды на новой пустой PostgreSQL 18.6; повтор не создаёт дубликаты |
| `drizzle-kit check` | Exit 0 |
| `pnpm test:integration` | 3 tests passed: SQL/ORM constraints + UTC, отдельный BullMQ process через Redis, скомпилированный API с настоящими PostgreSQL/Redis |
| `pnpm test:e2e` | 8 tests passed: HTTP boundary и Redis wire protocol через реальные TCP-соединения |
| Python через uv 0.9.8 | Locked sync, Ruff 0.14.3, startup check, 6 unit и 1 HTTP integration проходят; Python 3.14.9 и 3.12.12 |
| `pnpm dev` | React/Vite, NestJS и Node-worker запущены одной командой; worker.ready подтверждён |
| Python lifecycle server | Запущен отдельно на 127.0.0.1:8001, capabilities=[] |
| Браузер: desktop 1280px / mobile 390px | Кнопка вызывает реальный /health/ready, UI показывает «API готово к работе»; нет JS errors/overflow |
| Сборка SPA / secret scan | Production bundle собирается независимо от NODE_ENV родителя; 3 assets проверены, server secret markers/значения локальных секретов отсутствуют |
| Compose runtime | PostgreSQL, Redis, Qdrant, SeaweedFS запущены и healthy; ports только loopback |
| S3 | HeadBucket/PutObject прошли; anonymous GET объекта возвращает 403 |
| Qdrant | Созданы collection и point с wait=true |
| Реальные dependency failures | PostgreSQL/Redis остановлены по очереди: live=200, ready=503; после восстановления ready=200 |
| Перезапуск Compose без -v | Сервисы восстановились healthy; fixtures PostgreSQL и Redis сохранились |
| Native PostgreSQL offline check | Baseline SQL, UUIDv4, UTC, Telegram ID, constraints/cascade и restart persistence прошли также в single-user mode |

Чистая копия: `/tmp/openfacto-clean-90eq7rxu`, без старых workspace links и кэша Turbo.
Проверки Node 24 использовали отдельную новую БД с уникальным именем; после завершения
она удалена. Исходные данные основной БД не удалялись. Проверки Python 3.12 выполнены
в отдельной virtual environment. Локальные uv/uvx установлены в пользовательский bin,
системный Python не заменялся.

Браузерный сценарий: React UI → общий контракт → NestJS /health/ready → настоящий SELECT 1
и Redis PING → typed response → текст статуса. Проверено Playwright Chromium headless.
Снимки: `/tmp/openfacto-browser-1280.png` и `/tmp/openfacto-browser-390.png`.
Это проверка технического экрана, а не апрув продуктового дизайна.

Осталось подтвердить:

1. Полный успешный `pnpm verify:local` с readback Qdrant и S3 после Compose restart.
   При предыдущем прогоне PostgreSQL/Redis readback прошёл, но следующий Qdrant fetch
   получил закрытое keep-alive соединение. Проверочный скрипт теперь использует
   `Connection: close` для Qdrant. Повторный destructive-runtime прогон не выполнялся
   после требования пользователя прекратить запросы системного пароля. Скрипт больше
   не содержит sudo/pkexec и при недоступном Docker завершается до изменения сервисов.
2. Настоящий GitHub Actions run. Workflow подготовлен; все его команды прошли локально
   на Node 24/Python 3.12, но удалённый зелёный run не заявляется.

Исправления, подтверждённые проверками:

- Настроен allowBuilds для esbuild и отказ для необязательного msgpackr-extract: чистая
  установка pnpm 12 больше не завершается ERR_PNPM_IGNORED_BUILDS.
- PostgreSQL statement_timeout передаётся числом; ORM timestamps проверяются через
  Drizzle transaction API, а не raw parser Postgres.js.
- JSON error contract действует и за пределами /api/v1; requestId создаёт сервер.
- Readiness обрабатывает асинхронные и синхронные dependency failures.
- Не загружающиеся MinIO images заменены публичным фиксированным SeaweedFS 4.38;
  authentication включена, admin UI/WebDAV/telemetry выключены.

Исходный v2.0 не изменялся, SHA-256:
`885945c3548d2a69f68ce4b8ec5310e38ffbf387ee7b0d447ce1b9d607b04dd6`.

Auth, tenant isolation, Telegram, FAQ, PDF parsing/ingestion, RAG, BYOK, analytics,
продуктовые UI и deployment остаются запланированными в [BACKLOG](BACKLOG.md).
