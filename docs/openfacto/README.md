# Документация OpenFacto

Начните с [текущей архитектуры](CURRENT-ARCHITECTURE.md): один NestJS backend,
общая очередь RabbitMQ `ai.questions` для Telegram и Playground, DeepSeek Flash через
WikiVibe, локальные E5 embeddings и проверка ответа по опубликованным источникам.
PostgreSQL хранит состояния заданий и leases; Playground использует POST 202 + GET статуса.
Локальный Telegram получает обновления через polling.

Исходный [v2.0](<../Openfacto — Полная архитектура проекта (v2.0).md>) сохранён как
исторический архитектурный proposal. Отчёты относятся к версиям и наборам, указанным в них.
Для обновления с BullMQ используйте [порядок перехода](RUNBOOK.md#переход-с-bullmq-на-rabbitmq).

| Документ | Назначение |
| --- | --- |
| [CURRENT-ARCHITECTURE](CURRENT-ARCHITECTURE.md) | Полная текущая архитектура, технологии, RAG, очереди, Telegram и Playground |
| [ARCHITECTURE](ARCHITECTURE.md) | Границы контейнеров и потоки |
| [AI-PIPELINE](AI-PIPELINE.md) | Подготовка знаний, решение по вопросу, Playground, расходы и приёмка |
| [CONVERSATIONAL-AI](CONVERSATIONAL-AI.md) | Разговорный контекст, поиск, локальный запуск и воспроизводимые проверки |
| [API](API.md) | REST-контракт и реально доступные маршруты |
| [DATA-MODEL](DATA-MODEL.md) | Схема SQL и будущие сущности |
| [RUNBOOK](RUNBOOK.md) | Локальный запуск и диагностика |
| [LOCAL-TELEGRAM](LOCAL-TELEGRAM.md) | Локальный polling, единственный receiver, ingress и доставка |
| [FAQ-WORDING-FIX](FAQ-WORDING-FIX-2026-11-08.md) | Последнее исправление смешанного казахского и обрывков: 295 тестов, живые проверки и задержки |
| [DEEPSEEK-CHECK](DEEPSEEK-CHECK-2026-11-08.md) | Историческое сравнение моделей до исправления FAQ |
| [GRAPHITE-UI-CHECK](GRAPHITE-UI-CHECK-2026-11-08.md) | Проверка нового интерфейса и мобильной версии |
| [THREAT-MODEL](THREAT-MODEL.md) | Границы доверия, угрозы, проверки |
| [ADR](ADR.md) | Принятые архитектурные решения |
| [BACKLOG](BACKLOG.md) | Последовательность и критерии каждого требования |
| [VERIFICATION](VERIFICATION.md) | Свидетельства проверок и блокирующие ограничения |

Состояния: **запланировано** — только решение/контракт; **реализовано** — код существует;
**проверено** — названная проверка успешно выполнена. Создание файла или CI-конфига
не означает прохождения проверки. Частично проверенные требования перечисляются по частям.
