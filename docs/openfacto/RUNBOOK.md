# Локальный запуск

Требования: Node 24 LTS, pnpm 12.17.0, Docker Engine + Compose с доступным socket,
Python 3.12+ и uv 0.9.8+. Все сервисы здесь локальные. Текущие ограничения реализации
и проверок перечислены в [VERIFICATION](VERIFICATION.md).

Используйте `pnpm install --frozen-lockfile`. В workspace явно разрешён build script
esbuild; непросмотренные build scripts по-прежнему блокируются. Результаты проверок
перехода на RabbitMQ фиксируются отдельно; старые отчёты не подтверждают новый транспорт.

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

`pnpm infra:up` ждёт healthchecks PostgreSQL, RabbitMQ, Qdrant и SeaweedFS. SeaweedFS создаёт private bucket
при запуске `mini` из `S3_BUCKET` и включает authentication через AWS credentials из env.

`pnpm dev` запускает React/Vite (`http://localhost:5173`), NestJS API
(`http://127.0.0.1:3000`) с диспетчером и потребителями очереди внутри того же процесса.
Команда сначала собирает общие зависимости. `apps/worker` содержит библиотеку
обработчиков; её dev-команда только следит за компиляцией, второй сервер не запускается.
После изменения библиотеки обработчиков перезапустите NestJS, чтобы загрузить новую сборку.
Для запуска собранного бэкенда достаточно `pnpm --filter @openfacto/api start`.
`pnpm dev:local` также запускает один backend и Vite. При локальном semantic endpoint
`127.0.0.1:7312` он сначала проверяет модель/revision, при необходимости запускает
подготовленный `apps/semantic-worker` и ждёт его готовности. Окружение Python и веса
semantic-модели готовятся отдельно; этот шаг не переносит обработку AI-заданий из NestJS.
Остановка NestJS закрывает
потребителей, дожидается текущих задач и закрывает соединения с брокером и БД.
Python запускается отдельно: независимый runtime и dependency manager.

```sh
uv run --locked --directory apps/pdf-worker --env-file ../../.env python -m openfacto_pdf
curl --fail http://127.0.0.1:3000/health/live
curl --fail http://127.0.0.1:3000/health/ready
curl --fail http://127.0.0.1:8001/health/ready
```

Mini App использует Telegram initData для входа в кабинет. В обычном браузере можно
работать с явно обозначенным примером. Для боевых операций нужен вход через Manager Bot.

### Переход с BullMQ на RabbitMQ

1. Сохраните резервную копию PostgreSQL и текущую конфигурацию. Остановите старый backend
   и все BullMQ consumers; не запускайте старые и новые consumers одновременно над одной БД.
   Дождитесь завершения активных операций либо сохраните их неопределённый статус для сверки.
2. Добавьте в существующий серверный `.env` `RABBITMQ_DEFAULT_USER`,
   `RABBITMQ_DEFAULT_PASS` и согласованный `RABBITMQ_URL`. В `.env.example` для локальной
   разработки используются `openfacto`, `local-openfacto-password` и
   `amqp://openfacto:local-openfacto-password@127.0.0.1:5672/%2f`.
   `%2f` обозначает vhost `/`. Эти credentials не подходят для публичного развёртывания.
   Compose использует default user/password при инициализации RabbitMQ volume; изменение
   `.env` само по себе не меняет пользователя уже инициализированного брокера.
3. Поднимите инфраструктуру, установите зависимости и соберите код. До запуска нового
   backend выполните `pnpm db:migrate`: обязательны `0010_async_playground` и
   `0011_queue_dispatches`. Первая расширяет durable Playground ledger и помечает старые
   незавершённые записи без ввода как failed/legacy_request; вторая добавляет leases публикации.
4. Запустите новый NestJS backend и обновлённую SPA вместе: Playground теперь отвечает
   POST 202 и требует GET статуса. Readiness должна показать `postgres: up`, `rabbitmq: up`.
   Проверьте завершение тестового Playground-запроса и возобновление разрешённых SQL-заданий.

