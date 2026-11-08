import type postgres from 'postgres';
import { decryptBotToken } from '@openfacto/database';
import { normalizeQuestion, conversationFrom, appendConversation, type Decision, type EvidenceRef, type Language } from '@openfacto/answer-engine';
import { liveReferencesCurrent, runScopedAnswer } from './answers.js';

interface TelegramUser {
  id: number;
  is_bot?: boolean;
  language_code?: string;
}
interface Message {
  text?: string;
  chat?: { id: number; type: string };
  from?: TelegramUser;
  message_thread_id?: number;
  reply_to_message?: { from?: TelegramUser };
}
interface Bot {
  telegram_bot_id: string;
  username: string;
  aliases: string[];
  allowed_chat_ids: string[];
  group_mode?: string;
  private_mode?: string;
}
export function splitTelegramText(body: string): string[] {
  const parts: string[] = [];
  let remaining = body;
  while (remaining.length > 4096) {
    let end = remaining.lastIndexOf('\n', 4095) + 1;
    if (end < 3000) end = remaining.lastIndexOf(' ', 4095) + 1;
    if (end < 3000) end = 4096;
    if (/^[\uDC00-\uDFFF]$/u.test(remaining[end]!)) end--;
    parts.push(remaining.slice(0, end));
    remaining = remaining.slice(end);
  }
  if (remaining) parts.push(remaining);
  return parts;
}

async function admitChat(sql: postgres.Sql, inboxId: string, botId: string, chat: string) {
  const max = Number(process.env.TELEGRAM_DAILY_CHAT_LIMIT ?? 100);
  if (!Number.isSafeInteger(max) || max < 1) return false;
  return sql.begin(async (tx) => {
    const [row] = await tx`SELECT rate_admitted FROM telegram_inbox WHERE id=${inboxId} FOR UPDATE`;
    if (!row) return false;
    if (row.rate_admitted !== null) return row.rate_admitted === true;
    const admitted = await tx`INSERT INTO telegram_chat_usage(bot_id,chat_id,day,requests)
      VALUES(${botId},${chat},(now() AT TIME ZONE 'UTC')::date,1) ON CONFLICT(bot_id,chat_id,day)
      DO UPDATE SET requests=telegram_chat_usage.requests+1 WHERE telegram_chat_usage.requests<${max} RETURNING requests`;
    await tx`UPDATE telegram_inbox SET rate_admitted=${admitted.length > 0} WHERE id=${inboxId}`;
    return admitted.length > 0;
  });
}
export function activation(message: Message, bot: Bot) {
  const text = message.text?.trim() ?? '';
  if (!text || !message.from || message.from.is_bot || !message.chat) return null;
  if (message.chat.type === 'private')
    return bot.private_mode === 'off' ? null : text.replace(/^\/ask(?:\s+|$)/iu, '');
  if (
    !['group', 'supergroup'].includes(message.chat.type) ||
    !bot.allowed_chat_ids.includes(String(message.chat.id)) ||
    bot.group_mode === 'off'
  )
    return null;
  const command = /^\/ask(?:@(\w+))?(?:\s+|$)/iu.exec(text);
  if (command)
    return !command[1] || command[1].toLowerCase() === bot.username.toLowerCase()
      ? text.slice(command[0].length)
      : null;
  if (String(message.reply_to_message?.from?.id) === bot.telegram_bot_id) return text;
  const mention = text
    .match(/(?<![\p{L}\p{N}_])@[a-zA-Z0-9_]+/gu)
    ?.find((m) => m.slice(1).toLowerCase() === bot.username.toLowerCase());
  if (mention) return text.replace(mention, '').trim();
  if (bot.group_mode === 'all_relevant') return text;
  if (bot.group_mode === 'mention_only') return null;
  const normalized = ' ' + normalizeQuestion(text) + ' ';
  for (const alias of bot.aliases) {
    const token = ' ' + normalizeQuestion(alias) + ' ';
    if (token.trim() && normalized.includes(token)) return normalized.replace(token, ' ').trim();
  }
  return null;
}
export function languageOf(text: string, profile?: string): Language {
  if (/[әғқңөұүһі]/iu.test(text)) return 'kk';
  if (/\p{Script=Cyrillic}/u.test(text)) return profile?.startsWith('kk') ? 'kk' : 'ru';
  if (/\b(when|what|how|where|can|please|does|registration|deadline)\b/iu.test(text)) return 'en';
  return profile?.startsWith('kk') ? 'kk' : profile?.startsWith('en') ? 'en' : 'ru';
}

