# Openfacto

Работающий локальный технический каркас Telegram-first платформы FAQ и ответов с источниками.
React/Vite Mini App, NestJS API, PostgreSQL/Drizzle, Redis/BullMQ, отдельный Python-worker,
Qdrant и приватное S3-compatible хранилище SeaweedFS.

Реализованы общие пакеты, конфигурация, JSON-логи, первая миграция, live/ready API,
каркасы workers и CI. Проверены чистая установка, сборка, тесты, миграции и браузерный
сценарий SPA → API → PostgreSQL/Redis. Полный повтор проверки сохранности всех четырёх
Docker volumes и удалённый запуск GitHub Actions ещё не подтверждены.
[Точные результаты](docs/openfacto/VERIFICATION.md).

После установки Node 24, pnpm 12.17.0, uv и доступного пользователю Docker:

```sh
# Только при первом запуске; существующие .env сохраняйте.
cp .env.example .env
cp apps/mini-app/.env.example apps/mini-app/.env
pnpm install --frozen-lockfile
pnpm python:sync
pnpm infra:up
pnpm build
pnpm db:migrate
pnpm dev
```

Mini App: http://localhost:5173. API: http://127.0.0.1:3000/health/ready.
Python запускается отдельно: `uv run --locked --directory apps/pdf-worker python -m openfacto_pdf`.

[Запуск и команды](docs/openfacto/RUNBOOK.md) · [Архитектура](docs/openfacto/ARCHITECTURE.md) ·
[API](docs/openfacto/API.md) · [Данные](docs/openfacto/DATA-MODEL.md) ·
[Модель угроз](docs/openfacto/THREAT-MODEL.md) · [Backlog](docs/openfacto/BACKLOG.md).

Исходный [документ v2.0](<docs/Openfacto — Полная архитектура проекта (v2.0).md>) сохранён.
UI-решение — бесплатные Arc UI; основа бренда — концепт 7 и его чистый знак.
Новый продуктовый макет требует отдельного согласования. Текущий экран технический.
Telegram-авторизация, бизнес-API, FAQ/RAG и обработка PDF остаются следующими этапами.