Перенос сообщений из Redis не нужен: новый sweep читает те же записи inbox/outbox,
ingestion/evaluation и Playground в PostgreSQL. После истечения claim/dispatch leases
допустимые незавершённые работы публикуются заново. Старые Redis volumes и ключи
автоматически не удаляются. Не используйте `FLUSHALL`, `docker compose down -v` или
удаление volumes как часть миграции. Для отката согласуйте старый backend со старой SPA
и остановите новый consumer; не откатывайте SQL удалением данных.

### Очереди и восстановление

Telegram и Playground используют одну очередь `ai.questions`; `WORKER_CONCURRENCY`
ограничивает их совместное выполнение внутри одного backend. `documents.ingest`,
`ai.evaluations` и `messages.delivery` отделяют подготовку знаний, оценки и отправку.
В сообщениях находятся тип и ID работы, без текста вопроса или credentials.

Диспетчер берёт SQL dispatch lease и ждёт publisher confirm. Consumer делает manual ack
после завершения обработчика. SQL хранит попытки, время повтора и claim lease;
после сбоя sweep восстанавливает допустимые работы. Соединение и subscriptions
восстанавливаются транспортом. Некорректные сообщения и ошибки обработчика попадают
в `<queue>.dead`; исследуйте причину вместе с SQL-состоянием, не воспроизводите DLQ вслепую.
At least once допускает повторную доставку. Exactly once для AI-провайдера и Telegram
не гарантируется; SQL-дедупликация и стабильный trace ID не заменяют сверку uncertain операций.

Если Playground ждёт дольше пяти минут, интерфейс предлагает продолжить тот же запрос.
Повтор в текущей форме использует прежние requestId и ввод. Не создавайте новый ID,
чтобы просто проверить незавершённую работу: используйте GET статуса с прежней сессией.
Перезагрузка страницы пока не восстанавливает незавершённую форму автоматически.

### Ключи и первый вопрос

1. В корневом `.env` задайте `MANAGER_BOT_TOKEN`, `MINI_APP_PUBLIC_URL` (HTTPS адрес SPA),
   `PUBLIC_WEBHOOK_ORIGIN` (HTTPS origin API) и `MINI_APP_ORIGIN` для точного CORS origin.
   Для ключа шифрования сгенерируйте 32 случайных байта в base64. Сохраните `BOT_ENCRYPTION_KEY`
   в резервной копии секретов. При его потере придётся заново подключить ботов и BYOK.
2. Команда `pnpm telegram:menu` регистрирует кнопку Mini App у Manager Bot. Затем организатор
   открывает кабинет в Telegram, создаёт организацию и мероприятие, подключает клиентского бота,
   устанавливает webhook, разрешает группы и переводит мероприятие в активное состояние.
3. Опубликуйте FAQ с алиасом и проверьте его в Playground. При точном совпадении число
   платных операций равно нулю. Для теста по документу запустите parser с `PDF_WORKER_TOKEN`
   (случайная строка от 32 символов), загрузите PDF, дождитесь готовности и опубликуйте версию.
