export type Language = 'ru' | 'kk' | 'en';
import {socialReply}from'./social.js';
import { faqQuestionKey, timeFragmentLanguage, faqSuppliesTime } from './faq-wording.js';
export { conversationFrom, appendConversation } from './conversation.js';
export type RunMode = 'live' | 'published_preview' | 'draft_preview' | 'evaluation';
export type Outcome = 'ignored' | 'approved_faq' | 'grounded_answer' | 'clarify' | 'handoff' | 'refuse';

export interface Evidence {
  sourceId: string;
  versionId: string;
  organizationId: string;
  eventId: string;
  kind: 'faq' | 'document';
  title: string;
  text: string;
  language: Language;
  aliases: string[];
  visibility: 'participant' | 'internal';
  state: 'published' | 'draft' | 'revoked';
  page?: number;
  section?: string;
}
export type EvidenceRef = Pick<Evidence, 'sourceId' | 'versionId' | 'kind' | 'title' | 'page' | 'section'> & {
  quote?: string;
};
export interface AnswerInput {
  organizationId: string;
  eventId: string;
  language: Language;
  mode: RunMode;
  /** Telegram infers language from the question; UI selections remain explicit by default. */
  languageSelection?: 'auto' | 'explicit';
  question: string;
  traceId: string;
  activated: boolean;
  handoffEnabled: boolean;
  faqOnly: boolean;
  sources: Evidence[];
  conversation?: ConversationTurn[];
  /** Internal retrieval hints; never replace question or serve as evidence. */
  searchQueries?: string[];
}
export type ConversationTurn = { question: string; answer: string };
export interface Understanding { queries: string[]; clarification?: string; responseLanguage?: Language; contextIndependent?: boolean }
export interface TraceStep {
  stage: string;
  reason: string;
  candidates: EvidenceRef[];
  durationMs?: number;
  costMicros?: number | null;
}
export interface Decision {
  durationMs: number;
  outcome: Outcome;
  reasonCode: string;
  answer: string;
  language: Language;
  traceId: string;
  sources: EvidenceRef[];
  steps: TraceStep[];
  usage: { paidOperations: number; costMicros: number | null };
  delivery?: {
    requestId: string;
    queuedAt: string;
    startedAt: string;
    answerReadyAt: string;
    queueWaitMs: number;
    workerDurationMs: number;
  };
}

// Candidate indices are local to one request. A model cannot request another source.
export const rejectionReasons = ['wrong_topic','different_deadline','missing_condition','contradicted'] as const;
type AssessmentChoice =
  | { kind: 'faq'; index: number; answer?: string }
  | { kind: 'document'; claims: { index: number; quote: string; statement: string }[] }
  | { kind: 'ambiguous' | 'conflict' | 'personal' | 'off_topic' | 'insufficient'; clarification?: string };
export type Assessment = AssessmentChoice & { responseLanguage?: Language; contextIndependent?: boolean; searchQueries?: string[]; rejected?: { index:number; reason:(typeof rejectionReasons)[number] }[] };
export interface AnswerPorts {
  /** Interpret the current question and choose evidence together; verification remains independent. */
  resolveLanguageInAssessment?: boolean;
  understand?(input: AnswerInput): Promise<Understanding>;
  retrieve?(input: AnswerInput): Promise<Evidence[]>;
  rerank?(input: AnswerInput, candidates: Evidence[]): Promise<Evidence[]>;
  /** Round 2 repairs a document quote that did not occur in its selected candidate. */
  assess?(input: AnswerInput, candidates: Evidence[], round?: 0 | 1 | 2): Promise<Assessment>;
  verify?(
    input: AnswerInput,
    claims: { statement: string; quote: string; evidence: Evidence }[],
  ): Promise<boolean>;
  current?(refs: EvidenceRef[]): Promise<boolean>;
  usage?(): Decision['usage'];
}
export class ServiceFailure extends Error {
  constructor(public readonly reason: 'budget_exhausted' | 'provider_unavailable' | 'operation_uncertain') {
    super(reason);
  }
}

