import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common';
import { decryptBotToken, encryptBotToken, type Transaction } from '@openfacto/database';
import { requestBusinessWake } from '@openfacto/worker/wake';
import { PRODUCT, ProductAccess, type Auth } from './access.js';
import {
  boolean,
  choice,
  first,
  identifier,
  list,
  managing,
  object,
  range,
  string,
  type Fields,
  type Scope,
} from './input.js';
import { digest, sameDigest } from './telegram-auth.js';

export const encryptionKey = () => {
  const value = process.env.BOT_ENCRYPTION_KEY;
  if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new ServiceUnavailableException();
  return value;
};
const publicFields = (
  tx: Transaction,
) => tx`id,name,username,telegram_bot_id AS "telegramBotId",active,aliases,allowed_chat_ids AS "allowedChatIds",
  group_mode AS "groupMode",private_mode AS "privateMode"`;
const groupModes = ['off', 'mention_only', 'mention_or_name', 'all_relevant'] as const;
const privateModes = ['off', 'always'] as const;
function chatIds(value: unknown) {
  const chats = list(value, 100);
  if (chats.some((id) => !/^-[1-9]\d{0,18}$/.test(id))) throw new BadRequestException();
  return chats;
}
async function telegram(token: string, action: 'getMe' | 'setWebhook', data: unknown = {}) {
  try {
    const r = await fetch('https://api.telegram.org/bot' + token + '/' + action, {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(6000),
    });
    if (r.status === 401 || r.status === 404) throw new BadRequestException();
    if (!r.ok) throw new Error();
    const body = (await r.json()) as { ok?: boolean; result?: unknown };
    if (!body.ok) throw new Error();
    return body.result;
  } catch (err) {
    if (err instanceof BadRequestException) throw err;
    throw new ServiceUnavailableException();
  }
}
async function verifiedToken(value: unknown, secretValue: unknown) {
  const token = string(value, 160),
    secret = string(secretValue, 256);
  if (
    !/^[1-9]\d{0,18}:[\w-]{20,120}$/.test(token) ||
    !/^[A-Za-z0-9_-]{16,256}$/.test(secret) ||
    token.split(':')[0] === process.env.MANAGER_BOT_TOKEN?.split(':')[0]
  )
    throw new BadRequestException();
  const me = object(await telegram(token, 'getMe'));
  if (
    me.is_bot !== true ||
    !Number.isSafeInteger(me.id) ||
    String(me.id) !== token.split(':')[0] ||
    typeof me.username !== 'string'
  )
    throw new BadRequestException();
  return { token, secret, telegramId: String(me.id), username: me.username };
}
@Controller('organizations/:org/events/:event/bots')
export class BotsController {
  constructor(@Inject(PRODUCT) private readonly access: ProductAccess) {}
  @Get()
  all(@Headers('authorization') auth: Auth, @Param() p: Scope, @Query() query: Fields) {
    return this.access.scoped(auth, p.org, p.event, managing, async (tx, s) => {
      const page = range(query, 'bots/' + s.org + '/' + s.event);
      return page.page(
        await tx`SELECT ${publicFields(tx)} FROM telegram_bots WHERE (organization_id,event_id)=(${s.org},${s.event})
        AND id>${page.after} ORDER BY id LIMIT ${page.limit + 1}`,
      );
    });
  }
  @Post()
  async create(@Headers('authorization') auth: Auth, @Param() p: Scope, @Body() raw: unknown) {
    const b = object(raw),
      name = string(b.name),
      id = randomUUID();
    const allowed = chatIds(b.allowedChatIds ?? []),
      aliases = list(b.aliases ?? []);
    const group = choice(b.groupMode ?? 'mention_or_name', groupModes),
      priv = choice(b.privateMode ?? 'always', privateModes);
    await this.access.scoped(auth, p.org, p.event, managing, async () => true);
    const { token, secret, username, telegramId } = await verifiedToken(b.token, b.webhookSecret);
    const ciphertext = encryptBotToken(token, encryptionKey(), id);
    const bot = await this.access.scoped(auth, p.org, p.event, managing, async (tx, s) => {
      const [row] =
        await tx`INSERT INTO telegram_bots(id,organization_id,event_id,name,telegram_bot_id,username,token_ciphertext,webhook_secret_hash,allowed_chat_ids,aliases,group_mode,private_mode)
        VALUES(${id},${s.org},${s.event},${name},${telegramId},${username},${ciphertext},${digest(secret)},${tx.array(allowed)},${tx.array(aliases)},${group},${priv})
        ON CONFLICT(telegram_bot_id) DO NOTHING RETURNING ${publicFields(tx)}`;
      if (!row) throw new ConflictException();
      return row;
    });
    if (process.env.PUBLIC_WEBHOOK_ORIGIN) await this.setupWebhook(auth, { ...p, id }, { webhookSecret: secret });
    return bot;
  }
  @Post(':id/rotate')
  @HttpCode(200)
  async rotate(@Headers('authorization') auth: Auth, @Param() p: Scope & { id: string }, @Body() raw: unknown) {
    const b = object(raw),
      id = identifier(p.id);
    await this.access.scoped(auth, p.org, p.event, managing, async (tx, s) =>
      first(await tx`SELECT id FROM telegram_bots WHERE (organization_id,event_id,id)=(${s.org},${s.event},${id})`),
    );
    const { token, secret, telegramId, username } = await verifiedToken(b.token, b.webhookSecret);
    const result = await this.access.scoped(auth, p.org, p.event, managing, async (tx, s) =>
      first(
        await tx`UPDATE telegram_bots SET token_ciphertext=${encryptBotToken(token, encryptionKey(), id)},
      username=${username},webhook_secret_hash=${digest(secret)} WHERE (organization_id,event_id,id)=(${s.org},${s.event},${id}) AND telegram_bot_id=${telegramId}
      RETURNING ${publicFields(tx)}`,
      ),
    );
    if (result.active && process.env.PUBLIC_WEBHOOK_ORIGIN) await this.setupWebhook(auth, p, { webhookSecret: secret });
    return result;
  }
  @Patch(':id')
  update(@Headers('authorization') auth: Auth, @Param() p: Scope & { id: string }, @Body() raw: unknown) {
    const b = object(raw),
      id = identifier(p.id);
    return this.access.scoped(auth, p.org, p.event, managing, async (tx, s) => {
      const row = first(
        await tx`SELECT ${publicFields(tx)} FROM telegram_bots WHERE (organization_id,event_id,id)=(${s.org},${s.event},${id}) FOR UPDATE`,
      );
      return first(
        await tx`UPDATE telegram_bots SET active=${boolean(b.active, row.active)},allowed_chat_ids=${tx.array(chatIds(b.allowedChatIds ?? row.allowedChatIds))},
        group_mode=${choice(b.groupMode ?? row.groupMode, groupModes)},private_mode=${choice(b.privateMode ?? row.privateMode, privateModes)},
        aliases=${tx.array(list(b.aliases ?? row.aliases))} WHERE (organization_id,event_id,id)=(${s.org},${s.event},${id}) RETURNING ${publicFields(tx)}`,
      );
    });
  }
  @Post(':id/webhook')
  @HttpCode(200)
  async setupWebhook(@Headers('authorization') auth: Auth, @Param() p: Scope & { id: string }, @Body() raw: unknown) {
    const id = identifier(p.id),
      secret = string(object(raw).webhookSecret, 256);
    const origin = process.env.PUBLIC_WEBHOOK_ORIGIN;
    if (!origin || !origin.startsWith('https://') || new URL(origin).origin !== origin)
      throw new ServiceUnavailableException();
    return this.access.scoped(auth, p.org, p.event, managing, async (tx, s) => {
      const bot = first(
        await tx`SELECT token_ciphertext,webhook_secret_hash FROM telegram_bots WHERE (organization_id,event_id,id)=(${s.org},${s.event},${id}) AND active FOR UPDATE`,
      );
      if (!sameDigest(digest(secret), bot.webhook_secret_hash)) throw new BadRequestException();
      // Serialize registration with credential rotations for this bot.
      await telegram(decryptBotToken(bot.token_ciphertext, encryptionKey(), id), 'setWebhook', {
        url: origin + '/webhooks/telegram/' + id,
        secret_token: secret,
        allowed_updates: ['message'],
      });
      return { configured: true };
    });
  }
}

