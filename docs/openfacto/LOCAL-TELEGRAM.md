# Telegram при локальном запуске

После перезапуска 8 ноября 2026 временный Cloudflare tunnel не принимал сообщения: Telegram возвращал webhook error 530, QUIC не подключался, а HTTP/2 тоже получал ошибки TLS к edge. Поэтому локальный `@openfactobot` переведён на штатный long polling Telegram API через HTTPS.

```text
Telegram getUpdates → scripts/telegram-polling.mjs
  → аутентифицированный localhost:53000/webhooks/telegram/:botId
  → PostgreSQL inbox → RabbitMQ ai.questions → обычный AI consumer
  → outbox → Telegram sendMessage
```

Polling не меняет RAG, разрешённые группы, имена активации, проверку источников или правила отправки. Он только заменяет внешний входящий tunnel для локальной разработки. Удаление внешнего webhook выполняется с `drop_pending_updates: false`; offset продвигается только после успешного сохранения обновления через ingress. Повторная доставка защищена уникальностью `(bot_id, update_id)`.

Запускать ровно один polling receiver для бота, с тем же локальным DATABASE_URL и BOT_ENCRYPTION_KEY, что у backend:

```powershell
node --env-file=.env scripts/telegram-polling.mjs ac9c4d25-59f3-45c2-a4d5-9b8136dce161
```

Для текущей QA-базы DATABASE_URL переопределяется на локальный PostgreSQL, порт 55432, база `openfacto_qa`, как при запуске backend. Не публиковать токен и не передавать его аргументом командной строки. Receiver сам расшифровывает токен существующего бота и обновляет секрет локального ingress; значения секретов не выводятся в логи.

Одновременное использование webhook и getUpdates Telegram не поддерживает. Если настраивается публичный production webhook, сначала остановить локальный polling receiver. Его сетевые ошибки повторяются с паузой; конфликт 409 останавливает receiver, чтобы он не конкурировал с другим получателем.

Локальные процессы запущены скрыто в фоне. Логи: `.telegram-polling.stdout.log`, `.telegram-polling.stderr.log`. При штатном polling пустой `getWebhookInfo.url` ожидаем. Проверять нужно поступление inbox, решение и статус outbox, а не только успешную регистрацию URL.

Проверка восстановленного сообщения «лол работаешь?» 8 ноября: `social_greeting`, 0 мс в движке, outbox `sent`. Время доставки включает сеть и очередь; 0 мс не означает нулевую полную задержку. Добавлены регрессионные тесты коротких вопросов о доступности и три теста подтверждения offset при сбоях.

Документация протокола: https://core.telegram.org/bots/api#getupdates