export function formatTelegramAnswer(result: Pick<Decision, 'answer' | 'language' | 'sources' | 'outcome'>): string {
  if(!['approved_faq','grounded_answer'].includes(result.outcome))return result.answer;
  const labels = {
    ru: { heading: 'Источник:', page: (n: number) => `стр. ${n}` },
    kk: { heading: 'Дереккөз:', page: (n: number) => `${n}-бет` },
    en: { heading: 'Source:', page: (n: number) => `p. ${n}` },
  }[result.language];
  const important=/срок|дедлайн|сдава|команд|возраст|приз|критери|регламент|мерзім|тапсыр|жүлде|deadline|prize|criteria|rules/iu;
  const displayed=result.sources.filter(s=>s.kind==='document'||important.test(s.title));
  const citations = [...new Set(displayed.map(s => (s.kind==='faq'?'FAQ — ':'')+s.title + (s.page ? ' · ' + labels.page(s.page) : '')))];
  return result.answer + (citations.length ? '\n\n' + labels.heading + ' ' + citations.join('; ') : '');
}

export async function processUpdate(sql: postgres.Sql, id: string) {
  const [row] = await sql`UPDATE telegram_inbox i SET available_at=now()+interval '5 minutes',attempts=i.attempts+1
    FROM telegram_bots b,events e WHERE i.id=${id} AND i.status='pending' AND i.available_at<=now()
    AND (b.organization_id,b.event_id,b.id)=(i.organization_id,i.event_id,i.bot_id)
    AND (e.organization_id,e.id)=(i.organization_id,i.event_id)
    RETURNING i.*,b.active,b.telegram_bot_id,b.username,b.aliases,b.allowed_chat_ids,e.status AS event_status,e.faq_only,e.handoff_enabled,to_jsonb(b)->>'group_mode' AS group_mode,to_jsonb(b)->>'private_mode' AS private_mode`;
  if (!row) return;
  const m: Message = row.payload.message ?? {};
  const bot: Bot = {
    telegram_bot_id: row.telegram_bot_id,
    username: row.username,
    aliases: row.aliases,
    allowed_chat_ids: row.allowed_chat_ids,
    group_mode: row.group_mode,
    private_mode: row.private_mode,
  };
  const question = row.active && row.event_status === 'active' ? activation(m, bot) : null;
  const thread = String(m.message_thread_id ?? '');
  const chat = String(m.chat?.id ?? '');
  const user = String(m.from?.id ?? '');
  const lang = languageOf(question ?? '', m.from?.language_code);
  const admitted = question !== null && (await admitChat(sql, id, row.bot_id, chat));
  const [prior] = !admitted
    ? []
    : await sql`SELECT question FROM clarification_context WHERE
    organization_id=${row.organization_id} AND event_id=${row.event_id} AND bot_id=${row.bot_id}
    AND chat_id=${chat} AND thread_id=${thread} AND user_id=${user} AND expires_at>now()`;
  const conversation = conversationFrom(prior?.question);
  const fullQuestion = (question ?? '').slice(0, 4000);
  const result = await runScopedAnswer(sql, {
    organizationId: row.organization_id,
    eventId: row.event_id,
    traceId: row.id,
    mode: 'live',
    language: lang,
    languageSelection: 'auto',
    question: fullQuestion,
    conversation,
    activated: admitted,
    faqOnly: row.faq_only,
    handoffEnabled: row.handoff_enabled,
  });
  if (!admitted && question !== null) result.reasonCode = 'chat_rate_limit';
  if (bot.group_mode === 'all_relevant' && m.chat?.type !== 'private' && result.reasonCode === 'off_topic') {
    result.outcome = 'ignored';
    result.answer = '';
  }
  await sql.begin(async (tx) => {
    const ack =
      await tx`UPDATE telegram_inbox SET status='processed',payload='{}'::jsonb WHERE id=${id} AND status='pending' AND attempts=${row.attempts} RETURNING id`;
    if (!ack.length) return;
    await tx`INSERT INTO answer_runs(id,organization_id,event_id,mode,outcome,decision)
      VALUES(${id},${row.organization_id},${row.event_id},'live',${result.outcome},${tx.json(JSON.parse(JSON.stringify(result)))})`;
    if (result.outcome === 'ignored') return;
    const social=result.reasonCode==='social_greeting';
    if (!social&&['clarify', 'approved_faq', 'grounded_answer'].includes(result.outcome)) {
      await tx`INSERT INTO clarification_context(organization_id,event_id,bot_id,chat_id,thread_id,user_id,question,expires_at)
        VALUES(${row.organization_id},${row.event_id},${row.bot_id},${chat},${thread},${user},${JSON.stringify(appendConversation(conversation, fullQuestion, result.answer))},now()+interval '10 minutes')
        ON CONFLICT(bot_id,chat_id,thread_id,user_id) DO UPDATE SET question=excluded.question,expires_at=excluded.expires_at`;
    } else if (prior&&!social) {
      await tx`DELETE FROM clarification_context WHERE bot_id=${row.bot_id} AND chat_id=${chat} AND thread_id=${thread} AND user_id=${user}`;
    }
    if (result.outcome === 'handoff')
      await tx`INSERT INTO handoffs(organization_id,event_id,bot_id,chat_id,thread_id,question)
      VALUES(${row.organization_id},${row.event_id},${row.bot_id},${chat},${thread || null},${fullQuestion})`;
    const body = formatTelegramAnswer(result);
    let previous: string | null = null;
    for (const [index, part] of splitTelegramText(body).entries()) {
      const inserted: { id: string }[] =
        await tx`INSERT INTO telegram_outbox(organization_id,event_id,bot_id,chat_id,thread_id,body,source_refs,dedupe_key,predecessor_id)
        VALUES(${row.organization_id},${row.event_id},${row.bot_id},${chat},${thread || null},${part},${tx.json(JSON.parse(JSON.stringify(result.sources)))},${'answer/' + id + '/' + index},${previous}) RETURNING id`;
      previous = inserted[0]!.id;
    }
  });
}

