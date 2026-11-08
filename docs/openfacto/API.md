# REST API OpenFacto

Организатор обращается к Nest API с префиксом `/api/v1`. Бизнес-данные хранятся в PostgreSQL. Health и Telegram webhook расположены вне этого префикса. Для браузера настройте точный `MINI_APP_ORIGIN`, для удалённого развёртывания используйте HTTPS.

## Сессии и роли

| Метод и путь | Вход | Результат |
| --- | --- | --- |
| POST /auth/telegram | `{initData}` от Manager Bot | `{token,user}`, 200 |
| GET /me | Bearer-токен | Пользователь текущей сессии |
| POST /auth/logout | Bearer-токен | 204, сессия отозвана |
| GET /organizations | — | Страница доступных организаций с полем `role` |
| POST /organizations | `{name}` | Организация и роль owner |
| GET /organizations/:org/events | — | Страница мероприятий |
| POST /organizations/:org/events | `{name}` | Мероприятие в состоянии draft |
| GET /organizations/:org/memberships | — | Страница участников с ролями |
| POST /organizations/:org/memberships | `{telegramId,role}` | Membership ранее вошедшего пользователя |
| PATCH /organizations/:org/memberships/:id | `{role}` | Изменённая membership |
| DELETE /organizations/:org/memberships/:id | — | 204 |

Передавайте `Authorization: Bearer <token>`. Проверяются HMAC-SHA256 по `MANAGER_BOT_TOKEN`, подпись всех полей кроме hash, уникальность полей, Telegram user ID и auth_date. Окно входа составляет пять минут, допустимое опережение часов — 30 секунд. Один подписанный запуск можно обменять на сессию один раз. Срок жизни случайного токена составляет 12 часов. В SQL сохраняется его SHA-256. [Проверка Telegram Mini App initData](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).

| Операции | Роли |
| --- | --- |
| Список своих организаций, список и карточка мероприятий, агрегаты | Все пять ролей |
| Создание мероприятий, настройки, боты, аудит, назначения модераторов | owner, admin |
| Управление командой | owner выдаёт и изменяет любые роли; admin управляет editor, moderator, viewer |
| Черновики и версии источников, публикации, оригиналы PDF | owner, admin, editor |
| Playground | owner, admin, editor, moderator |
| Очередь обращений, ответ, закрытие, создание FAQ из ответа | owner, admin, moderator |

Удаление или понижение последнего owner возвращает 409. Организация создаётся вместе с owner в одной транзакции. Доступ к чужому мероприятию возвращает 404, нехватка роли внутри своей организации — 403. Preview использует источники с видимостью participant.

## Мероприятие

Далее `E` означает `/api/v1/organizations/:org/events/:event`. Для PATCH указывайте изменяемые поля.

