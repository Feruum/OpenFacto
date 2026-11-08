import { rejectionReasons, type Assessment } from '@openfacto/answer-engine';
import { planningMetadata } from './combined-planning.js';
import { parseUnderstanding } from './understanding.js';

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : undefined;
const count = (value: unknown): number | null => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
const text = (value: unknown, max: number): value is string => typeof value === 'string' && !!value.trim() && value.length <= max;
const index = (value: unknown): value is number => count(value) !== null;

export function parseAssessment(data: ObjectValue, requireLanguage = false): Assessment {
  const metadata = planningMetadata(data, requireLanguage);
  let choice: Assessment;
  switch (data.kind) {
    case 'faq':
      if (!index(data.index) || data.answer !== undefined && !text(data.answer, 4000)) throw new Error('Invalid FAQ');
      choice = { kind: 'faq', index: data.index, ...(data.answer !== undefined ? { answer: data.answer as string } : {}) };
      break;
    case 'document': {
      if (!Array.isArray(data.claims) || data.claims.length < 1 || data.claims.length > 5) throw new Error('Invalid claims');
      const claims = data.claims.map(value => {
        const claim = object(value);
        if (!claim || !index(claim.index) || !text(claim.quote, 4000) || !text(claim.statement, 1600)) throw new Error('Invalid claim');
        return { index: claim.index, quote: claim.quote, statement: claim.statement };
      });
      choice = { kind: 'document', claims };
      break;
    }
    case 'ambiguous':
      if (data.clarification !== undefined && !text(data.clarification, 500)) throw new Error('Invalid clarification');
      choice = { kind: 'ambiguous', ...(data.clarification !== undefined ? { clarification: data.clarification as string } : {}) };
      break;
    case 'conflict': case 'personal': case 'off_topic': case 'insufficient':
      choice = { kind: data.kind }; break;
    default: throw new Error('Invalid decision');
  }
  const rejected = Array.isArray(data.rejected) ? data.rejected.slice(0, 12).flatMap(value => {
    const item = object(value);
    return item && index(item.index) && rejectionReasons.includes(item.reason as typeof rejectionReasons[number])
      ? [{ index: item.index, reason: item.reason as typeof rejectionReasons[number] }] : [];
  }) : [];
  return { ...choice, ...metadata, ...(rejected.length ? { rejected } : {}) };
}

export type CompletionDiagnostics = {
  promptTokens: number | null; completionTokens: number | null;
  cachedTokens: number | null; reasoningTokens: number | null;
  finishReason: string | null;
  parseStatus: 'ok' | 'missing_usage' | 'invalid_finish' | 'invalid_json' | 'invalid_schema';
};

/** Retain billable usage even when generated content is unusable. Never return raw content. */
export function parseProviderCompletion(result: unknown, stage: string, requireLanguage: boolean): {
  value: ObjectValue | null; diagnostics: CompletionDiagnostics;
} {
  const body = object(result), usage = object(body?.usage);
  const choice = Array.isArray(body?.choices) ? object(body.choices[0]) : undefined;
  const diagnostics: CompletionDiagnostics = {
    promptTokens: count(usage?.prompt_tokens), completionTokens: count(usage?.completion_tokens),
    cachedTokens: count(object(usage?.prompt_tokens_details)?.cached_tokens),
    reasoningTokens: count(object(usage?.completion_tokens_details)?.reasoning_tokens),
    finishReason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : null,
    parseStatus: 'ok',
  };
  const invalid = (status: CompletionDiagnostics['parseStatus']) => ({ value: null, diagnostics: { ...diagnostics, parseStatus: status } });
  if (diagnostics.promptTokens === null || diagnostics.completionTokens === null) return invalid('missing_usage');
  if (diagnostics.finishReason !== 'stop') return invalid('invalid_finish');
  const content = object(choice?.message)?.content;
  let parsed: ObjectValue | undefined;
  try {
    if (typeof content !== 'string') return invalid('invalid_json');
    parsed = object(JSON.parse(content.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1')));
    if (!parsed) return invalid('invalid_json');
  } catch { return invalid('invalid_json'); }
  try {
    if (stage === 'verify') {
      if (typeof parsed.supported !== 'boolean') return invalid('invalid_schema');
      return { value: { supported: parsed.supported }, diagnostics };
    }
    if (stage === 'understand') {
      parseUnderstanding(parsed, requireLanguage);
      return { value: parsed, diagnostics };
    }
    return { value: { ...parseAssessment(parsed, requireLanguage) }, diagnostics };
  } catch { return invalid('invalid_schema'); }
}
