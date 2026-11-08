import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { encryptBotToken, type Transaction } from '@openfacto/database';
import { playground, playgroundStatus } from './playground.js';
import { report, reportDays } from './analytics.js';
import { PRODUCT, ProductAccess, type Auth } from './access.js';
import { encryptionKey } from './bots.controller.js';
import {
  boolean,
  editing,
  choice,
  first,
  identifier,
  languages,
  managing,
  moderating,
  object,
  range,
  string,
  type Fields,
  type Scope,
} from './input.js';

const eventFields = (tx: Transaction) =>
  tx`id,name,status,organization_id AS "organizationId",faq_only AS "faqOnly",handoff_enabled AS "handoffEnabled",created_at AS "createdAt",updated_at AS "updatedAt"`;
const ticketFields = (tx: Transaction) =>
  tx`id,question,status,reply,created_at AS "createdAt",faq_draft_id AS "faqDraftId",assigned_membership_id AS "assignedMembershipId",
    CASE WHEN reply IS NOT NULL THEN (SELECT o.status FROM telegram_outbox o
      WHERE (o.organization_id,o.event_id,o.bot_id,o.chat_id)=(handoffs.organization_id,handoffs.event_id,handoffs.bot_id,handoffs.chat_id)
      AND o.dedupe_key='reply:' || handoffs.id::text) END AS "deliveryStatus"`;
