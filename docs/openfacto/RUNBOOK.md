# Локальный запуск

Требования: Node 24 LTS, pnpm 12.17.0, Docker Engine + Compose с доступным socket,
Python 3.12+ и uv 0.9.8+. Все сервисы здесь локальные. Текущие ограничения реализации
и проверок перечислены в [VERIFICATION](VERIFICATION.md).

Lockfile обновлён и проверен чистой установкой. Используйте `pnpm install --frozen-lockfile`.
В workspace явно разрешён build script esbuild; необязательный msgpackr-extract отключён,
BullMQ проверен с JavaScript fallback. Непросмотренные build scripts по-прежнему блокируются.

При первом запуске создайте `.env` из примеров; существующие файлы не перезаписывайте.

```sh
cp .env.example .env
cp apps/mini-app/.env.example apps/mini-app/.env
pnpm install --frozen-lockfile
pnpm python:sync
pnpm infra:up
pnpm build
pnpm db:migrate
pnpm dev
```

`pnpm infra:up` ждёт healthchecks четырёх services. SeaweedFS создаёт private bucket
при запуске `mini` из `S3_BUCKET` и включает authentication через AWS credentials из env.

`pnpm dev` запускает React/Vite (`http://localhost:5173`), NestJS API
(`http://127.0.0.1:3000`) и Node-worker. Команда сначала собирает общие зависимости.
Node worker dev компилирует TypeScript в watch mode и запускает dist после первой успешной
компиляции. После изменения общего пакета пересобрать его и перезапустить потребителя.
Python запускается отдельно: независимый runtime и dependency manager.

```sh
uv run --locked --directory apps/pdf-worker python -m openfacto_pdf
curl --fail http://127.0.0.1:3000/health/live
curl --fail http://127.0.0.1:3000/health/ready
curl --fail http://127.0.0.1:8001/health/ready
```

В Mini App кнопка «Проверить API» вызывает реальный `/health/ready` через общий контракт.
Это технический экран без auth и продуктового макета. Реальный browser flow проверен
на desktop 1280px и mobile 390px: ответ API отображается, JS errors и horizontal overflow отсутствуют.

API и worker scripts читают корневой `.env` средствами Node. Vite читает собственный
`apps/mini-app/.env` с **единственной** публичной настройкой `VITE_API_BASE_URL`.
Корневой env не копируется во frontend. Python читает `PDF_WORKER_HOST/PORT` из environment;
по умолчанию `127.0.0.1:8001`, `.env.example` описывает доступные настройки.

| Переменная | Runtime / правило |
| --- | --- |
| DATABASE_URL | API/Node-worker: PostgreSQL URL; Drizzle migrator читает отдельно |
| REDIS_URL | API/Node-worker: redis/rediss URL, optional auth/db |
| NODE_ENV / LOG_LEVEL | development/test/production; debug/info/warn/error |
| API_HOST / API_PORT | default 127.0.0.1:3000; port 1–65535 |
| MINI_APP_ORIGIN | Точный origin без path; production только HTTPS |
| DEPENDENCY_TIMEOUT_MS | API/worker startup: 100–10000, default 2000 |
| WORKER_CONCURRENCY | 1–32, default 2 |
| POSTGRES_* | Compose initial cluster credentials; согласовать с DATABASE_URL |
| QDRANT_URL | Зарезервировано для этапа 4, текущие процессы не читают |
| S3_ENDPOINT / S3_BUCKET / S3_*KEY* | Compose private bucket; приложение подключится в этапе 4 |
| PDF_WORKER_HOST / PDF_WORKER_PORT | Только внутренний Python lifecycle server |
| VITE_API_BASE_URL | Только SPA; публичный URL, без credentials/query/hash |

Отсутствующие/невалидные настройки дают имена переменных без их значений. Указание URL
не проверяет сетевую доступность: для API это делает readiness. Значения примеров только
для локальной разработки, не для production.

PostgreSQL/Redis/Qdrant/S3 публикуют только loopback ports 5432/6379/6333/9000.
SeaweedFS admin UI и WebDAV выключены; анонимный GET private object возвращает 403. Compose volumes
переживают `pnpm infra:down`; `docker compose down -v` удаляет данные и для обычного
перезапуска не используется. В PostgreSQL 18 volume смонтирован на `/var/lib/postgresql`.

Опционально, при установленном native PostgreSQL без сети: `pnpm db:verify:sql`.
Это проверка baseline SQL и ограничений в standalone backend, а не Drizzle migrator.

Проверки:

```sh
pnpm check
pnpm test:integration
pnpm test:e2e
pnpm python:lint
pnpm python:test
pnpm python:smoke
pnpm python:test:integration
pnpm check:spa
pnpm verify:local
```

`verify:local` требует свободный API port, локальный `.env` и доступ к Docker без повышения
прав. Скрипт не запускает sudo/pkexec и не запрашивает пароли. Если `docker info` недоступен,
он завершается до изменения сервисов. Скрипт останавливает/поднимает только
Compose-проект `openfacto`. Проверяет повтор миграций, реальные readiness transitions,
integration/e2e, private S3 и сохранность fixtures во всех четырёх volumes. Не запускать против staging/production.

При изменении SQL: изменить schema → `pnpm db:generate` → изучить SQL/snapshot →
`pnpm db:migrate` на тестовой БД → integration checks. Не редактировать уже применённую
миграцию после её принятия. Baseline snapshot подтверждён генератором: `No schema changes, nothing to migrate`.

Диагностика:

- Сначала `docker info`: текущий пользователь должен иметь прямой доступ к Docker.
- `docker compose ps` и `docker compose logs SERVICE`: health/port/volume failures.
- `/health/live=200`, `/health/ready=503`: посмотреть dependency statuses; проверить SQL/Redis,
  credentials и `DEPENDENCY_TIMEOUT_MS`; не перезапускать API бесконечно вместо исправления зависимости.
- `Invalid configuration`: исправить названные env variables; не публиковать `.env` в issue/logs.
- `EPERM listen`, Docker socket permission, DNS failure: ограничение окружения, не успешная приёмка.
- `uv: command not found`: установить uv по [официальной инструкции](https://docs.astral.sh/uv/getting-started/installation/).

Зависимости Python сейчас пусты намеренно: PyMuPDF появится с реальным PDF pipeline этапа 4.
`uv.lock` фиксирует virtual project; Ruff запускается через uvx с точной версией 0.14.3.
Locked sync описан в [uv docs](https://docs.astral.sh/uv/concepts/projects/sync/).
SeaweedFS выбран после недоступности прежних публичных MinIO images; используется
зафиксированный image `chrislusf/seaweedfs:4.38`, а не `latest`. Базовая аутентификация
описана в [официальной документации SeaweedFS](https://github.com/seaweedfs/seaweedfs/wiki/S3-Credentials).
Миграции следуют [Drizzle migrate](https://orm.drizzle.team/docs/drizzle-kit-migrate),
worker connections — [BullMQ connections](https://docs.bullmq.io/guide/connections).
Внешняя телеметрия не настроена; для Turbo установите `TURBO_TELEMETRY_DISABLED=1`
(в CI уже выставлено), для Qdrant выключена в Compose. ObserveModule не подключён.
