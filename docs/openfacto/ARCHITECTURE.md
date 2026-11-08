# Архитектура

Актуальное уточнение v2.0 от 8 ноября 2026: RabbitMQ и общая очередь AI. Этап 0 — локальный технический фундамент;
его статус и ограничения находятся в [VERIFICATION](VERIFICATION.md).

API и фоновые обработчики запускаются в одном NestJS-процессе. HTTP-обработчики
сохраняют задания в PostgreSQL; внутренний диспетчер публикует их в RabbitMQ,
а потребители того же бэкенда забирают сообщения. SQL остаётся источником истины:
периодический sweep восстанавливает уведомления после сбоя брокера. Telegram и Playground
проходят через одну физическую очередь `ai.questions` с общей границей параллелизма.
`apps/worker` — библиотека обработчиков, а не отдельный запускаемый сервис.

```mermaid
flowchart TB
  subgraph backend[Backend OpenFacto · один процесс NestJS]
    api[NestJS API<br/>auth, roles, sources, playground, handoffs, analytics]
    dispatch[Диспетчер сохранённых заданий]
    worker[Фоновые потребители<br/>Telegram + Playground, ingestion, delivery, evaluations]
    engine[Общий AnswerEngine]
  end
  organizer[Организатор] --> mini[React Mini App / Vite<br/>Arc UI, RU / KK / EN]
  mini -->|HTTPS REST /api/v1| api
  participant[Участник] -->|Telegram| clientbot[Бот мероприятия]
  clientbot -->|webhook + secret| api
  api --> pg[(PostgreSQL<br/>источник истины)]
  api -->|durable inbox / outbox| pg
  pg -->|pending jobs| dispatch
  dispatch -->|publisher confirms| rabbit[(RabbitMQ)]
  rabbit -->|ai.questions + отдельные служебные очереди| worker
  worker --> pg
  worker --> engine
  pg -->|Playground status + decision| api
  engine --> pg
  engine -->|retrieval| qdrant
  engine -->|generation / verification when needed| ai
  worker -->|private originals| s3[(Private S3)]
  api -->|upload / signed access| s3
  worker -->|page extraction| pdf[Python PDF worker<br/>PyMuPDF, isolated process]
  worker -->|dense + lexical indexing| qdrant[(Qdrant<br/>derived index)]
  worker -->|embedding jobs| ai[AI adapters<br/>local embeddings or configured provider]
  worker -->|outbox delivery| clientbot
  manager[Manager Bot] -->|Telegram initData| mini
```

```mermaid
flowchart LR
  editor[Редактор] -->|FAQ draft or PDF| api[NestJS API]
  api -->|version, access and status| sql[(PostgreSQL)]
  api -->|private original| store[(Private S3)]
  sql -->|dispatch lease + index job| queue[(RabbitMQ)]
  queue --> ingest[Node ingestion worker]
  store -->|hash-checked bytes| ingest
  ingest --> extract[Python PDF extraction]
  extract -->|page text + diagnostics| ingest
  ingest -->|chunks + vectors| index[(Qdrant)]
  ingest -->|FAQ vector by published revision| sql
  participant[Question] -->|webhook / Playground POST| ingress[NestJS API]
  ingress -->|durable question| sql
  sql -->|dispatch lease| questions[(RabbitMQ ai.questions)]
  questions --> answer[AnswerEngine consumer]
  answer -->|exact FAQ + current ACL| sql
  answer -->|hybrid document retrieval| index
  answer -->|hydrate + recheck version| sql
  answer -->|answer claims + citations| verify[Evidence gate]
  verify -->|durable decision| sql
  sql -->|outbox| queue
  queue --> delivery[Delivery worker]
  delivery -->|recheck source, then send| participant
  sql -->|Playground GET status + trace| mini[Mini App]
  answer -->|insufficient / conflict / personal decision| handoff[Moderator handoff]
  handoff -->|response / optional FAQ draft| sql
  handoff -->|reply via outbox| delivery
 ```

