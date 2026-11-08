import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { conversationFrom, type ConversationTurn, type Decision } from '@openfacto/answer-engine';
import type { Transaction } from '@openfacto/database';
import { playgroundReferencesCurrent } from '@openfacto/worker/playground-jobs';
import { requestBusinessWake } from '@openfacto/worker/wake';
import type { Auth, ProductAccess } from './access.js';
import { boolean, choice, editing, first, identifier, languages, object, string, type Scope } from './input.js';

const roles = [...editing, 'moderator'];
async function status(tx: Transaction, scope: Scope, id: string) {
  const row = first(await tx`SELECT r.*,a.decision FROM playground_requests r LEFT JOIN answer_runs a
    ON (a.organization_id,a.event_id,a.id)=(r.organization_id,r.event_id,r.trace_id)
    WHERE r.id=${id} AND r.organization_id=${scope.org} AND r.event_id=${scope.event}
      AND r.actor_id=current_setting('openfacto.actor')::uuid`);
  const event = first(await tx`SELECT status FROM events WHERE organization_id=${scope.org} AND id=${scope.event} FOR SHARE`);
  if (event.status === 'archived') throw new ConflictException();
  if (row.status === 'completed') {
    const decision = row.decision as Decision | null;
    if (!decision || !(await playgroundReferencesCurrent(tx,scope.org,scope.event,row.mode,decision))) throw new ConflictException();
    return { requestId: row.id as string, status: 'completed' as const, decision };
  }
  return { requestId: row.id as string, status: row.status as 'pending'|'running'|'failed',
    ...(row.status === 'failed' ? { errorCode: ['access_changed','legacy_request'].includes(row.error_code) ? row.error_code as string : 'job_failed' } : {}) };
}

export function playgroundStatus(access: ProductAccess, auth: Auth, scope: Scope, id: unknown) {
  const key = identifier(id);
  return access.scoped(auth,scope.org,scope.event,roles,(tx,s)=>status(tx,s,key));
}

export async function playground(access: ProductAccess, auth: Auth, scope: Scope, raw: unknown) {
  const b = object(raw), question = string(b.question,4000), language = choice(b.language ?? 'ru',languages);
  const mode = choice(b.mode ?? 'published_preview',['draft_preview','published_preview'] as const);
  const key = b.requestId === undefined ? randomUUID() : identifier(b.requestId);
  let conversation: ConversationTurn[];
  try {
    if (b.conversation !== undefined && !Array.isArray(b.conversation)) throw new Error();
    conversation = conversationFrom(b.conversation);
  } catch { throw new BadRequestException('Invalid conversation'); }
  const result = await access.scoped(auth,scope.org,scope.event,roles,async (tx,s) => {
    const settings = first(await tx`SELECT faq_only,handoff_enabled,status,current_setting('openfacto.actor') AS actor
      FROM events WHERE organization_id=${s.org} AND id=${s.event} FOR SHARE`);
    if (settings.status === 'archived') throw new ConflictException();
    const input = { organizationId:s.org,eventId:s.event,traceId:randomUUID(),activated:true,mode,language,question,conversation,
      faqOnly:boolean(b.faqOnly,settings.faq_only),handoffEnabled:boolean(b.handoffEnabled,settings.handoff_enabled) };
    const fingerprint = createHash('sha256').update(JSON.stringify([
      s.org,s.event,settings.actor,question,language,mode,b.faqOnly ?? null,b.handoffEnabled ?? null,conversation,
    ])).digest('hex');
    await tx`INSERT INTO playground_requests(id,organization_id,event_id,actor_id,fingerprint,trace_id,mode,input)
      VALUES(${key},${s.org},${s.event},${settings.actor},${fingerprint},${input.traceId},${mode},${tx.json(JSON.parse(JSON.stringify(input)))})
      ON CONFLICT(id) DO NOTHING`;
    const [existing] = await tx`SELECT 1 FROM playground_requests WHERE id=${key} AND organization_id=${s.org}
      AND event_id=${s.event} AND actor_id=${settings.actor} AND fingerprint=${fingerprint}`;
    if (!existing) throw new ConflictException();
    return status(tx,s,key);
  });
  // The durable row is committed before the in-process dispatcher is notified.
  // Recovery polling still covers lost signals and process restarts.
  if (result.status === 'pending' || result.status === 'running') requestBusinessWake();
  return result;
}
