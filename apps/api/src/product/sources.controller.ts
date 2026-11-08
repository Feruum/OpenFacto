import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  ServiceUnavailableException,
  StreamableFile,
} from '@nestjs/common';
import { type Transaction } from '@openfacto/database';
import { putOriginal, readOriginal } from '@openfacto/worker/ingestion';
import { PRODUCT, ProductAccess, type Auth } from './access.js';
import {
  choice,
  editing,
  first,
  identifier,
  languages,
  list,
  object,
  range,
  string,
  visibility,
  type Fields,
  type Scope,
} from './input.js';

const columns = (sql: Transaction) =>
  sql`id,kind,title,body,language,aliases,visibility,published_version_id AS "publishedVersionId",updated_at AS "updatedAt"`;
const versionColumns = (sql: Transaction) =>
  sql`id,source_id AS "sourceId",number,title,body,language,aliases,visibility,ingestion_status AS "ingestionStatus",
    page_diagnostics AS "pageDiagnostics",created_at AS "createdAt"`;
function content(value: unknown, kind: string) {
  if (kind === 'document' && value === '') return '';
  return string(value, 64000);
}
async function lockSource(tx: Transaction, s: Scope, id: string) {
  return first(
    await tx`SELECT * FROM knowledge_sources WHERE (organization_id,event_id,id)=(${s.org},${s.event},${identifier(id)}) FOR UPDATE`,
  );
}
async function newVersion(tx: Transaction, s: Scope, id: string, version: string, hash: string | null) {
  return first(
    await tx`INSERT INTO source_versions(organization_id,event_id,source_id,id,number,title,body,aliases,language,visibility,ingestion_status,original_sha256)
    SELECT s.organization_id,s.event_id,s.id,${version},1+COALESCE((SELECT max(v.number) FROM source_versions v
      WHERE (v.organization_id,v.event_id,v.source_id)=(s.organization_id,s.event_id,s.id)),0),
      s.title,s.body,s.aliases,s.language,s.visibility,${hash ? 'uploading' : 'none'},${hash}
    FROM knowledge_sources s WHERE (s.organization_id,s.event_id,s.id)=(${s.org},${s.event},${id}) RETURNING ${versionColumns(tx)}`,
  );
}
@Controller('organizations/:org/events/:event/sources')
export class SourcesController {
  constructor(@Inject(PRODUCT) private readonly access: ProductAccess) {}
  @Get()
  all(@Headers('authorization') auth: Auth, @Param() p: Scope, @Query() query: Fields) {
    return this.access.scoped(auth, p.org, p.event, editing, async (tx, s) => {
      const page = range(query, 'sources/' + s.org + '/' + s.event);
      return page.page(
        await tx`SELECT ${columns(tx)} FROM knowledge_sources WHERE organization_id=${s.org} AND event_id=${s.event} AND id>${page.after}
        ORDER BY id LIMIT ${page.limit + 1}`,
      );
    });
  }
  @Post()
  create(@Headers('authorization') auth: Auth, @Param() p: Scope, @Body() raw: unknown) {
    const b = object(raw),
      kind = choice(b.kind, ['faq', 'document'] as const);
    return this.access.scoped(auth, p.org, p.event, editing, async (tx, s) =>
      first(
        await tx`INSERT INTO knowledge_sources(organization_id,event_id,kind,title,body,language,aliases,visibility)
      VALUES(${s.org},${s.event},${kind},${string(b.title)},${content(b.body ?? '', kind)},${choice(b.language ?? 'ru', languages)},
      ${tx.array(list(b.aliases ?? []))},${choice(b.visibility ?? 'participant', visibility)}) RETURNING ${columns(tx)}`,
      ),
    );
  }
  @Patch(':id')
  update(@Headers('authorization') auth: Auth, @Param() p: Scope & { id: string }, @Body() raw: unknown) {
    const b = object(raw);
    return this.access.scoped(auth, p.org, p.event, editing, async (tx, s) => {
      const source = await lockSource(tx, s, p.id);
      return first(
        await tx`UPDATE knowledge_sources SET title=${string(b.title ?? source.title)},body=${content(b.body ?? source.body, source.kind)},
        language=${choice(b.language ?? source.language, languages)},aliases=${tx.array(list(b.aliases ?? source.aliases))},visibility=${choice(b.visibility ?? source.visibility, visibility)},
        updated_at=now() WHERE (organization_id,event_id,id)=(${s.org},${s.event},${source.id}) RETURNING ${columns(tx)}`,
      );
    });
  }
  @Delete(':id')
  @HttpCode(204)
  async remove(@Headers('authorization') auth: Auth, @Param() p: Scope & { id: string }) {
    await this.access.scoped(auth, p.org, p.event, editing, async (tx, s) =>
      first(
        await tx`DELETE FROM knowledge_sources
      WHERE (organization_id,event_id,id)=(${s.org},${s.event},${identifier(p.id)}) RETURNING id`,
      ),
    );
  }
  @Get(':id/versions')
  versions(@Headers('authorization') auth: Auth, @Param() p: Scope & { id: string }, @Query() query: Fields) {
    return this.access.scoped(auth, p.org, p.event, editing, async (tx, s) => {
      const id = identifier(p.id);
      const page = range(query, 'versions/' + s.org + '/' + s.event + '/' + id);
      return page.page(
        await tx`SELECT ${versionColumns(tx)} FROM source_versions WHERE (organization_id,event_id,source_id)=(${s.org},${s.event},${id}) AND id>${page.after}
        ORDER BY id LIMIT ${page.limit + 1}`,
      );
    });
  }
  @Post(':id/pdf')
  async pdf(@Headers('authorization') auth: Auth, @Param() p: Scope & { id: string }, @Body() raw: unknown) {
    const base64 = string(object(raw).pdfBase64, Math.ceil((8 * 1024 * 1024) / 3) * 4);
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new BadRequestException();
    const bytes = Buffer.from(base64, 'base64');
    if (
      bytes.length > 8 * 1024 * 1024 ||
      bytes.toString('base64') !== base64 ||
      bytes.subarray(0, 5).toString() !== '%PDF-'
    )
      throw new BadRequestException();
    const version = randomUUID(),
      sha = createHash('sha256').update(bytes).digest('hex');
    const scope = {
      organizationId: identifier(p.org),
      eventId: identifier(p.event),
      documentId: identifier(p.id),
      versionId: version,
    };
    await this.access.scoped(auth, p.org, p.event, editing, async (tx, s) => {
      const source = await lockSource(tx, s, p.id);
      if (source.kind !== 'document') throw new BadRequestException();
      await newVersion(tx, s, p.id, version, sha);
    });
    return this.access.scoped(auth, p.org, p.event, editing, async (tx, s) => {
      first(
        await tx`SELECT id FROM source_versions WHERE (organization_id,event_id,source_id,id)=(${s.org},${s.event},${p.id},${version})
        AND ingestion_status='uploading' FOR UPDATE`,
      );
      try {
        await putOriginal(scope, bytes);
      } catch {
        throw new ServiceUnavailableException();
      }
      return first(
        await tx`UPDATE source_versions SET ingestion_status='pending'
        WHERE (organization_id,event_id,source_id,id)=(${s.org},${s.event},${p.id},${version}) RETURNING ${versionColumns(tx)}`,
      );
    });
  }
  @Get(':id/versions/:versionId/pdf')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Cache-Control', 'private, no-store')
  async original(@Headers('authorization') auth: Auth, @Param() p: Scope & { id: string; versionId: string }) {
    const scope = {
      organizationId: identifier(p.org),
      eventId: identifier(p.event),
      documentId: identifier(p.id),
      versionId: identifier(p.versionId),
    };
    const bytes = await this.access.scoped(auth, p.org, p.event, editing, async (tx, s) => {
      const version = first(
        await tx`SELECT original_sha256 FROM source_versions WHERE (organization_id,event_id,source_id,id)=(${s.org},${s.event},${scope.documentId},${scope.versionId})
        AND original_sha256 IS NOT NULL AND ingestion_status='ready' FOR SHARE`,
      );
      const original = await readOriginal(scope).catch(() => {
        throw new ServiceUnavailableException();
      });
      if (createHash('sha256').update(original).digest('hex') !== version.original_sha256)
        throw new ServiceUnavailableException();
      return original;
    });
    return new StreamableFile(bytes, {
      type: 'application/pdf',
      disposition: 'attachment; filename="document.pdf"',
      length: bytes.length,
    });
  }
  @Post(':id/publish')
  @HttpCode(200)
  publish(@Headers('authorization') auth: Auth, @Param() p: Scope & { id: string }, @Body() b: unknown) {
    return this.publication(auth, p, object(b ?? {}).versionId);
  }
  @Post(':id/rollback')
  @HttpCode(200)
  rollback(@Headers('authorization') auth: Auth, @Param() p: Scope & { id: string }, @Body() b: unknown) {
    return this.publication(auth, p, identifier(object(b).versionId));
  }
  @Post(':id/revoke')
  @HttpCode(200)
  revoke(@Headers('authorization') auth: Auth, @Param() p: Scope & { id: string }) {
    return this.publication(auth, p, null);
  }
  private publication(auth: Auth, p: Scope & { id: string }, target: unknown) {
    return this.access.scoped(auth, p.org, p.event, editing, async (tx, s) => {
      const source = await lockSource(tx, s, p.id);
      let version: string | null = null;
      if (target === undefined) {
        if (!source.body.trim()) throw new ConflictException();
        version = (await newVersion(tx, s, p.id, randomUUID(), null)).id;
      } else if (target !== null) {
        version = identifier(target);
        const v = first(
          await tx`SELECT ingestion_status FROM source_versions WHERE (organization_id,event_id,source_id,id)=(${s.org},${s.event},${p.id},${version})`,
        );
        if (!['none', 'ready'].includes(v.ingestion_status)) throw new ConflictException();
      }
      return first(
        await tx`UPDATE knowledge_sources SET published_version_id=${version},updated_at=now()
        WHERE (organization_id,event_id,id)=(${s.org},${s.event},${p.id}) RETURNING ${columns(tx)}`,
      );
    });
  }
}