4. Для WikiVibe заполните `AI_PLATFORM_KEY`, выберите доступную ключу модель в `AI_CHAT_MODEL`.
   Базовый endpoint — `https://api.wikivibe.dev/v1/chat/completions`. Стоимость задаётся в
   микродолларах за 1000 входных и выходных токенов. Сверьте ставки с группой вашего ключа.
   `AI_PLATFORM_DAILY_MICROS=10000` ограничивает расчётные дневные расходы платформы одним центом.
   BYOK использует отдельный зашифрованный ключ мероприятия. [Каталог WikiVibe](https://api.wikivibe.dev/models)
5. Если FAQ доступен, но генерация завершается handoff, проверьте `reasonCode` и учётную запись
   операции. Для `uncertain` сверьте расход с провайдером. Исходящая Telegram-доставка
   с таким статусом требует проверки исходного чата перед повторной отправкой.

В кабинете откройте «Обращения» → «С ответом» и нажмите «Обновить», чтобы узнать
состояние доставки. «Telegram принял ответ» означает подтверждение Bot API.
Если worker не может расшифровать токен до обращения в Telegram, он отложит повтор
на 30 секунд. После пяти безуспешных попыток запись получает статус failed.
Проверьте серверный `BOT_ENCRYPTION_KEY` и подключение соответствующего бота.

Порог запросов задаётся `TELEGRAM_DAILY_CHAT_LIMIT` на один чат и бота (по умолчанию 100 за сутки UTC).
Конфигурация локальных embeddings и методика оценки качества приведены в [описании worker](../../apps/worker/README.md).

API и worker scripts читают корневой `.env` средствами Node. Vite читает собственный
`apps/mini-app/.env` с **единственной** публичной настройкой `VITE_API_BASE_URL`.
Корневой env не копируется во frontend. Python читает `PDF_WORKER_HOST/PORT` из environment;
по умолчанию `127.0.0.1:8001`, `.env.example` описывает доступные настройки.

| Переменная | Runtime / правило |
| --- | --- |
| DATABASE_URL | API/Node-worker: PostgreSQL URL; Drizzle migrator читает отдельно |
| RABBITMQ_URL | Backend: amqp/amqps URL с credentials и vhost; используется transport и readiness |
| RABBITMQ_DEFAULT_USER / RABBITMQ_DEFAULT_PASS | Compose: начальные credentials RabbitMQ; согласовать с RABBITMQ_URL |
| OPENFACTO_RABBITMQ_PORT / OPENFACTO_RABBITMQ_MANAGEMENT_PORT | Compose: loopback-порты AMQP/management, default 5672/15672 |
| NODE_ENV / LOG_LEVEL | development/test/production; debug/info/warn/error |
| API_HOST / API_PORT | default 127.0.0.1:3000; port 1–65535 |
| MINI_APP_ORIGIN | Точный origin без path; production только HTTPS |
| DEPENDENCY_TIMEOUT_MS | API/worker startup: 100–10000, default 2000 |
| WORKER_CONCURRENCY | 1–32, default 2; общий лимит consumer ai.questions для Telegram и Playground внутри одного backend |
| POSTGRES_* | Compose initial cluster credentials; согласовать с DATABASE_URL |
| QDRANT_URL | Worker использует scoped индексы опубликованных версий документов |
| S3_ENDPOINT / S3_BUCKET / S3_*KEY* | Приватные оригиналы PDF. API проверяет права до загрузки и скачивания |
| PDF_WORKER_HOST / PDF_WORKER_PORT | Только внутренний Python lifecycle server |
| VITE_API_BASE_URL | Только SPA; публичный URL, без credentials/query/hash |

Отсутствующие/невалидные настройки дают имена переменных без их значений. Указание URL
не проверяет сетевую доступность: для API это делает readiness. Значения примеров только
для локальной разработки, не для production.

PostgreSQL/RabbitMQ/Qdrant/S3 публикуют только loopback ports 5432/5672/6333/9000.
RabbitMQ management доступен на loopback 15672 с настроенными credentials.
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
- `/health/live=200`, `/health/ready=503`: посмотреть dependency statuses; проверить PostgreSQL/RabbitMQ,
  credentials и `DEPENDENCY_TIMEOUT_MS`; не перезапускать API бесконечно вместо исправления зависимости.
- `Invalid configuration`: исправить названные env variables; не публиковать `.env` в issue/logs.
- `EPERM listen`, Docker socket permission, DNS failure: ограничение окружения, не успешная приёмка.
- `uv: command not found`: установить uv по [официальной инструкции](https://docs.astral.sh/uv/getting-started/installation/).

Версия PyMuPDF закреплена в uv.lock. Параметры извлечения и лимиты описаны в [Python worker](../../apps/pdf-worker/README.md).
`uv.lock` фиксирует virtual project; Ruff запускается через uvx с точной версией 0.14.3.
Locked sync описан в [uv docs](https://docs.astral.sh/uv/concepts/projects/sync/).
SeaweedFS выбран после недоступности прежних публичных MinIO images; используется
зафиксированный image `chrislusf/seaweedfs:4.38`, а не `latest`. Базовая аутентификация
описана в [официальной документации SeaweedFS](https://github.com/seaweedfs/seaweedfs/wiki/S3-Credentials).
Миграции следуют [Drizzle migrate](https://orm.drizzle.team/docs/drizzle-kit-migrate);
RabbitMQ transport и его lifecycle находятся в `packages/queue`, SQL recovery — в `apps/worker/src/business.ts`.
Внешняя телеметрия не настроена; для Turbo установите `TURBO_TELEMETRY_DISABLED=1`
(в CI уже выставлено), для Qdrant выключена в Compose. ObserveModule не подключён.
