import { randomBytes } from 'node:crypto';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { createDatabase, type Database, type Transaction } from '@openfacto/database';
import { first, identifier, type Scope } from './input.js';
import { digest, verifyTelegram } from './telegram-auth.js';

export const PRODUCT = Symbol('product');
export type Auth = string | undefined;
export class ProductAccess {
  readonly database: Database;
  constructor(url: string) {
    this.database = createDatabase(url, 10000);
  }
  async onModuleDestroy() {
    await this.database.close();
  }
  async login(initData: unknown) {
    const identity = verifyTelegram(initData, process.env.MANAGER_BOT_TOKEN);
    const token = randomBytes(32).toString('base64url');
    return this.database.client.begin(async (sql) => {
      // Expired sessions outlive Telegram's five-minute replay window.
      await sql`DELETE FROM sessions WHERE token_hash IN
        (SELECT token_hash FROM sessions WHERE expires_at<=now() LIMIT 100 FOR UPDATE SKIP LOCKED)`;
      const [user] = await sql`INSERT INTO users(telegram_id,display_name,locale)
        VALUES(${identity.telegramId},${identity.displayName},${identity.language})
        ON CONFLICT(telegram_id) DO UPDATE SET display_name=excluded.display_name
        RETURNING id, telegram_id AS "telegramId", display_name AS "displayName",locale,created_at AS "createdAt"`;
      const result = await sql`INSERT INTO sessions(user_id,token_hash,init_hash,expires_at)
        VALUES(${user!.id},${digest(token)},${identity.initHash},now()+interval '12 hours')
        ON CONFLICT(init_hash) DO NOTHING RETURNING user_id`;
      if (!result.length) throw new UnauthorizedException();
      return { token, user };
    });
  }
  tokenHash(auth: Auth) {
    if (!auth || !/^Bearer [A-Za-z0-9_-]{43}$/.test(auth)) throw new UnauthorizedException();
    return digest(auth.slice(7));
  }
  async user(sql: Transaction, auth: Auth) {
    const [row] =
      await sql`SELECT u.id,u.display_name AS "displayName",u.telegram_id AS "telegramId",u.locale,u.created_at AS "createdAt"
      FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.token_hash=${this.tokenHash(auth)} AND NOT s.revoked AND s.expires_at>now()
      FOR SHARE OF s`;
    if (!row) throw new UnauthorizedException();
    await sql`SELECT set_config('openfacto.actor',${row.id}::text,true)`;
    return row;
  }
  async organization(sql: Transaction, auth: Auth, organization: string, allowed: readonly string[] = []) {
    const org = identifier(organization);
    const user = await this.user(sql, auth);
    const membership = first(
      await sql`SELECT role FROM memberships WHERE organization_id=${org} AND user_id=${user.id} FOR SHARE`,
    );
    if (allowed.length && !allowed.includes(membership.role)) throw new ForbiddenException();
    return { org, user, role: membership.role as string };
  }
  scoped<T>(
    auth: Auth,
    org: string,
    event: string,
    roles: readonly string[],
    fn: (tx: Transaction, scope: Scope) => Promise<T>,
  ) {
    return this.database.client.begin(async (tx) => {
      await this.organization(tx, auth, org, roles);
      const scope = { org: identifier(org), event: identifier(event) };
      first(await tx`SELECT id FROM events WHERE organization_id=${scope.org} AND id=${scope.event} FOR SHARE`);
      return fn(tx, scope);
    });
  }
}