SPA выполняет представление и обращения к REST. PostgreSQL — источник истины для прав,
публикаций, inbox/outbox, версий, трасс решений, бюджета и модерации. `playground_requests`
хранит автора, scope, исходный ввод, fingerprint, стабильный trace ID и состояние работы.
`queue_dispatches` хранит ограниченные по времени leases публикации, чтобы sweep не
заполнял очередь одинаковыми уведомлениями. RabbitMQ доставляет идентификаторы работ;
ожидающие записи восстанавливаются из SQL после потери очереди. Qdrant — производный
индекс с tenant/event/version scope; S3 хранит закрытые оригиналы. Node workers отдельно
обрабатывают ответы, индексацию и доставку внутри NestJS. PDF-parser работает в изолированном процессе.

Диспетчер ждёт publisher confirm; потребитель отправляет manual ack после завершения
обработчика. Неверные сообщения и необработанные ошибки уходят в `<queue>.dead`.
Повторы планируются по SQL-состоянию, времени следующей попытки и сроку claim lease.
После разрыва соединения транспорт восстанавливает topology и consumers. Доставка
at least once допускает дубликаты: SQL-проверки попытки и lease защищают фиксацию результата.
Это не гарантия exactly once для внешнего провайдера или Telegram. Неопределённый
платёж/отправка требует сверки по сохранённому состоянию. Текст вопросов и секреты
не помещаются в сообщения брокера.

Бизнес-API обслуживает сессии, организации, мероприятия, ботов, публикации, PDF,
Playground и обращения. HTTP Playground сохраняет работу и возвращает 202; LLM не
исполняется в HTTP-запросе. Consumer `ai.questions` использует общий AnswerEngine для
Telegram и Playground. `WORKER_CONCURRENCY` ограничивает их суммарный параллелизм в одном backend.
Отдельные очереди `documents.ingest`, `ai.evaluations` и `messages.delivery` обслуживают
индексацию, оценки и доставку. Обработка PDF вынесена в изолированный
процесс. Порядок поиска, допустимые исходы и границы доставки описаны в [AI-PIPELINE](AI-PIPELINE.md).

API readiness проверяет PostgreSQL и RabbitMQ. Доступность поиска по PDF, S3 и модели
проверяется в соответствующем сценарии. Точный FAQ обслуживается из SQL.
Liveness не обращается к зависимостям.

Следующие диаграммы описывают логические взаимодействия. Фактические HTTP-маршруты перечислены в [API](API.md).

```mermaid
sequenceDiagram
  actor Admin as Организатор
  participant SPA as Mini App
  participant API as NestJS
  participant DB as PostgreSQL
  Admin->>SPA: Открыть из Manager Bot
  SPA->>API: POST /api/v1/auth/telegram (initData)
  API->>API: HMAC, срок, replay policy, Manager Bot identity
  API->>DB: Найти user, создать server session
  API-->>SPA: Сессия без bot token
  SPA->>API: Запрос organization/event
  API->>DB: Проверка membership и tenant scope
  API-->>SPA: Разрешённые данные
```

```mermaid
sequenceDiagram
  participant TG as Telegram
  participant API as Webhook API
  participant DB as PostgreSQL
  participant Q as RabbitMQ ai.questions
  participant W as Node Worker
  TG->>API: update + secret header
  API->>API: Проверка secret и серверной связи bot/event
  API->>DB: INSERT inbox UNIQUE(bot_id, update_id)
  API-->>TG: 200 после durable commit
  DB-->>W: Незавершённый inbox/outbox
  W->>DB: Взять dispatch lease
  W->>Q: ID inbox, ждать publisher confirm
  Q->>W: at least once delivery
  W->>DB: Дедупликация side effects, проверка активации
  W->>Q: manual ack после завершения
```

```mermaid
sequenceDiagram
  actor Editor
  participant API
  participant DB as PostgreSQL
  participant W as Index Worker
  participant QD as Qdrant
  Editor->>API: Опубликовать FAQ draft
  API->>DB: Транзакция публикации версии FAQ
  API-->>Editor: Published version
  DB-->>W: Index publication job
  W->>DB: Резервировать отсутствующий вектор FAQ для текущей модели
  W->>DB: Сохранить вектор версии с идентификатором модели
  Note over API,QD: Retrieval проверяет разрешённую опубликованную версию в SQL
```