| Маршрут | Назначение |
| --- | --- |
| GET E | Карточка с `status`, `faqOnly`, `handoffEnabled` |
| PATCH E | `{name?,status?,faqOnly?,handoffEnabled?}`; статусы draft, active, archived |
| GET E/sources | Страница FAQ и документов с полями черновика и publishedVersionId |
| POST E/sources | `{kind,title,body,language?,aliases?,visibility?}`; kind — faq или document, visibility — participant или internal |
| PATCH E/sources/:id | Редактировать title, body, language, aliases, visibility |
| DELETE E/sources/:id | 204, удалить источник и версии, запланировать очистку PDF |
| GET E/sources/:id/versions | Версии `{id,sourceId,number,title,body,language,aliases,visibility,ingestionStatus,pageDiagnostics,createdAt}` |
| POST E/sources/:id/publish | `{}` публикует новый снимок текста. `{versionId}` выбирает существующую готовую версию |
| POST E/sources/:id/rollback | `{versionId}`, выбрать версию этого же источника |
| POST E/sources/:id/revoke | Снять публикацию |
| POST E/sources/:id/pdf | Для document загрузить `{pdfBase64}`, вернуть pending-версию |
| GET E/sources/:id/versions/:versionId/pdf | Скачать проверенный по SHA-256 оригинал готовой версии как attachment |
| POST E/playground | `{question,language?,mode?,faqOnly?,handoffEnabled?,conversation?,requestId?}` → 202 `{requestId,status,decision?,errorCode?}` |
| GET E/playground/:requestId | Обычный Bearer-токен того же автора; 200 `{requestId,status,decision?,errorCode?}` в том же org/event scope |
| GET E/handoffs | Страница обращений. Статус обращения — open, resolved или closed. Отдельное поле `deliveryStatus` показывает доставку ответа модератора в Telegram: pending, sending, sent, failed, uncertain. При отсутствии записи отправки возвращается null. |
| POST E/handoffs/:id/assign | `{membershipId}`; модератор, администратор или владелец той же организации. null снимает назначение |
| POST E/handoffs/:id/reply | `{text,createFaqDraft?,language?}` закрывает вопрос ответом и ставит сообщение участнику в outbox |
| POST E/handoffs/:id/faq-draft | `{language?}`, создать один неопубликованный FAQ из решённого обращения |
| POST E/handoffs/:id/close | Закрыть открытое обращение без ответа участнику |
| GET E/analytics?days=30 | Счётчики questions, answered, handoffs, openHandoffs, sources, publishedSources. byMode содержит исходы, причины и p50/p95 durationMs. usage разделяет оплаченные, зарезервированные и неопределённые операции |
| GET E/audit | Страница записей `{id,action,actorId,resourceId,createdAt}` для этого события |
| GET/PATCH E/ai-settings | `{funding,dailyLimitMicros,hasKey}`. PATCH принимает funding platform/byok, dailyLimitMicros и опциональный key |

FAQ получает действующий текст из опубликованного снимка. Редактирование черновика не меняет уже опубликованный ответ. PDF принимается до 8 MiB с проверкой сигнатуры, хранится в закрытом S3, а выдача оригинала требует роли редактора или выше. Состояния обработки — uploading, pending, processing, ready, failed. Ручные текстовые версии имеют состояние none. Публикация загруженного PDF разрешена после ready. Поле pageDiagnostics содержит номера проблемных страниц со статусом needs_text или needs_ocr.

Playground принимает режимы `published_preview` и `draft_preview`, язык `ru`, `kk` или `en`.
`conversation` содержит до трёх предыдущих пар `{question,answer}` для понимания контекста.
POST фиксирует исходный ввод, автора, fingerprint и trace ID в SQL и возвращает 202;
LLM не вызывается в HTTP-запросе. Диспетчер передаёт ID в общую с Telegram очередь
RabbitMQ `ai.questions`; потребитель выполняет AnswerEngine.

| status | Поля ответа |
| --- | --- |
| pending / running | `requestId`, `status`; продолжать GET |
| completed | Дополнительно `decision` с `outcome`, `reasonCode`, `answer`, `language`, `traceId`, `steps`, `sources`, `usage`, `durationMs` |
| failed | Дополнительно `errorCode`: `job_failed`, `access_changed` или `legacy_request`; без внутренних исключений |

Передавайте `requestId` (UUIDv4) с первого POST и сохраняйте его вместе с исходным вводом
для повтора после сетевого сбоя. Если ID не задан, сервер создаёт его, но потерянный ответ
POST не позволяет клиенту безопасно восстановить этот ID. Повтор с тем же ID, автором,
org/event и вводом возвращает текущее состояние, в том числе pending/running, без новой работы.
Изменение вопроса, режима, флагов или conversation под тем же ID даёт 409.
GET не принимает отдельный секрет задания: используется обычная сессия того же автора.
Права проверяются при постановке, выполнении, фиксации и чтении результата. Архив события
или потеря актуальности источников завершённого решения, включая кандидатов trace, даёт 409;
потеря доступа к scope обрабатывается обычными 403/404. Чужой ID не раскрывает результат.

Preview сохраняет трассу проверки, не отправляет сообщение участнику и не создаёт живое
обращение. Решение и completed фиксируются одной транзакцией. Старые завершённые записи
сохраняются при миграции; незавершённые записи без восстановимого ввода становятся
failed/legacy_request. Клиент Mini App опрашивает GET не более пяти минут; после таймаута
повтор формы продолжает ту же работу с тем же ID и вводом.