async function prepareDelivery(sql: postgres.Sql, id: string) {
  return sql.begin(async tx => {
    const [row] =
      await tx`UPDATE telegram_outbox o SET status='sending',attempts=o.attempts+1,available_at=now()+interval '2 minutes'
    FROM telegram_bots b,events e WHERE o.id=${id} AND o.status='pending' AND o.available_at<=now()
    AND (b.organization_id,b.event_id,b.id)=(o.organization_id,o.event_id,o.bot_id)
    AND (e.organization_id,e.id)=(o.organization_id,o.event_id)
    AND (o.predecessor_id IS NULL OR EXISTS(SELECT 1 FROM telegram_outbox prev WHERE prev.id=o.predecessor_id AND prev.status='sent'))
    RETURNING o.*,b.active,b.token_ciphertext,b.allowed_chat_ids,b.group_mode,b.private_mode,e.status AS event_status`;
    if (!row) return null;
    if (
      !row.active ||
      row.event_status !== 'active' ||
      (row.chat_id.startsWith('-')
        ? row.group_mode === 'off' || !row.allowed_chat_ids.includes(row.chat_id)
        : row.private_mode === 'off') ||
      !(await liveReferencesCurrent(tx, row.organization_id, row.event_id, row.source_refs as EvidenceRef[]))
    ) {
      await tx`UPDATE telegram_outbox SET status='failed' WHERE id=${id}`;
      return null;
    }
    try {
      const token = decryptBotToken(row.token_ciphertext, process.env.BOT_ENCRYPTION_KEY ?? '', row.bot_id);
      return { row, token };
    } catch {
      // Telegram has not been contacted. Allow time to restore the encryption key.
      const status = row.attempts < 5 ? 'pending' : 'failed';
      await tx`UPDATE telegram_outbox SET status=${status},available_at=now()+interval '30 seconds' WHERE id=${id}`;
      return null;
    }
  });
}

export async function deliver(sql: postgres.Sql, id: string) {
  const prepared = await prepareDelivery(sql,id);
  if (!prepared) return;
  const { row, token } = prepared;
  let status = 'uncertain';
  let retryAfter = 0;
  try {
    const response = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(12000),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: row.chat_id,
        message_thread_id: row.thread_id ? Number(row.thread_id) : undefined,
        text: row.body,
        link_preview_options: { is_disabled: true },
      }),
    });
    const data = await response.json();
    if (response.ok && data.ok === true) status = 'sent';
    else if (response.status === 429 && data.ok === false && row.attempts < 5) {
      retryAfter = Math.min(86400, Math.max(1, Number(data.parameters?.retry_after) || 30));
      status = 'pending';
    } else if (response.status >= 400 && response.status < 500) status = 'failed';
  } catch {
    /* A timeout may occur after Telegram accepts the message. */
  }
  await sql`UPDATE telegram_outbox SET status=${status},available_at=now()+${retryAfter}*interval '1 second' WHERE id=${id} AND status='sending'`;
}