async function ticketDraft(tx: Transaction, s: Scope, id: string, language: string) {
  const ticket = first(
    await tx`SELECT ${ticketFields(tx)} FROM handoffs WHERE (organization_id,event_id,id)=(${s.org},${s.event},${id}) FOR UPDATE`,
  );
  if (ticket.status !== 'resolved' || !ticket.reply) throw new ConflictException();
  if (ticket.faqDraftId) return { id: ticket.faqDraftId };
  const draft = first(
    await tx`INSERT INTO knowledge_sources(organization_id,event_id,kind,title,body,language)
    VALUES(${s.org},${s.event},'faq',${ticket.question},${ticket.reply},${language}) RETURNING id`,
  );
  await tx`UPDATE handoffs SET faq_draft_id=${draft.id} WHERE (organization_id,event_id,id)=(${s.org},${s.event},${id})`;
  return draft;
}
@Controller('organizations/:org/events/:event')
export class EventsController {
  constructor(@Inject(PRODUCT) private readonly access: ProductAccess) {}
  @Get()
  get(@Headers('authorization') auth: Auth, @Param() p: Scope) {
    return this.access.scoped(auth, p.org, p.event, [], async (tx, s) =>
      first(
        await tx`SELECT ${eventFields(tx)} FROM events
      WHERE organization_id=${s.org} AND id=${s.event}`,
      ),
    );
  }
  @Patch()
  update(@Headers('authorization') auth: Auth, @Param() p: Scope, @Body() raw: unknown) {
    const b = object(raw);
    return this.access.database.client.begin(async (tx) => {
      await this.access.organization(tx, auth, p.org, managing);
      const id = identifier(p.event);
      return first(
        await tx`UPDATE events SET name=COALESCE(${b.name === undefined ? null : string(b.name)},name),
        status=COALESCE(${b.status === undefined ? null : choice(b.status, ['draft', 'active', 'archived'] as const)}::event_status,status),
        faq_only=COALESCE(${b.faqOnly === undefined ? null : boolean(b.faqOnly)}::boolean,faq_only),
        handoff_enabled=COALESCE(${b.handoffEnabled === undefined ? null : boolean(b.handoffEnabled)}::boolean,handoff_enabled),updated_at=now()
        WHERE organization_id=${p.org} AND id=${id} RETURNING ${eventFields(tx)}`,
      );
    });
  }
  @Post('playground')
  @HttpCode(202)
  playground(@Headers('authorization') auth: Auth, @Param() p: Scope, @Body() raw: unknown) {
    return playground(this.access, auth, p, raw);
  }
  @Get('playground/:id')
  playgroundStatus(@Headers('authorization') auth: Auth, @Param() p: Scope & { id: string }) {
    return playgroundStatus(this.access, auth, p, p.id);
  }
  @Get('handoffs')
  tickets(@Headers('authorization') auth: Auth, @Param() p: Scope, @Query() query: Fields) {
    return this.access.scoped(auth, p.org, p.event, moderating, async (tx, s) => {
      const page = range(query, 'handoffs/' + s.org + '/' + s.event);
      return page.page(
        await tx`SELECT ${ticketFields(tx)} FROM handoffs WHERE organization_id=${s.org} AND event_id=${s.event}
        AND id>${page.after} ORDER BY id LIMIT ${page.limit + 1}`,
      );
    });
  }
  @Post('handoffs/:id/reply')
  @HttpCode(200)
  reply(@Headers('authorization') auth: Auth, @Param() p: Scope & { id: string }, @Body() raw: unknown) {
    const b = object(raw),
      reply = string(b.text, 4000),
      id = identifier(p.id),
      createDraft = boolean(b.createFaqDraft),
      lang = choice(b.language ?? 'ru', languages);
    return this.access.scoped(auth, p.org, p.event, moderating, async (tx, s) => {
      const ticket = first(
        await tx`SELECT * FROM handoffs WHERE (organization_id,event_id,id)=(${s.org},${s.event},${id}) FOR UPDATE`,
      );
      if (ticket.status !== 'open' && ticket.reply !== reply) throw new ConflictException();
      if (ticket.status === 'open') {
        await tx`UPDATE handoffs SET status='resolved',reply=${reply} WHERE (organization_id,event_id,id)=(${s.org},${s.event},${id})`;
        if (ticket.bot_id && ticket.chat_id)
          await tx`INSERT INTO telegram_outbox(organization_id,event_id,bot_id,chat_id,thread_id,body,dedupe_key)
          VALUES(${s.org},${s.event},${ticket.bot_id},${ticket.chat_id},${ticket.thread_id},${reply},${'reply:' + id}) ON CONFLICT(bot_id,dedupe_key) DO NOTHING`;
      }
      if (createDraft) await ticketDraft(tx, s, id, lang);
      return first(
        await tx`SELECT ${ticketFields(tx)} FROM handoffs WHERE (organization_id,event_id,id)=(${s.org},${s.event},${id})`,
      );
    });
  }
  @Post('handoffs/:id/faq-draft')
  draft(@Headers('authorization') auth: Auth, @Param() p: Scope & { id: string }, @Body() raw: unknown) {
    const lang = choice(object(raw ?? {}).language ?? 'ru', languages);
    return this.access.scoped(auth, p.org, p.event, moderating, (tx, s) => ticketDraft(tx, s, identifier(p.id), lang));
  }
  // Export after a human publishes the moderator's FAQ; never auto-publish or run paid evaluations.
  @Get('handoffs/:id/evaluation-case')
  evaluationCase(@Headers('authorization') auth: Auth, @Param() p: Scope & { id: string }) {
    return this.access.scoped(auth, p.org, p.event, editing, async (tx, s) => {
      const [row] = await tx`SELECT h.question,k.id as source_id,v.language,v.body FROM handoffs h
        JOIN knowledge_sources k ON (k.organization_id,k.event_id,k.id)=(h.organization_id,h.event_id,h.faq_draft_id)
        JOIN source_versions v ON (v.organization_id,v.event_id,v.source_id,v.id)=(k.organization_id,k.event_id,k.id,k.published_version_id)
        WHERE (h.organization_id,h.event_id,h.id)=(${s.org},${s.event},${identifier(p.id)})
          AND h.status='resolved' AND v.visibility='participant' AND k.kind='faq'`;
      if (!row) throw new ConflictException('Publish the reviewed FAQ draft first');
      return { cases: [{ question: row.question, language: row.language, expectedOutcome: 'approved_faq', expectedSourceId: row.source_id }],
        referenceAnswer: row.body, reviewRequired: true };
    });
  }
  @Post('handoffs/:id/assign')
  @HttpCode(200)
  assign(@Headers('authorization') auth: Auth, @Param() p: Scope & { id: string }, @Body() raw: unknown) {
    const b = object(raw),
      id = identifier(p.id),
      member = b.membershipId === null ? null : identifier(b.membershipId);
    return this.access.scoped(auth, p.org, p.event, managing, async (tx, s) => {
      if (member)
        first(
          await tx`SELECT id FROM memberships WHERE organization_id=${s.org} AND id=${member} AND role IN ('owner','admin','moderator') FOR SHARE`,
        );
      return first(
        await tx`UPDATE handoffs SET assigned_membership_id=${member} WHERE (organization_id,event_id,id)=(${s.org},${s.event},${id}) AND status='open' RETURNING ${ticketFields(tx)}`,
      );
    });
  }
  @Post('handoffs/:id/close')
  @HttpCode(200)
  close(@Headers('authorization') auth: Auth, @Param() p: Scope & { id: string }) {
    return this.access.scoped(auth, p.org, p.event, moderating, async (tx, s) =>
      first(
        await tx`UPDATE handoffs SET status='closed'
      WHERE (organization_id,event_id,id)=(${s.org},${s.event},${identifier(p.id)}) AND status IN ('open','closed') RETURNING ${ticketFields(tx)}`,
      ),
    );
  }
  @Get('audit')
  audit(@Headers('authorization') auth: Auth, @Param() p: Scope, @Query() query: Fields) {
    return this.access.scoped(auth, p.org, p.event, managing, async (tx, s) => {
      const page = range(query, 'audit/' + s.org + '/' + s.event);
      return page.page(
        await tx`SELECT id,action,resource_id AS "resourceId",actor_id AS "actorId",created_at AS "createdAt"
        FROM audit_records WHERE organization_id=${s.org} AND event_id=${s.event} AND id>${page.after} ORDER BY id LIMIT ${page.limit + 1}`,
      );
    });
  }
  @Get('analytics')
  analytics(@Headers('authorization') auth: Auth, @Param() p: Scope, @Query('days') rawDays: unknown) {
    const days = reportDays(rawDays);
    return this.access.scoped(auth, p.org, p.event, [], (tx, s) => report(tx, s, days));
  }
  @Get('ai-settings')
  settings(@Headers('authorization') auth: Auth, @Param() p: Scope) {
    return this.access.scoped(auth, p.org, p.event, managing, async (tx, s) => {
      const [row] =
        await tx`SELECT funding,key_ciphertext IS NOT NULL AS "hasKey",daily_limit_micros::float8 AS "dailyLimitMicros"
        FROM event_ai_settings WHERE organization_id=${s.org} AND event_id=${s.event}`;
      return (
        row ?? {
          funding: 'platform',
          hasKey: false,
          dailyLimitMicros: Math.max(0, Number(process.env.AI_PLATFORM_DAILY_MICROS) || 0),
        }
      );
    });
  }
  @Patch('ai-settings')
  changeSettings(@Headers('authorization') auth: Auth, @Param() p: Scope, @Body() raw: unknown) {
    const b = object(raw);
    return this.access.scoped(auth, p.org, p.event, managing, async (tx, s) => {
      await tx`INSERT INTO event_ai_settings(organization_id,event_id) VALUES(${s.org},${s.event}) ON CONFLICT DO NOTHING`;
      const row = first(
        await tx`SELECT * FROM event_ai_settings WHERE organization_id=${s.org} AND event_id=${s.event} FOR UPDATE`,
      );
      const funding = choice(b.funding ?? row.funding, ['platform', 'byok'] as const);
      const daily = b.dailyLimitMicros ?? Number(row.daily_limit_micros);
      if (typeof daily !== 'number' || !Number.isSafeInteger(daily) || daily < 0 || daily > 1_000_000_000)
        throw new BadRequestException();
      let key = row.key_ciphertext;
      if (b.key !== undefined)
        key = b.key === null ? null : encryptBotToken(string(b.key, 2048), encryptionKey(), s.event);
      if (funding === 'byok' && !key) throw new BadRequestException();
      return first(
        await tx`UPDATE event_ai_settings SET funding=${funding},key_ciphertext=${key},daily_limit_micros=${daily}
        WHERE organization_id=${s.org} AND event_id=${s.event} RETURNING funding,key_ciphertext IS NOT NULL AS "hasKey",daily_limit_micros::float8 AS "dailyLimitMicros"`,
      );
    });
  }
}