Счётчики вопросов и ответов берутся из live-решений. Окно аналитики охватывает от 1 до 90
календарных дней UTC, включая текущий день. По умолчанию — 30 дней. Число открытых обращений
и размер базы знаний приводятся на момент запроса. Процентили учитывают завершённые решения
с измеренной задержкой за исключением ignored. Недостаток средств и недоступность провайдера
обрабатывает общая политика AnswerEngine. Суммы указываются в миллионных долях USD. Для
platform дополнительно применяется общий серверный лимит. Передача `key:null` очищает
сохранённый ключ, если выбран platform.

## Telegram

| Маршрут | Назначение |
| --- | --- |
| GET E/bots | Страница ботов без секретов |
| POST E/bots | `{name,token,webhookSecret,allowedChatIds?,aliases?,groupMode?,privateMode?}`; getMe устанавливает реальную идентичность бота |
| PATCH E/bots/:id | `{active?,aliases?,allowedChatIds?,groupMode?,privateMode?}` |
| POST E/bots/:id/rotate | `{token,webhookSecret}`; заменить секреты только для той же Telegram identity |
| POST E/bots/:id/webhook | `{webhookSecret}`; повторить setWebhook для сконфигурированного PUBLIC_WEBHOOK_ORIGIN |
| POST /webhooks/telegram/:botId | Telegram ingress по `X-Telegram-Bot-Api-Secret-Token` |

Поддерживаются `groupMode=off|mention_only|mention_or_name|all_relevant`, `privateMode=off|always`. Группы должны явно входить в allowedChatIds. Токен шифруется AES-256-GCM с привязкой к bot ID и серверным ключом `BOT_ENCRYPTION_KEY` (32 байта base64). Webhook secret содержит 16–256 символов A–Z, a–z, 0–9, _ или -. API хранит его хеш.

При заданном публичном HTTPS origin регистрация и ротация вызывают Telegram setWebhook. При сбое после сохранения можно найти бот в GET E/bots и повторить установку по его id. При ручной настройке используйте /webhooks/telegram/:botId и тот же secret. Входящий update принимается для активного бота и мероприятия в состоянии active. Сервер определяет scope по bot ID. Уникальность (bot_id,update_id) исключает повторную запись. HTTP 200 подтверждает durable inbox; фактическая доставка происходит отдельно.

## HTTP и постраничные списки

### Оценка качества ответов

Для выбранного мероприятия `POST E/evaluations` принимает от 1 до 20 примеров в `cases`.
У каждого примера есть `question`, `language`, `expectedOutcome` и необязательный
`expectedSourceId`. Доступ имеют owner/admin/editor. SQL фиксирует состав публикаций,
модель, настройки и автора. Worker повторно проверяет его доступ и выполняет по одному
примеру в отдельной очереди. Смена публикации во время прогона завершает его со статусом failed.
`GET E/evaluations` и `GET E/evaluations/:id` возвращают статус и результаты с фактическим
исходом, причиной, источниками, расходом и задержкой. Telegram-доставка и модерация
для этих прогонов отключены. [Устройство оценки](AI-PIPELINE.md)

Ресурсы идентифицируются UUID. Telegram IDs в публичных полях передаются десятичными строками. Для списков используются `?cursor=&limit=` и ответ `{items,nextCursor}`, по умолчанию 20 и максимум 100. Следующий cursor привязан к коллекции и scope, сортировка — по UUID. При завершении nextCursor равен null.

`GET /health/live` возвращает 200 `{"status":"ok"}`. `GET /health/ready` параллельно проверяет PostgreSQL и RabbitMQ, возвращает 200 или 503 и карту dependencies с ключами `postgres` и `rabbitmq`. Бизнес-ошибки имеют вид `{"code":"FORBIDDEN","message":"Access denied","requestId":"…"}`. Сервер задаёт x-request-id и Cache-Control: no-store. Он регистрирует HTTP status и duration без тела запроса, query string, ключей и bot token.
