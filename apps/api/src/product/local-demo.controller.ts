import { randomBytes, randomUUID } from 'node:crypto';
import { Controller, Header, HttpCode, Inject, NotFoundException, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { ApiConfig } from '@openfacto/config';
import { PRODUCT, ProductAccess } from './access.js';
import { digest } from './telegram-auth.js';

export const LOCAL_DEMO_CONFIG = Symbol('local-demo-config');
const loopback = (host: string) => ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host);
export function localDemoEnabled(config: ApiConfig, enabled: string | undefined) {
  try {
    return enabled === '1' && config.nodeEnv === 'development' && loopback(config.host) &&
      loopback(new URL(config.databaseUrl).hostname) && loopback(new URL(config.miniAppOrigin).hostname);
  } catch { return false; }
}
export function localDemoRequestAllowed(config: ApiConfig, request: {
  origin?: string; host?: string; peer?: string; forwarded: boolean;
}) {
  try {
    const host = new URL('http://' + request.host);
    return !request.forwarded && request.origin === config.miniAppOrigin && loopback(host.hostname) &&
      Number(host.port || 80) === config.port && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.peer ?? '');
  } catch { return false; }
}

const examples = [
  ['Где проходит регистрация?', 'Регистрация проходит с 09:00 до 10:00 в фойе главного зала.'],
  ['Как получить бейдж?', 'Покажите QR-код билета на стойке регистрации, чтобы получить бейдж.'],
  ['Когда начинается мероприятие?', 'Открытие пройдёт в главном зале в 10:00. Начало секций в 11:00.'],
];

/** Registered only by an explicitly opted-in, loopback-bound development API. */
@Controller('auth/local-demo')
export class LocalDemoController {
  private readonly userId = randomUUID();
  private readonly telegramId = (BigInt('0x' + randomBytes(6).toString('hex')) + 1n).toString();
  constructor(@Inject(PRODUCT) private readonly access: ProductAccess,
    @Inject(LOCAL_DEMO_CONFIG) private readonly config: ApiConfig) {}

  @Post()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async login(@Req() request: Request) {
    if (!localDemoEnabled(this.config, process.env.LOCAL_DEMO_ENABLED) || !localDemoRequestAllowed(this.config, {
      origin: request.get('origin'), host: request.get('host'), peer: request.socket.remoteAddress,
      forwarded: Object.keys(request.headers).some(key => key === 'forwarded' || key.startsWith('x-forwarded-')),
    })) throw new NotFoundException();
    const token = randomBytes(32).toString('base64url');
    return this.access.database.client.begin(async sql => {
      // One workspace per API process, not per reload. All reads/writes afterwards use normal access checks.
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${this.userId},0))`;
      const created = await sql`INSERT INTO users(id,telegram_id,display_name,locale)
        VALUES(${this.userId},${this.telegramId},'Локальный тестовый кабинет','ru') ON CONFLICT(id) DO NOTHING RETURNING id`;
      if (created.length) {
        const [org] = await sql`INSERT INTO organizations(name) VALUES('Локальная проверка OpenFacto') RETURNING id`;
        await sql`INSERT INTO memberships(organization_id,user_id,role) VALUES(${org!.id},${this.userId},'owner')`;
        const [event] = await sql`INSERT INTO events(organization_id,name,status) VALUES(${org!.id},'Alatau Summit · тест','active') RETURNING id`;
        for (const [title, body] of examples) {
          const [source] = await sql`INSERT INTO knowledge_sources(organization_id,event_id,kind,title,body,language,visibility)
            VALUES(${org!.id},${event!.id},'faq',${title!},${body!},'ru','participant') RETURNING id`;
          const [version] = await sql`INSERT INTO source_versions(organization_id,event_id,source_id,number,title,body,language,aliases,visibility)
            VALUES(${org!.id},${event!.id},${source!.id},1,${title!},${body!},'ru','{}','participant') RETURNING id`;
          await sql`UPDATE knowledge_sources SET published_version_id=${version!.id} WHERE id=${source!.id}`;
        }
      }
      await sql`DELETE FROM sessions WHERE user_id=${this.userId} AND expires_at<=now()`;
      await sql`INSERT INTO sessions(user_id,token_hash,init_hash,expires_at)
        VALUES(${this.userId},${digest(token)},${digest('local-demo/' + token)},now()+interval '12 hours')`;
      const [user] = await sql`SELECT id,telegram_id AS "telegramId",display_name AS "displayName",locale,created_at AS "createdAt"
        FROM users WHERE id=${this.userId}`;
      return { token, user };
    });
  }
}
