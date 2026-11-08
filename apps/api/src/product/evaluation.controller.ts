import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { evaluationConfig } from '@openfacto/worker/evaluations';
import type { Transaction } from '@openfacto/database';
import { PRODUCT, ProductAccess, type Auth } from './access.js';
import {
  choice,
  editing,
  first,
  identifier,
  languages,
  object,
  range,
  string,
  type Fields,
  type Scope,
} from './input.js';

const outcomes = ['approved_faq', 'grounded_answer', 'clarify', 'handoff', 'refuse'] as const;
const fields = (sql: Transaction) =>
  sql`id,status,cases,results,created_at AS "createdAt",config-'actor' AS config`;
@Controller('organizations/:org/events/:event/evaluations')
export class EvaluationController {
  constructor(@Inject(PRODUCT) private readonly access: ProductAccess) {}
  @Get()
  list(@Headers('authorization') auth: Auth, @Param() p: Scope, @Query() query: Fields) {
    return this.access.scoped(auth, p.org, p.event, editing, async (sql, s) => {
      const page = range(query, 'evaluations/' + s.org + '/' + s.event);
      return page.page(
        await sql`SELECT ${fields(sql)} FROM evaluation_runs WHERE organization_id=${s.org}
        AND event_id=${s.event} AND id>${page.after} ORDER BY id LIMIT ${page.limit + 1}`,
      );
    });
  }
  @Get(':id')
  read(@Headers('authorization') auth: Auth, @Param() p: Scope & { id: string }) {
    return this.access.scoped(auth, p.org, p.event, editing, async (sql, s) =>
      first(
        await sql`SELECT ${fields(sql)}
      FROM evaluation_runs WHERE organization_id=${s.org} AND event_id=${s.event} AND id=${identifier(p.id)}`,
      ),
    );
  }
  @Post()
  create(@Headers('authorization') auth: Auth, @Param() p: Scope, @Body() body: unknown) {
    const raw = object(body).cases;
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 20) throw new BadRequestException();
    const cases = raw.map((value) => {
      const c = object(value);
      return {
        question: string(c.question, 2000),
        language: choice(c.language, languages),
        expectedOutcome: choice(c.expectedOutcome, outcomes),
        ...(c.expectedSourceId ? { expectedSourceId: identifier(c.expectedSourceId) } : {}),
      };
    });
    return this.access.scoped(auth, p.org, p.event, editing, async (sql, s) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${s.event + '/evaluation'},0))`;
      const [running] =
        await sql`SELECT id FROM evaluation_runs WHERE organization_id=${s.org} AND event_id=${s.event}
        AND status IN ('pending','running') LIMIT 1`;
      const config = await evaluationConfig(sql, s.org, s.event);
      if (running || config.status === 'archived') throw new ConflictException();
      const [{ actor } = {}] = await sql`SELECT current_setting('openfacto.actor') AS actor`;
      return first(
        await sql`INSERT INTO evaluation_runs(organization_id,event_id,status,config,cases)
        VALUES(${s.org},${s.event},'pending',${JSON.stringify({ ...config, actor })}::text::jsonb,${JSON.stringify(cases)}::text::jsonb)
        RETURNING ${fields(sql)}`,
      );
    });
  }
}
