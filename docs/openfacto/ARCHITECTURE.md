# Архитектура

Актуальное уточнение v2.0 от 7 ноября 2026. Этап 0 — локальный технический фундамент;
его статус и ограничения находятся в [VERIFICATION](VERIFICATION.md).

```mermaid
flowchart TB
  organizer[Организатор] --> spa[React Mini App / Vite SPA]
  participant[Участник] --> tg[Telegram Bot API]
  spa -->|HTTPS REST /api/v1| api[NestJS modular monolith]
  tg -->|проверенный webhook: этап 3| api
  api --> pg[(PostgreSQL)]
  api -->|enqueue| redis[(Redis / BullMQ)]
  redis --> node[Node workers]
  node -->|внутренний ограниченный job protocol: этап 4| python[Python PDF-worker]
  api --> s3[(Private S3)]
  python --> s3
  node --> qdrant[(Qdrant)]
  node --> providers[Адаптер embeddings / LLM: этап 4+]
  node -->|outbox| tg
```

SPA выполняет только представление и обращения к REST. PostgreSQL — источник истины
для прав, публикаций, inbox/outbox и версий. Redis доставляет задачи; потеря Redis
не должна означать потерю бизнес-событий после реализации transactional outbox.
Qdrant — производный индекс с tenant/event/version scope; S3 хранит закрытые оригиналы.
Node workers обрабатывают фоновые задачи отдельно от HTTP. Python не исполняется внутри
Node; будет изолированным процессом с лимитами памяти, времени и размера PDF.

Сейчас бизнес-модули отсутствуют. Реализованы общие contracts/config/logger/database,
health-маршруты и smoke-очередь. Python предоставляет только lifecycle: `capabilities: []`.
PDF parsing, S3 upload, Qdrant indexing и внешние провайдеры ещё не подключены.

API readiness зависит от PostgreSQL и Redis. Qdrant/S3 не обслуживают ни один текущий
маршрут, поэтому их отказ не блокирует API этапа 0. Перед включением зависимого сценария
нужны отдельная worker readiness и политика деградации. Liveness не обращается к зависимостям.

Все следующие диаграммы описывают **запланированные** сценарии, а не существующие endpoints.

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
  participant Q as Redis
  participant W as Node Worker
  TG->>API: update + secret header
  API->>API: Проверка secret и серверной связи bot/event
  API->>DB: INSERT inbox UNIQUE(bot_id, update_id)
  API-->>TG: 200 после durable commit
  DB-->>W: Незавершённый inbox/outbox
  W->>Q: enqueue с детерминированным job id
  Q->>W: at least once delivery
  W->>DB: Дедупликация side effects, проверка активации
```

```mermaid
sequenceDiagram
  actor Editor
  participant API
  participant DB as PostgreSQL
  participant W as Index Worker
  participant QD as Qdrant
  Editor->>API: Опубликовать FAQ draft
  API->>DB: Транзакция: immutable version + publication + outbox
  API-->>Editor: Published version
  DB-->>W: Index publication job
  W->>QD: Upsert tenant/event/FAQ/version
  W->>DB: Index ready for current version
  Note over API,QD: Retrieval проверяет разрешённую опубликованную версию в SQL
```

```mermaid
sequenceDiagram
  actor Editor
  participant API
  participant S3 as Private S3
  participant Q as Redis / Node Worker
  participant PDF as Python PDF-worker
  participant QD as Qdrant
  Editor->>API: Запрос защищённой загрузки PDF
  API->>S3: Карантин: scoped object key
  API->>API: MIME, размер, hash, доступ, лимиты
  API->>Q: document/version job через outbox
  Q->>PDF: Scoped input + deadline + job id
  PDF->>S3: Чтение разрешённого объекта
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
  DB-->>Mod: Уведомление без избыточных персональных данных
  Mod->>DB: Ответ через API с проверкой роли и tenant
  DB-->>User: Ответ через Telegram outbox
  Mod->>DB: Опционально создать FAQ draft
  Note over Mod,DB: Draft не публикуется автоматически
```

Релизы SPA и backend независимы; общий REST сохраняет обратную совместимость.
Void/Cloudflare — возможный будущий SPA target из v2.0; в этапе 0 не устанавливается
и не разворачивается. Backend, workers и данные остаются отдельным runtime.

UI: использовать **бесплатные Arc UI**, без покупки Pro-компонентов. Основа бренда —
[концепт 7](brand/CONCEPT-V7.md) и [его чистый знак](brand/SYMBOL-V7-CLEAN.md).
Ink `#26183E`, Glacier `#B8D5E8`, Paper `#F3EEE4`; растровый знак ещё не SVG-мастер.
Апрув логотипа не означает апрув макета: desktop/mobile-концепт согласуется на этапе 2
перед реализацией продуктовых экранов. Текущая SPA — нейтральный технический каркас.
