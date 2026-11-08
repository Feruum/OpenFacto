import { normalizeFaqWording, type AnswerInput, type AnswerPorts, type Evidence } from '@openfacto/answer-engine';

type Claims = Parameters<NonNullable<AnswerPorts['verify']>>[1];

export function verificationPayload(input: AnswerInput, claims: Claims, candidates: Evidence[]) {
  const selected = new Set(claims.map(claim => claim.evidence));
  return {
    question: input.question,
    questionWording: normalizeFaqWording(input.question),
    language: input.language,
    conversation: input.conversation ?? [],
    // Selected evidence already travels with each claim. Retain every other
    // candidate (including other chunks of the same source) for conflict checks.
    otherEvidence: candidates.filter(candidate => !selected.has(candidate))
      .map(candidate => ({ title: candidate.title, text: candidate.text.slice(0, 4000), language: candidate.language })),
    claims: claims.map(claim => claim.evidence.kind === 'faq' ? {
      kind: 'faq', approvedQuestion: claim.evidence.title, approvedAnswer: claim.evidence.text,
      statement: claim.statement, sourceLanguage: claim.evidence.language,
    } : {
      kind: claim.evidence.kind, title: claim.evidence.title, statement: claim.statement,
      quote: claim.quote, context: claim.evidence.text.slice(0, 4000),
    }),
  };
}