@Controller('webhooks/telegram')
export class WebhookController {
  constructor(@Inject(PRODUCT) private readonly access: ProductAccess) {}
  @Post(':id')
  @HttpCode(200)
  async receive(
    @Param('id') route: string,
    @Headers('x-telegram-bot-api-secret-token') secret: string | undefined,
    @Body() raw: unknown,
  ) {
    const id = identifier(route);
    if (!secret || secret.length > 256) throw new NotFoundException();
    const payload = object(raw),
      update = payload.update_id;
    if (typeof update !== 'number' || !Number.isSafeInteger(update) || update < 0) throw new BadRequestException();
    await this.access.database.client.begin(async (tx) => {
      // This ingress resolves its tenant exclusively from the authenticated bot mapping.
      const bot = first(
        await tx`SELECT b.organization_id,b.event_id,b.webhook_secret_hash FROM telegram_bots b JOIN events e
        ON (e.organization_id,e.id)=(b.organization_id,b.event_id) WHERE b.id=${id} AND b.active AND e.status='active' FOR SHARE`,
      );
      if (!sameDigest(digest(secret), bot.webhook_secret_hash)) throw new NotFoundException();
      await tx`INSERT INTO telegram_inbox(organization_id,event_id,bot_id,update_id,payload)
        VALUES(${bot.organization_id},${bot.event_id},${id},${String(update)},${tx.json(JSON.parse(JSON.stringify(payload)))})
        ON CONFLICT(bot_id,update_id) DO NOTHING`;
    });
    requestBusinessWake();
    return { ok: true };
  }
}
