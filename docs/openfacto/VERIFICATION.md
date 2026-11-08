# Проверки OpenFacto

Актуальный переход на RabbitMQ и асинхронный Playground: [отчёт от 8 ноября](CHECK-RABBITMQ-2026-11-08.md). Ниже сохранена история предыдущих проверок, включая прежний Redis/BullMQ.

7 ноября 2026. Локальный каркас работает; основные функциональные проверки пройдены.
Это исходный журнал этапа 0. Результаты доменных проверок приведены ниже.

## Объединённый backend — 7 ноября 2026

NestJS запускает HTTP API, диспетчер и потребителей BullMQ в одном процессе.
Отдельная точка запуска Node worker удалена; `apps/worker` используется как библиотека.
Проверка выполнена на отдельной временной PostgreSQL-базе и Redis DB 13,
без перезапуска работающего локального кабинета.

- `pnpm check`: линтер, типы, 77 unit-тестов и сборки прошли.
- API integration: 5 сценариев прошли, включая HTTP → сохранённое задание → BullMQ →
  обработчик в том же процессе → completed; HTTP оставался доступен.
- Проверены штатное завершение потребителей через lifecycle NestJS и выход с кодом 1
  при недоступном брокере до открытия HTTP-порта.
- Доменные integration: 3 сценария ответов, бюджета и индексации FAQ прошли.
- API e2e: 9 тестов прошли.

Ниже сохранены результаты предыдущих этапов, включая прежний отдельный worker.

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

На момент исходной проверки оставалось подтвердить:

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

## Доменные сценарии

| Проверка | Наблюдаемый результат |
| --- | --- |
| Ответ модератора и доставка | В Chrome ответ сохранён через NestJS/PostgreSQL, кабинет показал очередь и обновил статус до «доставка не подтверждена» при смене состояния тестовой записи. Интеграция worker с подменённым Telegram проверила повреждённый ключ до отправки, восстановление ключа, две конкурирующие задачи, ответ 429 и потерю подтверждения. |
| Полная локальная приёмка | `pnpm verify:local` завершился успешно в отдельном Compose-проекте. После выключения и повторного запуска считаны запись PostgreSQL, ключ Redis, точка Qdrant и оригинал из S3. Проверены переходы readiness 200 → 503 → 200, Python HTTP и сканирование SPA. |
| Восстановление SQL из копии | PostgreSQL 18: опубликованный FAQ записан в отдельную базу, снят `pg_dump --format=custom`, выполнен `pg_restore` в пустую базу. Движок вернул ожидаемый утверждённый текст с исходным идентификатором версии и нулём платных операций. |
| Доступ и кабинет | Синтетический вход Telegram в Chrome → настоящий NestJS/PostgreSQL → создание организации и события → публикация FAQ → ответ со ссылкой в Playground. На мобильном экране 390×844 переключение на казахский прошло без горизонтальной прокрутки. |
| Права и модерация | HTTP-тесты PostgreSQL проверяют роли, изоляцию, назначение обращения, ответ, черновик FAQ, историю публикаций и отзыв. |
| PDF и поиск | Реальные PyMuPDF, SeaweedFS, Qdrant и PostgreSQL. Проверены закрытый оригинал, повторная индексация, выбор версии, отзыв во время поиска и очистка. Смешанный PDF с нечитаемыми страницами сохранил прежнюю публикацию. |
| Качество поиска | На 12 фрагментах и 24 вопросах RU/KK/EN семантический dense получил Recall@3 = 1,000, hybrid с переранжированием = 0,917. Результаты относятся к этому набору. [Корпус и условия](../../apps/worker/README.md) |
| WikiVibe | Живой тест с gpt-5.6-luna вернул ответ с проверенной цитатой. Повтор с тем же traceId переиспользовал результат двух оплаченных операций. При ответе провайдера 502 сработала передача модератору и резерв сохранился для сверки. |
| Оценки | Браузер отправил кейс через API. Отдельный worker обработал его и кабинет показал исход проверки и фактический источник. |

[Исторический зелёный CI фундамента](https://github.com/Feruum/OpenFacto/actions/runs/42289834653) относится к ранее опубликованному коммиту. Публичный Telegram webhook и доставка с реальным пользовательским ботом требуют ключей и внешнего HTTPS. Для производственной эксплуатации остаются staging, нагрузочные испытания и учение по совместному восстановлению PostgreSQL, приватного S3 и ключей шифрования. [Статусы](BACKLOG.md)
