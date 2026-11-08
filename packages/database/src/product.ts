import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type postgres from 'postgres';

export type Query = postgres.Sql | postgres.TransactionSql;
export type Transaction = postgres.TransactionSql;
export type EvidenceRow = {
  organizationId: string;
  eventId: string;
  sourceId: string;
  versionId: string;
  kind: 'faq' | 'document';
  title: string;
  text: string;
  language: 'ru' | 'kk' | 'en';
  aliases: string[];
  visibility: 'participant' | 'internal';
  state: 'published' | 'draft' | 'revoked';
  page?: number;
  section?: string;
};

function keyBytes(key: string) {
  const bytes = Buffer.from(key, 'base64');
  if (bytes.length !== 32 || bytes.toString('base64') !== key) throw new Error('Invalid encryption configuration');
  return bytes;
}
export function encryptBotToken(token: string, key: string, botId: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(key), iv);
  cipher.setAAD(Buffer.from(botId));
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
}
export function decryptBotToken(value: string, key: string, botId: string) {
  const parts = value.split('.').map((part) => Buffer.from(part, 'base64url'));
  if (parts.length !== 3) throw new Error('Invalid encrypted credential');
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(key), parts[0]!);
  decipher.setAAD(Buffer.from(botId));
  decipher.setAuthTag(parts[1]!);
  return Buffer.concat([decipher.update(parts[2]!), decipher.final()]).toString('utf8');
}

/** The caller must authorize this event before loading any evidence. */
export async function loadEvidence(
  sql: Query,
  organizationId: string,
  eventId: string,
  preview = false,
  kind?: 'faq' | 'document' | 'text_document',
  sourceIds?: string[],
): Promise<EvidenceRow[]> {
  const filter = kind === 'text_document' ? 'document' : (kind ?? null);
  const rows = await sql<EvidenceRow[]>`
    WITH selected AS (
      SELECT s.*, v.id AS vid,v.title AS vtitle,v.body AS vbody,v.language AS vlang,
        v.aliases AS valiases,v.visibility AS vvisibility,v.ingestion_status,v.original_sha256
      FROM knowledge_sources s LEFT JOIN LATERAL (
        SELECT ver.* FROM source_versions ver
        WHERE (ver.organization_id,ver.event_id,ver.source_id)=(s.organization_id,s.event_id,s.id)
          AND ((${preview} AND ver.original_sha256 IS NOT NULL AND ver.ingestion_status='ready')
            OR ver.id=s.published_version_id)
        ORDER BY ver.number DESC LIMIT 1
      ) v ON TRUE
      WHERE s.organization_id=${organizationId} AND s.event_id=${eventId} AND (${filter}::text IS NULL OR s.kind=${filter})
        AND ${sourceIds ? sql`s.id = ANY(${sql.array(sourceIds)}::uuid[])` : sql`true`}
    )
    SELECT s.organization_id AS "organizationId",s.event_id AS "eventId",s.id AS "sourceId",
      CASE WHEN d.draft THEN md5(s.id::text || s.updated_at::text)::uuid ELSE s.vid END AS "versionId",s.kind,
      CASE WHEN d.draft THEN s.title ELSE s.vtitle END AS title,
      CASE WHEN d.draft THEN s.body ELSE COALESCE(c.body,s.vbody) END AS text,
      CASE WHEN d.draft THEN s.language ELSE s.vlang END AS language,
      CASE WHEN d.draft THEN s.aliases ELSE s.valiases END AS aliases,
      'participant' AS visibility, CASE WHEN d.draft OR s.vid IS DISTINCT FROM s.published_version_id THEN 'draft' ELSE 'published' END AS state,
      c.page,CASE WHEN s.kind='document' AND c.page IS NULL THEN 'Text' END AS section
    FROM selected s CROSS JOIN LATERAL (SELECT ${preview} AND s.original_sha256 IS NULL AS draft) d
    LEFT JOIN source_chunks c ON (c.organization_id,c.event_id,c.source_id,c.version_id)=(s.organization_id,s.event_id,s.id,s.vid)
      AND s.ingestion_status='ready' AND ${kind !== 'text_document'}
    WHERE ((d.draft AND s.visibility='participant' AND length(s.body)>0) OR
      (NOT d.draft AND s.vvisibility='participant' AND (s.ingestion_status='none' OR c.id IS NOT NULL)))
      AND (${kind !== 'text_document'} OR s.original_sha256 IS NULL)
    ORDER BY s.id,c.page,c.ordinal`;
  return rows.map(({ page, ...row }) => (page == null ? row : { ...row, page }));
}