```mermaid
sequenceDiagram
  actor Editor
  participant API
  participant S3 as Private S3
  participant Q as RabbitMQ / Node Worker
  participant PDF as Python PDF-worker
  participant QD as Qdrant
  Editor->>API: Запрос защищённой загрузки PDF
  API->>S3: Карантин: scoped object key
  API->>API: MIME, размер, hash, доступ, лимиты
  API->>Q: Версия pending в SQL, dispatch через RabbitMQ
  Q->>S3: Прочитать scoped original и проверить SHA-256
  Q->>PDF: Передать байты по аутентифицированному внутреннему HTTP
  PDF-->>Q: Текст страниц и метаданные
  Q->>Q: Chunking + embeddings через адаптер
  Q->>QD: Tenant/event/document/version payload
  Q-->>API: Ready / failed, идемпотентное состояние
```

```mermaid
sequenceDiagram
  actor User as Участник
  participant W as Answer Worker
  participant DB as PostgreSQL
  participant QD as Qdrant
  participant LLM as Provider
  User->>W: Активированный вопрос
  W->>DB: Разрешённый опубликованный FAQ
  alt FAQ найден
    DB-->>User: Детерминированный ответ
  else Нужен retrieval
    W->>QD: Hybrid retrieval, tenant/event/version filters
    QD-->>W: Разрешённые кандидаты
    W->>DB: Проверить ACL и актуальность источников
    W->>LLM: Только выбранные evidence, без секретов
    LLM-->>W: Ответ + source IDs
    W->>W: Проверить цитаты и policy
    W-->>User: Ответ со страницами / уточнение / отказ
  end
```

```mermaid
sequenceDiagram
  actor User as Участник
  participant W as Answer Worker
  participant DB as PostgreSQL
  actor Mod as Модератор
  W->>DB: Нет evidence: создать handoff ticket + outbox
  W-->>User: Вопрос передан модератору
  DB-->>Mod: Обращение в кабинете согласно роли и назначению
  Mod->>DB: Ответ через API с проверкой роли и tenant
  DB-->>User: Ответ через Telegram outbox
  Mod->>DB: Опционально создать FAQ draft
  Note over Mod,DB: Draft не публикуется автоматически
```

Playground GET повторно проверяет автора, membership, событие и актуальность источников,
включая кандидатов в диагностическом следе. Результат и completed фиксируются атомарно.
Повторный POST с тем же ID и вводом возвращает текущее состояние без новой работы;
изменённый ввод конфликтует. Браузер опрашивает статус до пяти минут и сохраняет тот же ID
для повтора после таймаута. Offline sample остаётся локальным демонстрационным движком.

Перед запуском нового backend нужны миграции `0010_async_playground` и `0011_queue_dispatches`.
Старых BullMQ consumers следует остановить до перехода; незавершённые SQL-записи
подхватит новый диспетчер. Redis-данные автоматически не удаляются. Порядок перехода — в [RUNBOOK](RUNBOOK.md).

Релизы SPA и backend независимы; при этом переход Playground с синхронного решения на
POST 202 + GET требует согласованного обновления клиента и backend.
Void/Cloudflare — возможный будущий SPA target из v2.0; в этапе 0 не устанавливается
и не разворачивается. Backend, workers и данные остаются отдельным runtime.

UI: использовать **бесплатные Arc UI**, без покупки Pro-компонентов. Основа бренда —
[концепт 7](brand/CONCEPT-V7.md) и [его чистый знак](brand/SYMBOL-V7-CLEAN.md).
Ink `#26183E`, Glacier `#B8D5E8`, Paper `#F3EEE4`; растровый знак ещё не SVG-мастер.
Апрув логотипа не означает апрув макета: desktop/mobile-концепт согласуется на этапе 2
отдельно. Рабочий кабинет использует компоненты [Arc UI](https://uiarc.dev/) с локальными исходниками.
