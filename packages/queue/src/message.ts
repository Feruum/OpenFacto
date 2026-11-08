export const AI_QUESTIONS_QUEUE = 'ai.questions';
export const DOCUMENTS_QUEUE = 'documents.ingest';
export const EVALUATIONS_QUEUE = 'ai.evaluations';
export const DELIVERY_QUEUE = 'messages.delivery';
export const FOUNDATION_QUEUE = 'openfacto-foundation';
export const queueNames = [AI_QUESTIONS_QUEUE, DOCUMENTS_QUEUE, EVALUATIONS_QUEUE, DELIVERY_QUEUE, FOUNDATION_QUEUE] as const;
export type QueueName = typeof queueNames[number];
export type Job = { name: string; data: { id: string } };
const names: Record<QueueName, readonly string[]> = {
  [AI_QUESTIONS_QUEUE]: ['telegram', 'playground'],
  [DOCUMENTS_QUEUE]: ['ingest', 'purge', 'embed-faq'],
  [EVALUATIONS_QUEUE]: ['case'],
  [DELIVERY_QUEUE]: ['outgoing'],
  [FOUNDATION_QUEUE]: ['smoke'],
};
export function decodeJob(queue: string, content: Buffer): Job {
  if (content.length > 1024 || !queueNames.includes(queue as QueueName)) throw new Error('Invalid queue message');
  const job = JSON.parse(content.toString('utf8'));
  if (!job || typeof job !== 'object' || Object.keys(job).sort().join(',') !== 'data,name' ||
    !names[queue as QueueName].includes(job.name) || !job.data || typeof job.data !== 'object' ||
    Object.keys(job.data).join(',') !== 'id' || typeof job.data.id !== 'string' ||
    !(queue === FOUNDATION_QUEUE ? /^[a-zA-Z0-9-]{1,64}$/ : /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i).test(job.data.id)) {
    throw new Error('Invalid queue message');
  }
  return job;
}