const messages = {
  ru: {
    ask: 'Уточните, пожалуйста, какой срок, раздел или условие вас интересует?',
    human: 'Вопрос требует ответа модератора.',
    missing: 'В опубликованных материалах недостаточно сведений для ответа.',
    off: 'Я отвечаю на вопросы о мероприятии.',
    unavailable: 'Смысловая обработка временно недоступна. Попробуйте позже или обратитесь к организатору.',
    budget: 'Лимит AI-ответов исчерпан. Обратитесь к организатору.',
  },
  kk: {
    ask: 'Қай мерзім, бөлім немесе шарт туралы сұрап тұрғаныңызды нақтылаңызшы.',
    human: 'Бұл сұраққа модератордың жауабы қажет.',
    missing: 'Жарияланған материалдарда жауап беруге жеткілікті ақпарат жоқ.',
    off: 'Мен іс-шара туралы сұрақтарға жауап беремін.',
    unavailable: 'Сұрақты өңдеу уақытша қолжетімсіз. Кейінірек қайталап көріңіз немесе ұйымдастырушыға хабарласыңыз.',
    budget: 'AI жауаптарының лимиті таусылды. Ұйымдастырушыға хабарласыңыз.',
  },
  en: {
    ask: 'Which deadline, section or condition do you mean?',
    human: 'This question needs a moderator.',
    missing: 'The published materials do not contain enough information to answer.',
    off: 'I answer questions about this event.',
    unavailable: 'Language processing is temporarily unavailable. Try again later or contact the organizer.',
    budget: 'The AI answer budget has been reached. Please contact the organizer.',
  },
};
export function normalizeQuestion(text: string) {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
export function reference(e: Evidence): EvidenceRef {
  return {
    sourceId: e.sourceId,
    versionId: e.versionId,
    kind: e.kind,
    title: e.title,
    page: e.page,
    section: e.section,
  };
}
/** Ignore conversational edges and internal expletive particles only for exact FAQ lookup; retain the raw question for AI. */
export function normalizeFaqWording(text:string):string {
  const normalized=normalizeQuestion(text);
  if(/["'«»“”„]/u.test(text))return normalized;
  const fillers=new Set(['пж','плиз','пожалуйста','блин','сука','сучка','бля','блять','блядь','бро','брат','друг',
    'blya','blyat','blyad','suka','blin','pls']);
  const words=normalized.split(' ');
  while(words.length>1&&fillers.has(words[0]!))words.shift();
  while(words.length>1&&fillers.has(words.at(-1)!))words.pop();
  const particles=new Set(['бля','блять','блядь','blya','blyat','blyad']);
  return words.filter((word,index)=>index===0||index===words.length-1||!particles.has(word)).join(' ');
}
function eligible(i: AnswerInput, e: Evidence) {
  return (
    e.organizationId === i.organizationId &&
    e.eventId === i.eventId &&
    e.visibility === 'participant' &&
    (e.state === 'published' || (i.mode === 'draft_preview' && e.state === 'draft')) &&
    (!i.faqOnly || e.kind === 'faq')
  );
}
function distinct(items: Evidence[]) {
  const map = new Map<string, Evidence>();
  for (const e of items) map.set(JSON.stringify([e.sourceId, e.versionId, e.page, e.section, e.text]), e);
  return [...map.values()];
}
/** Match the source excerpt exactly apart from PDF whitespace, retaining its original text. */
function sourceQuote(text: string, quote: string): string | undefined {
  if (text.includes(quote)) return quote;
  const words = quote.trim().split(/\s+/u);
  if (!words.length || quote.length > 4000) return undefined;
  const pattern = words.map(word => word.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('\\s+');
  return text.match(new RegExp(pattern, 'u'))?.[0];
}
function lexical(question: string, items: Evidence[]) {
  const tokens = new Set(
    normalizeQuestion(question)
      .split(' ')
      .filter((t) => t.length > 2),
  );
  return items
    .map((item) => {
      const words = new Set(
        normalizeQuestion(
          [item.title, ...item.aliases, item.kind === 'document' ? item.text : ''].join(' '),
        ).split(' '),
      );
      return { item, score: [...tokens].filter((t) => words.has(t)).length };
    })
    .sort((a, b) => b.score - a.score)
    .filter((x) => x.score > 0)
    .map((x) => x.item);
}
export class AnswerEngine {
  static async run(input: AnswerInput, ports: AnswerPorts = {}): Promise<Decision> {
    const started = performance.now();
    const steps: TraceStep[] = [];
    async function measured<T>(stage: string, action: () => Promise<T>): Promise<T> {
      const start = performance.now();
      const cost = ports.usage ? ports.usage().costMicros : 0;
      let reason = 'completed';
      try { return await action(); }
      catch (error) { reason = 'failed'; throw error; }
      finally {
        const after = ports.usage ? ports.usage().costMicros : 0;
        steps.push({ stage, reason, candidates: [], durationMs: Math.round(performance.now() - start),
          costMicros: cost === null || after === null ? null : Math.max(0, after - cost) });
      }
    }
    let msg = messages[input.language];
    const done = (
      outcome: Outcome,
      reasonCode: string,
      answer: string,
      sources: EvidenceRef[] = [],
    ): Decision => ({
      durationMs: Math.round(performance.now() - started),
      outcome,
      reasonCode,
      answer,
      language: input.language,
      traceId: input.traceId,
      sources,
      steps,
      usage: ports.usage?.() ?? { paidOperations: 0, costMicros: 0 },
    });
    const fallback = (reason: string) => {
      const technical = reason === 'budget_exhausted' ? msg.budget
        : ['provider_unavailable', 'operation_uncertain'].includes(reason) ? msg.unavailable : undefined;
      return done(input.handoffEnabled ? 'handoff' : 'refuse', reason, technical ?? (input.handoffEnabled ? msg.human : msg.missing));
    };
    if (!input.activated) return done('ignored', 'not_activated', '');
    const question = normalizeQuestion(input.question);
    const wording=normalizeFaqWording(input.question);
    const exactQuestion=faqQuestionKey(wording);
    const social=socialReply(wording,input.language,input.languageSelection==='auto');
    if(social){input={...input,language:social.language};return done('clarify','social_greeting',social.answer);}
    if (!question) return done('clarify', 'empty_question', msg.ask);
    const eligibleSources = input.sources.filter((e) => eligible(input, e))
      .sort((a, b) => Number(b.language === input.language) - Number(a.language === input.language));
    const faqWordings = new Map(eligibleSources.filter(e => e.kind === 'faq').map(e =>
      [e, new Set([e.title, ...e.aliases].map(t => faqQuestionKey(normalizeQuestion(t))))]));
    const exactMatches = (contextIndependent = false) => eligibleSources.filter(
      (e) => (!input.conversation?.length || contextIndependent) && e.kind === 'faq' && e.language === input.language &&
        faqWordings.get(e)?.has(exactQuestion),
    );
    let exact = input.languageSelection === 'auto' ? [] : exactMatches();
    if (input.languageSelection === 'auto') {
      const approvedMatches = eligibleSources.filter(e => e.kind === 'faq' && faqWordings.get(e)?.has(exactQuestion));
      const previous = input.conversation?.at(-1);
      if (approvedMatches.length === 1 && (!previous ||
        faqQuestionKey(normalizeFaqWording(previous.question)) === exactQuestion && previous.answer === approvedMatches[0]!.text)) {
        // Only original approved wording supplies the language; never a generated rewrite.
        input = { ...input, language: approvedMatches[0]!.language };
        msg = messages[input.language];
        exact = approvedMatches;
      }
    }
    steps.push({
      stage: 'exact_faq',
      reason: exact.length ? 'matched' : 'miss',
      candidates: exact.map(reference),
    });
    const faq = async (e: Evidence, reason: string) => {
      const refs = [reference(e)];
      return ports.current && !(await ports.current(refs))
        ? fallback('source_changed')
        : done('approved_faq', reason, e.text, refs);
    };
    if (exact.length === 1) return faq(exact[0]!, 'exact_faq');
    if (exact.length > 1) return fallback('conflicting_sources');
    const timeLanguage = timeFragmentLanguage(exactQuestion);
    if (timeLanguage && input.conversation?.length) {
      const language = input.languageSelection === 'auto' ? timeLanguage : input.language;
      const turns = input.conversation.map(turn => faqQuestionKey(normalizeFaqWording(turn.question)));
      const matches = eligibleSources.filter(e => e.kind === 'faq' && e.language === language && faqSuppliesTime(e.text) &&
        turns.every((turn, index) => faqWordings.get(e)?.has(turn) || index > 0 && timeFragmentLanguage(turn)));
      if (matches.length) {
        input = { ...input, language }; msg = messages[language];
        steps.push({ stage:'context_faq',reason:'approved_topic_and_time',candidates:matches.map(reference) });
        if (matches.length > 1) return fallback('conflicting_sources');
        return faq(matches[0]!, 'context_faq');
      }
    }
    if (!input.conversation?.length && timeLanguage) {
      if (input.languageSelection === 'auto') { input = { ...input, language:timeLanguage }; msg = messages[timeLanguage]; }
      return done('clarify','ambiguous_question',msg.ask);
    }
    if (!input.conversation?.length && /^(?:рега|регистрация)$/u.test(exactQuestion))
      return done('clarify', 'ambiguous_question', msg.ask);
    try {
      if (ports.understand) {
        const understanding = await measured('understanding', () => ports.understand!(input));
        if (input.languageSelection === 'auto') {
          if (!understanding.responseLanguage || !['ru', 'kk', 'en'].includes(understanding.responseLanguage))
            throw new ServiceFailure('provider_unavailable');
          input = { ...input, language: understanding.responseLanguage };
          msg = messages[input.language];
          eligibleSources.sort((a, b) => Number(b.language === input.language) - Number(a.language === input.language));
        }
        steps.push({ stage: 'understanding', reason: understanding.clarification ? 'needs_clarification' : 'interpreted', candidates: [] });
        if (input.languageSelection === 'auto') {
          // Only the original question can use this shortcut, never a model rewrite.
          const detectedExact = exactMatches(understanding.contextIndependent === true && !understanding.clarification);
          steps.push({ stage: 'exact_faq', reason: detectedExact.length ? 'matched' : 'miss', candidates: detectedExact.map(reference) });
          if (detectedExact.length === 1) return faq(detectedExact[0]!, 'exact_faq');
          if (detectedExact.length > 1) return fallback('conflicting_sources');
        }
        // Model-written clarification can contain factual claims without evidence.
        // This path has no verification stage, so only publish the localized prompt.
        if (understanding.clarification) return done('clarify', 'ambiguous_question', msg.ask);
        input = { ...input, searchQueries: [...new Set([input.question, ...understanding.queries])].slice(0, 4) };
      }
      const retrieveCandidates = async () => {
      const retrieved = (ports.retrieve ? await measured('retrieval', () => ports.retrieve!(input)) : []).filter((e) => eligible(input, e));
      const rankedFaq = lexical(
        (input.searchQueries ?? [question]).join(' '),
        eligibleSources.filter((e) => e.kind === 'faq'),
      );
      let candidates = distinct([
        ...rankedFaq.slice(0, 3),
        ...retrieved,
        ...rankedFaq,
        ...eligibleSources.filter((e) => e.kind === 'faq'),
      ]).slice(0, 24);
      if (ports.rerank) {
        const pool = new Set(candidates);
        candidates = await measured('reranking', () => ports.rerank!(input, candidates));
        // Rerankers may order authorized evidence, never inject or rewrite it.
        if (candidates.length !== pool.size || candidates.some(e => !pool.has(e)) || new Set(candidates).size !== pool.size)
          throw new ServiceFailure('provider_unavailable');
      }
      candidates = candidates.slice(0, 12);
      steps.push({ stage: 'retrieval', reason: 'ranked', candidates: candidates.map(reference) });
      return candidates;
      };
      let candidates = await retrieveCandidates();
      if (!ports.assess) return fallback(candidates.length ? 'provider_unavailable' : 'insufficient_evidence');
      if (ports.current && !(await ports.current(candidates.map(reference)))) return fallback('source_changed');
      let selectionRound: 0 | 1 | 2 = 0;
      const select = async () => {
        const result = await measured(selectionRound === 2 ? 'selection_repair' : 'selection', () => ports.assess!(input, candidates, selectionRound));
        if (ports.resolveLanguageInAssessment && input.languageSelection === 'auto') {
          if (!result.responseLanguage || !['ru','kk','en'].includes(result.responseLanguage))
            throw new ServiceFailure('provider_unavailable');
          input = { ...input, language: result.responseLanguage };
          msg = messages[input.language];
        }
        return result;
      };
      let result = await select();
      if (ports.resolveLanguageInAssessment && result.kind === 'insufficient' && result.searchQueries?.length && ports.retrieve) {
        const queries = result.searchQueries.filter(q => typeof q === 'string' && q.trim() && q.length <= 600).slice(0,3);
        if (queries.some(q => normalizeQuestion(q) !== question)) {
          input = { ...input, searchQueries: [...new Set([input.question,...queries])].slice(0,4) };
          steps.push({stage:'retrieval_expansion',reason:'missing_evidence',candidates:[]});
          candidates = await retrieveCandidates();
          if (ports.current && !(await ports.current(candidates.map(reference)))) return fallback('source_changed');
          selectionRound = 1;
          result = await select();
        }
      }
      if (result.kind === 'document' && result.claims.some(claim => {
        const evidence = candidates[claim.index];
        return evidence?.kind === 'document' && !sourceQuote(evidence.text, claim.quote);
      })) {
        // A failed literal citation check is repairable, not evidence. Keep the
        // same authorized pool; allow one correction and run every gate again.
        steps.push({ stage: 'selection_repair', reason: 'quote_absent_from_source', candidates: [] });
        selectionRound = 2;
        result = await select();
      }
      steps.push({ stage: 'evidence_gate', reason: result.kind, candidates: [] });
      for (const item of result.rejected ?? []) {
        const candidate = candidates[item.index];
        const selected = result.kind === 'faq' && result.index === item.index ||
          result.kind === 'document' && result.claims.some(c=>c.index===item.index);
        if (candidate && !selected) steps.push({ stage:'candidate_rejected', reason:item.reason, candidates:[reference(candidate)] });
      }
      switch (result.kind) {
        case 'faq': {
          const e = candidates[result.index];
          if (e?.kind !== 'faq' || !ports.verify) return fallback('unsupported_claim');
          if (ports.resolveLanguageInAssessment && result.contextIndependent === true && exactMatches(true).includes(e))
            return faq(e,'exact_faq');
          const translated = e.language !== input.language;
          const answer = translated ? result.answer?.trim() : e.text;
          if (!answer || answer.length > 4000) return fallback('unsupported_claim');
          if (ports.current && !(await ports.current([reference(e)]))) return fallback('source_changed');
          const supported = await measured('verification', () => ports.verify!(input, [{ statement: answer, quote: e.text, evidence: e }]));
          if (!supported) return fallback('unsupported_claim');
          if (!translated) return faq(e, 'semantic_faq');
          if (ports.current && !(await ports.current([reference(e)]))) return fallback('source_changed');
          return done('grounded_answer', 'translated_faq', answer, [{ ...reference(e), quote: e.text }]);
        }
        case 'document': {
          if (!result.claims.length || result.claims.length > 5) return fallback('unsupported_claim');
          const accepted: { statement: string; quote: string; evidence: Evidence }[] = [];
          for (const { index, statement, quote } of result.claims) {
            const e = candidates[index];
            const originalQuote = e ? sourceQuote(e.text, quote) : undefined;
            if (
              !e ||
              e.kind !== 'document' ||
              (!(Number.isInteger(e.page) && e.page! >= 1) && !e.section) ||
              !quote.trim() ||
              !/[\p{L}\p{N}]/u.test(quote) ||
              !statement.trim() ||
              !originalQuote
            )
              return fallback('unsupported_claim');
            accepted.push({ statement, quote: originalQuote, evidence: e });
          }
          const refs = accepted.map((c) => ({ ...reference(c.evidence), quote: c.quote }));
          if (ports.current && !(await ports.current(refs))) return fallback('source_changed');
          if (!ports.verify || !(await measured('verification', () => ports.verify!(input, accepted)))) return fallback('unsupported_claim');
          if (ports.current && !(await ports.current(refs))) return fallback('source_changed');
          return done('grounded_answer', 'document_evidence', accepted.map((c) => c.statement).join(' '), refs);
        }
        case 'ambiguous': {
          return done('clarify', 'ambiguous_question', msg.ask);
        }
        case 'personal':
          return fallback('personal_decision');
        case 'conflict':
          return fallback('conflicting_sources');
        case 'off_topic':
          return done('refuse', 'off_topic', msg.off);
        default:
          return fallback('insufficient_evidence');
      }
    } catch (error) {
      if (error instanceof ServiceFailure) return fallback(error.reason);
      throw error; // Storage failures retry the durable job.
    }
  }
}
