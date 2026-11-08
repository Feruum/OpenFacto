import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { roles } from '@openfacto/contracts';
import { PRODUCT, ProductAccess, type Auth } from './access.js';
import { choice, first, identifier, managing, object, range, string, type Fields } from './input.js';

@Controller()
export class OrganizationsController {
  constructor(@Inject(PRODUCT) private readonly access: ProductAccess) {}
  @Post('auth/telegram')
  @HttpCode(200)
  login(@Body() body: unknown) {
    return this.access.login(object(body).initData);
  }
  @Post('auth/logout')
  @HttpCode(204)
  async logout(@Headers('authorization') auth: Auth) {
    const hash = this.access.tokenHash(auth);
    await this.access.database.client`UPDATE sessions SET revoked=true WHERE token_hash=${hash}`;
  }
  @Get('me')
  me(@Headers('authorization') auth: Auth) {
    return this.access.database.client.begin((tx) => this.access.user(tx, auth));
  }
  @Get('organizations')
  organizations(@Headers('authorization') auth: Auth, @Query() query: Fields) {
    return this.access.database.client.begin(async (tx) => {
      const user = await this.access.user(tx, auth);
      const p = range(query, 'organizations/' + user.id);
      return p.page(
        await tx`SELECT o.id,o.name,o.created_at AS "createdAt",m.role FROM organizations o JOIN memberships m ON m.organization_id=o.id
        WHERE m.user_id=${user.id} AND o.id>${p.after} ORDER BY o.id LIMIT ${p.limit + 1}`,
      );
    });
  }
  @Post('organizations')
  createOrg(@Headers('authorization') auth: Auth, @Body() body: unknown) {
    const name = string(object(body).name);
    return this.access.database.client.begin(async (tx) => {
      const user = await this.access.user(tx, auth);
      const org = first(
        await tx`INSERT INTO organizations(name) VALUES(${name}) RETURNING id,name,created_at AS "createdAt"`,
      );
      await tx`INSERT INTO memberships(user_id,organization_id,role) VALUES(${user.id},${org.id},'owner')`;
      return { ...org, role: 'owner' };
    });
  }
  @Get('organizations/:org/events')
  events(@Headers('authorization') auth: Auth, @Param('org') org: string, @Query() query: Fields) {
    return this.access.database.client.begin(async (tx) => {
      await this.access.organization(tx, auth, org);
      const p = range(query, 'events/' + org);
      return p.page(
        await tx`SELECT id,organization_id AS "organizationId",name,status,created_at AS "createdAt",updated_at AS "updatedAt"
        FROM events WHERE organization_id=${org} AND id>${p.after} ORDER BY id LIMIT ${p.limit + 1}`,
      );
    });
  }
  @Post('organizations/:org/events')
  createEvent(@Headers('authorization') auth: Auth, @Param('org') org: string, @Body() body: unknown) {
    const name = string(object(body).name);
    return this.access.database.client.begin(async (tx) => {
      await this.access.organization(tx, auth, org, managing);
      return first(
        await tx`INSERT INTO events(organization_id,name) VALUES(${org},${name})
        RETURNING id,organization_id AS "organizationId",name,status,created_at AS "createdAt",updated_at AS "updatedAt"`,
      );
    });
  }
  @Get('organizations/:org/memberships')
  memberships(@Headers('authorization') auth: Auth, @Param('org') org: string, @Query() query: Fields) {
    return this.access.database.client.begin(async (tx) => {
      await this.access.organization(tx, auth, org, managing);
      const p = range(query, 'memberships/' + org);
      return p.page(
        await tx`SELECT m.id,m.user_id AS "userId",m.organization_id AS "organizationId",m.role,u.display_name AS "displayName"
        FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.organization_id=${org} AND m.id>${p.after} ORDER BY m.id LIMIT ${p.limit + 1}`,
      );
    });
  }
  @Post('organizations/:org/memberships')
  grant(@Headers('authorization') auth: Auth, @Param('org') org: string, @Body() value: unknown) {
    const body = object(value),
      role = choice(body.role, roles),
      telegramId = string(body.telegramId, 32);
    if (!/^[1-9]\d*$/.test(telegramId)) throw new BadRequestException();
    return this.access.database.client.begin(async (tx) => {
      const { role: actor } = await this.access.organization(tx, auth, org, managing);
      if (managing.some((r) => r === role) && actor !== 'owner') throw new ForbiddenException();
      const user = first(await tx`SELECT id FROM users WHERE telegram_id=${telegramId}`);
      const [row] = await tx`INSERT INTO memberships(organization_id,user_id,role) VALUES(${org},${user.id},${role})
        ON CONFLICT(organization_id,user_id) DO NOTHING RETURNING id,role,user_id AS "userId",organization_id AS "organizationId"`;
      if (!row) throw new ConflictException();
      return row;
    });
  }
  @Patch('organizations/:org/memberships/:id')
  changeRole(
    @Headers('authorization') auth: Auth,
    @Param('org') org: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.modifyMember(auth, org, id, choice(object(body).role, roles));
  }
  @Delete('organizations/:org/memberships/:id')
  @HttpCode(204)
  async removeMember(@Headers('authorization') auth: Auth, @Param('org') org: string, @Param('id') id: string) {
    await this.modifyMember(auth, org, id, null);
  }
  private modifyMember(auth: Auth, org: string, id: string, role: (typeof roles)[number] | null) {
    return this.access.database.client.begin(async (tx) => {
      await this.access.user(tx, auth);
      const organization = identifier(org),
        member = identifier(id);
      first(
        await tx`SELECT o.id FROM organizations o JOIN memberships m ON m.organization_id=o.id
        JOIN sessions s ON s.user_id=m.user_id WHERE o.id=${organization} AND s.token_hash=${this.access.tokenHash(auth)} FOR UPDATE OF o`,
      );
      const { role: actor } = await this.access.organization(tx, auth, organization, managing);
      const target = first(
        await tx`SELECT role FROM memberships WHERE organization_id=${organization} AND id=${member} FOR UPDATE`,
      );
      if (managing.some((r) => r === role || r === target.role) && actor !== 'owner') throw new ForbiddenException();
      if (target.role === 'owner' && role !== 'owner') {
        const [count] =
          await tx`SELECT count(*)::int AS n FROM memberships WHERE organization_id=${organization} AND role='owner'`;
        if (count!.n <= 1) throw new ConflictException();
      }
      if (role === null) {
        await tx`DELETE FROM memberships WHERE organization_id=${organization} AND id=${member}`;
        return;
      }
      return first(
        await tx`UPDATE memberships SET role=${role} WHERE organization_id=${organization} AND id=${member}
        RETURNING id,role,user_id AS "userId",organization_id AS "organizationId"`,
      );
    });
  }
}
